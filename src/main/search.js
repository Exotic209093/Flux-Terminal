const fs = require('fs')
const path = require('path')
const { app } = require('electron')
const { parseSessionFile } = require('./parser')

// Cross-session search: per-session extracted-text cache + AND query.
//
// Cache layout: userData/search-cache/<sessionId>.json
//   { mtimeMs, size, entries: [{ idx, role, ts, text }] }
//
// Cache is keyed by source file mtimeMs+size; rebuilt lazily on mismatch.
// Injectable fs facade for tests (pass { fakeFs } in opts).

const ENTRY_TEXT_CAP = 2048 // ~2KB per entry (search text, not the raw message)
const SNIPPET_WINDOW = 80   // chars either side of first match
const MAX_HITS = 200

// ---- text extraction -------------------------------------------------------

/**
 * Extract searchable text entries from a session file.
 * Each entry mirrors one timeline item: { idx, role, ts, text }.
 * Base64 image data is never included; tool names are included.
 * Returns [] on any read/parse error.
 */
function extractEntries(filePath, injectedFs) {
  const io = injectedFs || fs
  let raw = ''
  try {
    raw = io.readFileSync(filePath, 'utf-8')
  } catch {
    return []
  }

  const entries = []
  const lines = raw.split('\n')

  for (const line of lines) {
    const s = line.trim()
    if (!s) continue
    let o
    try {
      o = JSON.parse(s)
    } catch {
      continue
    }
    if (!o || typeof o !== 'object') continue

    // We only care about user/assistant turns
    if (o.type !== 'user' && o.type !== 'assistant') continue

    const role = o.type
    const ts = o.timestamp || null
    const content = o.message && o.message.content

    const parts = []

    if (role === 'user' && typeof content === 'string') {
      // Simple string user message
      parts.push(content)
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        switch (block.type) {
          case 'text':
            if (typeof block.text === 'string') parts.push(block.text)
            break
          case 'thinking':
            if (typeof block.thinking === 'string') parts.push(block.thinking)
            break
          case 'tool_use':
            // Include tool name so queries like "Bash" or "Read" match
            if (block.name) parts.push(block.name)
            break
          case 'tool_result': {
            const inner = Array.isArray(block.content) ? block.content : null
            if (inner) {
              for (const b of inner) {
                if (b && b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
                // images: skip (no base64)
              }
            } else if (typeof block.content === 'string') {
              parts.push(block.content)
            }
            break
          }
          // image blocks: explicitly skip — never include base64 data
          default:
            break
        }
      }
    }

    if (parts.length === 0) continue

    let text = parts.join(' ')
    if (text.length > ENTRY_TEXT_CAP) text = text.slice(0, ENTRY_TEXT_CAP) + '…'

    entries.push({ idx: entries.length, role, ts, text })
  }

  return entries
}

// ---- cache ------------------------------------------------------------------

/** Build a fresh cache object for a session file + its stat. */
function buildCache(filePath, stat, injectedFs) {
  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    entries: extractEntries(filePath, injectedFs)
  }
}

/**
 * Load the on-disk cache for a session if it matches the current stat,
 * otherwise build + write a fresh one.
 *
 * @param {string} sessionId
 * @param {string} filePath   source JSONL
 * @param {{ mtimeMs: number, size: number }} stat  current file stat
 * @param {object|null} fakeFs  injectable fs facade ({ existsSync, readFileSync,
 *                               writeFileSync, mkdirSync, cacheDir })
 *                               Pass null to use the real fs + default cache dir.
 * @returns {{ mtimeMs, size, entries }}
 */
function loadOrBuildCache(sessionId, filePath, stat, fakeFs) {
  const io = fakeFs || {
    existsSync: (p) => fs.existsSync(p),
    statSync: (p) => fs.statSync(p),
    readFileSync: (p, enc) => fs.readFileSync(p, enc),
    writeFileSync: (p, data) => fs.writeFileSync(p, data),
    mkdirSync: (p, opts) => fs.mkdirSync(p, opts),
    cacheDir: getCacheDir()
  }

  const cacheFile = path.join(io.cacheDir, sessionId + '.json')

  // Try to load the existing cache
  if (io.existsSync(cacheFile)) {
    try {
      const raw = io.readFileSync(cacheFile, 'utf-8')
      const cached = JSON.parse(raw)
      if (cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached
      }
    } catch {
      // Corrupt or unreadable cache — fall through to rebuild
    }
  }

  // Build and persist; pass io so extractEntries uses the same fs facade
  const fresh = buildCache(filePath, stat, io)
  try {
    io.mkdirSync(io.cacheDir, { recursive: true })
    io.writeFileSync(cacheFile, JSON.stringify(fresh))
  } catch {
    // Cache write failure is non-fatal; we still return the data
  }
  return fresh
}

function getCacheDir() {
  // app.getPath throws before app is ready in tests; fall back to a no-op path
  try {
    return path.join(app.getPath('userData'), 'search-cache')
  } catch {
    return path.join(require('os').homedir(), '.flux-search-cache')
  }
}

// ---- search -----------------------------------------------------------------

/**
 * Case-insensitive AND search across session caches.
 *
 * @param {string} query
 * @param {Array<{ sessionId, file, projectApprox, size, mtimeMs, title? }>} sessions
 *   Already sorted newest-first by the caller (listSessionFiles sort order).
 * @param {{ fakeFs?, onProgress? }} opts
 * @returns {Array<HitDTO>}
 *   { sessionId, project, title, msgIdx, role, ts, snippet, matchStart, matchEnd }
 */
function search(query, sessions, opts = {}) {
  const { fakeFs, onProgress } = opts

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  if (terms.length === 0) return []

  // Guarantee newest-first regardless of input order
  const sorted = [...sessions].sort((a, b) => b.mtimeMs - a.mtimeMs)

  const hits = []
  const total = sorted.length

  for (let si = 0; si < total; si++) {
    if (hits.length >= MAX_HITS) break

    const sess = sorted[si]
    const stat = { mtimeMs: sess.mtimeMs, size: sess.size }
    const cache = loadOrBuildCache(sess.sessionId, sess.file, stat, fakeFs || null)

    if (onProgress) onProgress({ done: si + 1, total })

    for (const entry of cache.entries) {
      if (hits.length >= MAX_HITS) break

      const lower = entry.text.toLowerCase()
      // AND: every term must appear
      if (!terms.every((t) => lower.includes(t))) continue

      // Build snippet around first term match
      const firstTermIdx = lower.indexOf(terms[0])
      const snippetStart = Math.max(0, firstTermIdx - SNIPPET_WINDOW)
      const snippetEnd = Math.min(entry.text.length, firstTermIdx + terms[0].length + SNIPPET_WINDOW)
      const snippet = entry.text.slice(snippetStart, snippetEnd)

      // Match offsets relative to snippet start
      const matchStart = firstTermIdx - snippetStart
      const matchEnd = matchStart + terms[0].length

      hits.push({
        sessionId: sess.sessionId,
        project: sess.projectApprox || sess.projectDir || '',
        title: sess.title || null,
        msgIdx: entry.idx,
        role: entry.role,
        ts: entry.ts,
        snippet,
        matchStart,
        matchEnd
      })
    }
  }

  return hits
}

module.exports = { extractEntries, buildCache, loadOrBuildCache, search, getCacheDir }
