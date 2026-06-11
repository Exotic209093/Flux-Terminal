// src/main/searchindex.js
// Persistent FTS5 search index over every transcript, built incrementally off
// the SessionIndex substrate. Pure helpers up top (unit-tested); the
// SearchIndex class below owns the node:sqlite database. Falls back gracefully:
// when node:sqlite is unavailable the legacy search.js scan serves queries.

const fs = require('fs')
const path = require('path')
const sessionsMod = require('./sessions')
const { freshModel, applyEvent } = require('./parser')
const { createTail } = require('./tailer')

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
      // stored kinds are user/text/thinking/tool_use/tool_result; people will
      // type role:assistant and mean the text items
      else if (key === 'role' && val.toLowerCase() === 'assistant') filters.role = 'text'
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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  file TEXT PRIMARY KEY, mtimeMs REAL, size INTEGER,
  offset INTEGER, itemCount INTEGER,
  sessionId TEXT, project TEXT, title TEXT
);
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT, sessionId TEXT, msgIdx INTEGER,
  ts TEXT, role TEXT, tool TEXT, isError INTEGER, text TEXT
);
CREATE INDEX IF NOT EXISTS records_file ON records(file);
CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(text, content='records', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN
  INSERT INTO records_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN
  INSERT INTO records_fts(records_fts, rowid, text) VALUES('delete', old.id, old.text);
END;
`

/** Lazy node:sqlite open — required inside the function so a missing module is catchable. */
function defaultOpenDb(dbPath) {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(dbPath || ':memory:')
  try {
    db.exec('PRAGMA journal_mode=WAL')
  } catch (err) {
    // corrupt file: the open itself is lazy and succeeds — close the handle
    // so recovery can actually unlink the file (Windows EBUSY otherwise)
    try { db.close() } catch { /* ignore */ }
    throw err
  }
  return db
}

const PROGRESS_MIN_FILES = 4 // single-file live updates don't show progress

class SearchIndex {
  constructor(opts = {}) {
    this.openDb = opts.openDb || defaultOpenDb
    this.dbPath = opts.dbPath || null
    this.fsImpl = opts.fsImpl || fs
    this.listFiles = opts.listFiles || sessionsMod.listSessionFiles
    this.makeTail = opts.makeTail || ((file, startOffset) => createTail(file, { startOffset }))
    this.enqueueTick = opts.enqueueTick || ((fn) => setImmediate(fn))
    this.onProgress = opts.onProgress || (() => {})
    this.available = false
    this.db = null
    this.queue = []
    this.queued = new Set()
    this.draining = false
    this.buildTotal = 0
    this.buildDone = 0
    this.disposed = false
  }

  start() {
    try {
      this.db = this._openOrRecreate()
      this.available = true
    } catch {
      this.available = false // no node:sqlite / unrecoverable DB — legacy scan serves queries
      return
    }
    this._reconcile()
  }

  dispose() {
    this.disposed = true
    if (this.db) {
      try {
        this.db.close()
      } catch {
        /* ignore */
      }
    }
  }

  _openOrRecreate() {
    let db = null
    try {
      db = this.openDb(this.dbPath)
      db.exec(SCHEMA)
      return db
    } catch {
      // corrupt DB file — close any half-open handle, delete all three sqlite
      // files together (db + -wal + -shm), and start over. One rebuild beats
      // a dead search.
      if (db) {
        try { db.close() } catch { /* ignore */ }
      }
      if (this.dbPath) {
        for (const suffix of ['', '-wal', '-shm']) {
          try { this.fsImpl.unlinkSync(this.dbPath + suffix) } catch { /* ignore */ }
        }
      }
      db = this.openDb(this.dbPath)
      db.exec(SCHEMA)
      return db
    }
  }

  /** Compare the files table against disk; queue stale/new files, purge deleted. */
  _reconcile() {
    const known = new Map(this.db.prepare('SELECT file, mtimeMs, size FROM files').all().map((r) => [r.file, r]))
    let metas
    try {
      metas = this.listFiles()
    } catch {
      metas = []
    }
    const seen = new Set()
    for (const meta of metas) {
      seen.add(meta.file)
      const k = known.get(meta.file)
      if (!k || k.mtimeMs !== meta.mtimeMs || k.size !== meta.size) this._push(meta.file)
    }
    for (const file of known.keys()) {
      if (!seen.has(file)) this.remove(file)
    }
    this.buildTotal = this.queue.length
    this.buildDone = 0
    this._drain()
  }

  enqueue(file) {
    if (!this.available) return
    this._push(file)
    this._drain()
  }

  _push(file) {
    if (this.queued.has(file)) return
    this.queued.add(file)
    this.queue.push(file)
  }

  remove(file) {
    if (!this.available) return
    try {
      this.db.prepare('DELETE FROM records WHERE file = ?').run(file)
      this.db.prepare('DELETE FROM files WHERE file = ?').run(file)
    } catch {
      /* ignore */
    }
  }

  /** One file per tick: the initial build never blocks the event loop for long. */
  _drain() {
    if (this.draining || this.disposed || !this.available) return
    this.draining = true
    const step = () => {
      if (this.disposed) {
        this.draining = false
        return
      }
      const file = this.queue.shift()
      if (!file) {
        this.draining = false
        this.buildTotal = 0
        return
      }
      this.queued.delete(file)
      try {
        this._updateFile(file)
      } catch {
        /* one bad file never kills the queue; the next reconcile retries it */
      }
      this.buildDone++
      if (this.buildTotal >= PROGRESS_MIN_FILES) {
        this.onProgress({ done: Math.min(this.buildDone, this.buildTotal), total: this.buildTotal })
      }
      this.enqueueTick(step)
    }
    this.enqueueTick(step)
  }

  _updateFile(file) {
    const row = this.db.prepare('SELECT offset, itemCount FROM files WHERE file = ?').get(file)
    let itemCount = row ? row.itemCount : 0
    const tail = this.makeTail(file, row ? row.offset : 0)
    let delta
    try {
      delta = tail.readDelta()
    } catch {
      this.remove(file) // file vanished
      return
    }
    let purge = false
    if (delta.reset) {
      // defer the purge into the transaction below — a failed re-insert must
      // not leave the file unindexed with a stale files row
      purge = true
      itemCount = 0
      try {
        delta = tail.readDelta()
      } catch {
        this.remove(file)
        return
      }
    }
    const model = freshModel(file)
    const items = []
    for (const o of delta.objects) applyEvent(o, model, items)
    const entries = entriesFromItems(items, itemCount)
    const sessionId = path.basename(file).replace(/\.jsonl$/i, '')
    const project = sessionsMod.approxDecodeProject(path.basename(path.dirname(file)))
    const title = model.title || model.lastUserPrompt || null
    this.db.exec('BEGIN')
    try {
      if (purge) this.db.prepare('DELETE FROM records WHERE file = ?').run(file)
      const ins = this.db.prepare(
        'INSERT INTO records (file, sessionId, msgIdx, ts, role, tool, isError, text) VALUES (?,?,?,?,?,?,?,?)'
      )
      for (const e of entries) ins.run(file, sessionId, e.msgIdx, e.ts, e.role, e.tool, e.isError, e.text)
      this.db
        .prepare(
          `INSERT INTO files (file, mtimeMs, size, offset, itemCount, sessionId, project, title)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(file) DO UPDATE SET mtimeMs=excluded.mtimeMs, size=excluded.size,
             offset=excluded.offset, itemCount=excluded.itemCount,
             title=COALESCE(excluded.title, files.title)`
        )
        .run(file, delta.mtimeMs, delta.size, tail.offset, itemCount + items.length, sessionId, project, title)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  /** Millisecond query over the index. Returns the legacy hit DTO. */
  query(q, { limit = 200 } = {}) {
    if (!this.available) return []
    const { terms, filters } = parseQuery(q)
    if (!terms.length && !Object.keys(filters).length) return []
    const where = []
    const params = []
    let sql
    if (terms.length) {
      sql = `SELECT r.sessionId, r.file, r.msgIdx, r.role, r.ts, f.project, f.title,
               snippet(records_fts, 0, char(1), char(2), '…', 40) AS marked
             FROM records_fts
             JOIN records r ON r.id = records_fts.rowid
             JOIN files f ON f.file = r.file`
      where.push('records_fts MATCH ?')
      params.push(ftsMatchFor(terms))
    } else {
      sql = `SELECT r.sessionId, r.file, r.msgIdx, r.role, r.ts, r.text AS marked, f.project, f.title
             FROM records r JOIN files f ON f.file = r.file`
    }
    if (filters.role) {
      where.push('r.role = ?')
      params.push(filters.role.toLowerCase())
    }
    if (filters.tool) {
      where.push('LOWER(r.tool) = LOWER(?)')
      params.push(filters.tool)
    }
    if (filters.file) {
      where.push('LOWER(r.file) LIKE ?')
      params.push('%' + filters.file.toLowerCase() + '%')
    }
    if (filters.project) {
      where.push('LOWER(f.project) LIKE ?')
      params.push('%' + filters.project.toLowerCase() + '%')
    }
    if (filters.sessionId) {
      where.push('r.sessionId = ?')
      params.push(filters.sessionId)
    }
    if (filters.isError !== undefined) {
      where.push('r.isError = ?')
      params.push(filters.isError ? 1 : 0)
    }
    if (where.length) sql += ' WHERE ' + where.join(' AND ')
    sql += ' ORDER BY f.mtimeMs DESC, r.msgIdx ASC LIMIT ?'
    params.push(limit)
    let rows
    try {
      rows = this.db.prepare(sql).all(...params)
    } catch {
      return [] // FTS syntax edge our quoting missed — empty beats a broken overlay
    }
    return rows.map((r) => {
      const m = snippetToOffsets(r.marked || '')
      return {
        sessionId: r.sessionId,
        // the index spans EVERY transcript; hits beyond the renderer's
        // 500-session store window need the path to open at all
        file: r.file,
        project: r.project || '',
        title: r.title || null,
        msgIdx: r.msgIdx,
        role: r.role,
        ts: r.ts,
        snippet: terms.length ? m.snippet : m.snippet.slice(0, 160),
        matchStart: m.matchStart,
        matchEnd: m.matchEnd
      }
    })
  }
}

module.exports = {
  parseQuery, ftsMatchFor, entriesFromItems, snippetToOffsets,
  MARK_L, MARK_R, ENTRY_TEXT_CAP, SearchIndex
}
