// src/main/searchindex.js
// Persistent FTS5 search index over every transcript, built incrementally off
// the SessionIndex substrate. Pure helpers up top (unit-tested); the
// SearchIndex class below owns the node:sqlite database. Falls back gracefully:
// when node:sqlite is unavailable the legacy search.js scan serves queries.

const ENTRY_TEXT_CAP = 2048 // matches the legacy search cache cap
const MARK_L = '\x01' // snippet() match markers — control chars never appear in transcript text
const MARK_R = '\x02'

const OPERATOR_RE = /^(role|tool|file|project|error|session):(.+)$/i

/** Split a query string into FTS terms and structured filters. */
function parseQuery(q) {
  const filters = {}
  const terms = []
  for (const tok of String(q || '').trim().split(/\s+/).filter(Boolean)) {
    const m = OPERATOR_RE.exec(tok)
    if (m) {
      const key = m[1].toLowerCase()
      const val = m[2]
      if (key === 'error') filters.isError = /^(true|1|yes)$/i.test(val)
      else if (key === 'session') filters.sessionId = val
      else filters[key] = val
    } else {
      terms.push(tok)
    }
  }
  return { terms, filters }
}

/** Build the FTS5 MATCH string: each term quoted (kills syntax injection) + prefix match. */
function ftsMatchFor(terms) {
  return terms.map((t) => '"' + t.replace(/"/g, '""') + '"*').join(' ')
}

/**
 * Map parser timeline items to indexable entries. msgIdx = startIdx + the
 * item's position in `items` (images and empty items still consume an index —
 * msgIdx must equal the .tl-item timeline offset for scroll-to-hit).
 * Mirrors the legacy extractEntries rules in search.js.
 */
function entriesFromItems(items, startIdx) {
  const entries = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item || item.kind === 'image') continue
    let text = ''
    if (item.kind === 'tool_use') {
      text = item.toolName || ''
      if (item.toolInput) text += ' ' + item.toolInput
    } else {
      text = item.text || ''
    }
    if (!text.trim()) continue
    if (text.length > ENTRY_TEXT_CAP) text = text.slice(0, ENTRY_TEXT_CAP) + '…'
    entries.push({
      msgIdx: startIdx + i,
      role: item.kind, // user | text | thinking | tool_use | tool_result
      ts: item.ts || null,
      tool: item.kind === 'tool_use' ? item.toolName || null : null,
      isError: item.isError ? 1 : 0,
      text
    })
  }
  return entries
}

/** Strip snippet() markers, returning offsets of the FIRST marked region. */
function snippetToOffsets(marked) {
  let out = ''
  let matchStart = -1
  let matchEnd = -1
  for (const ch of String(marked || '')) {
    if (ch === MARK_L) {
      if (matchStart === -1) matchStart = out.length
      continue
    }
    if (ch === MARK_R) {
      if (matchEnd === -1 && matchStart !== -1) matchEnd = out.length
      continue
    }
    out += ch
  }
  if (matchStart === -1) {
    matchStart = 0
    matchEnd = 0
  } else if (matchEnd === -1) {
    matchEnd = out.length
  }
  return { snippet: out, matchStart, matchEnd }
}

module.exports = { parseQuery, ftsMatchFor, entriesFromItems, snippetToOffsets, MARK_L, MARK_R, ENTRY_TEXT_CAP }
