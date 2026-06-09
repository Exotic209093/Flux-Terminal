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
 * Extract searchable text entries from a session file by driving the same
 * parser that SessionView uses. Each entry corresponds to exactly one
 * parser timeline item at index i, so msgIdx == i is the correct
 * `.tl-item` offset for scrolling.
 *
 * image items are skipped (no base64 in search text); tool_use entries
 * include the tool name + a short input preview so tool queries work.
 * Returns [] on any read/parse error.
 */
function extractEntries(filePath) {
  const parsed = parseSessionFile(filePath, { timeline: true })
  if (!parsed || !parsed.ok || !Array.isArray(parsed.timeline)) return []

  const entries = []
  for (let i = 0; i < parsed.timeline.length; i++) {
    const item = parsed.timeline[i]
    if (!item) continue

    // Skip image items — they carry no searchable text and may hold base64
    if (item.kind === 'image') continue

    let text = ''
    if (item.kind === 'tool_use') {
      // "Bash ls -la" — tool name + input preview so "Bash" / "Read" queries land
      text = item.toolName || ''
      if (item.toolInput) text += ' ' + item.toolInput
    } else {
      text = item.text || ''
    }

    if (!text.trim()) continue

    if (text.length > ENTRY_TEXT_CAP) text = text.slice(0, ENTRY_TEXT_CAP) + '…'

    entries.push({
      idx: i,
      role: item.kind,   // user | text | thinking | tool_use | tool_result
      ts: item.ts || null,
      text
    })
  }

  return entries
}

// ---- cache ------------------------------------------------------------------

/** Build a fresh cache object for a session file + its stat. */
function buildCache(filePath, stat) {
  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    entries: extractEntries(filePath)
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

  // Build and persist
  const fresh = buildCache(filePath, stat)
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
