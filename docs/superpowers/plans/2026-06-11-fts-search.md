# FTS Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A persistent SQLite FTS5 index over every transcript — built incrementally off the SessionIndex substrate, queried in milliseconds with `role:`/`tool:`/`file:`/`project:`/`error:` operators — replacing the synchronous corpus scan, plus the SearchOverlay keyboard UX and the SessionView scroll-target race fix.

**Architecture:** `src/main/searchindex.js` owns a `node:sqlite` DatabaseSync at `userData/search-index.db` (records + external-content FTS5 + triggers), with per-file `offset`/`itemCount` persisted so indexing resumes mid-file across restarts. Boot reconciliation + live `onFileChanged` events from SessionIndex feed a queue drained one file per `setImmediate` turn. The legacy `search.js` scan stays as the fallback when `node:sqlite` is unavailable.

**Tech Stack:** node:sqlite (bundled, verified on Electron 42's Node v24.15.0 AND system Node v24.13.0 — no native modules), node:test. No new dependencies.

**Spec:** docs/superpowers/specs/2026-06-11-fts-search-design.md.

**Branch:** create `feat/fts-search` off main before Task 1. Working dir: `C:\Users\james\Projects\Flux Terminal`. Run all commands from there.

**Conventions (do not deviate):**
- Every new `src/main/*.js` module MUST be added to `electron.vite.config.mjs` rollupOptions inputs.
- node:test + assert + DI. `npm test` runs everything (232 passing at branch start). Tests will print a Node `ExperimentalWarning: SQLite` line — harmless, ignore it.
- IPC handlers return `{ ok, error }`.
- The hit DTO is a frozen contract: `{ sessionId, project, title, msgIdx, role, ts, snippet, matchStart, matchEnd }` with `msgIdx` = parser timeline index.

---

### Task 1: tailer startOffset + SessionIndex onFileChanged

**Files:**
- Modify: `src/main/tailer.js` (startOffset option)
- Modify: `src/main/sessionindex.js` (onFileChanged callback)
- Test: `tests/tailer.test.js`, `tests/sessionindex.test.js` (extend both)

- [ ] **Step 1: Write the failing tests**

Append to `tests/tailer.test.js`:

```js
test('startOffset resumes a tail mid-file (search index restart case)', () => {
  const file = tmpFile()
  const first = '{"a":1}\n'
  fs.writeFileSync(file, first + '{"a":2}\n')
  const tail = createTail(file, { startOffset: Buffer.byteLength(first, 'utf8') })
  const d = tail.readDelta()
  assert.deepStrictEqual(d.objects.map((o) => o.a), [2])
})
```

Append to `tests/sessionindex.test.js`:

```js
test('onFileChanged fires on updates and evictions', async () => {
  const world = makeWorld()
  const file = world.addFile('s1', [userLine('hi')], 500)
  const changed = []
  const { idx } = indexFor(world, { overrides: { onFileChanged: (f, info) => changed.push({ f, deleted: !!(info && info.deleted) }) } })
  idx.start()
  await tick()
  assert.ok(changed.find((c) => c.f === file && !c.deleted)) // boot index counts as a change

  world.append(file, [assistantLine('m1', 'more')], 700)
  idx._update(file)
  assert.strictEqual(changed.filter((c) => c.f === file && !c.deleted).length, 2)

  world.files.delete(file)
  idx._sweep()
  assert.ok(changed.find((c) => c.f === file && c.deleted))
  idx.dispose()
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test`
Expected: the startOffset test FAILS (objects `[1, 2]` — option ignored); the onFileChanged test FAILS (`changed` empty). 232 pre-existing pass.

- [ ] **Step 3: Implement**

In `src/main/tailer.js`, change the factory signature line from:

```js
function createTail(file, { fsImpl = fs } = {}) {
  let offset = 0
```

to:

```js
function createTail(file, { fsImpl = fs, startOffset = 0 } = {}) {
  let offset = startOffset
```

In `src/main/sessionindex.js`:
1. In the constructor, after `this.onWatchAppend = opts.onWatchAppend || (() => {})`, add:

```js
    this.onFileChanged = opts.onFileChanged || (() => {}) // (file, { deleted }) — search index feed
```

2. At the end of `_update(file)`, after `this._scheduleSave()`, add:

```js
    this.onFileChanged(file, { deleted: false })
```

3. In `_evict(file)`, inside the `if` block (after `this._scheduleSave()`), add:

```js
      this.onFileChanged(file, { deleted: true })
```

- [ ] **Step 4: Run tests**

Run: `npm test` → ALL pass (234 = 232 + 2 new).

- [ ] **Step 5: Commit**

```powershell
git add tests/tailer.test.js tests/sessionindex.test.js src/main/tailer.js src/main/sessionindex.js
git commit -m "feat(index): tail startOffset + onFileChanged hook (search-index feed)"
```

---

### Task 2: searchindex.js pure helpers — parseQuery, entriesFromItems, snippetToOffsets

**Files:**
- Create: `src/main/searchindex.js` (pure helpers only this task; the class arrives in Task 3)
- Modify: `electron.vite.config.mjs` (add `searchindex` input)
- Test: `tests/searchindex.test.js` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/searchindex.test.js`:

```js
// tests/searchindex.test.js
const test = require('node:test')
const assert = require('node:assert')
const { parseQuery, ftsMatchFor, entriesFromItems, snippetToOffsets, MARK_L, MARK_R } = require('../src/main/searchindex')

// ---- parseQuery ---------------------------------------------------------------

test('parseQuery splits operators from terms', () => {
  const r = parseQuery('null__NotFound tool:Bash role:tool_result project:pgw file:flow error:true deploy')
  assert.deepStrictEqual(r.terms, ['null__NotFound', 'deploy'])
  assert.deepStrictEqual(r.filters, { tool: 'Bash', role: 'tool_result', project: 'pgw', file: 'flow', isError: true })
})

test('parseQuery edge shapes', () => {
  assert.deepStrictEqual(parseQuery(''), { terms: [], filters: {} })
  assert.deepStrictEqual(parseQuery('   '), { terms: [], filters: {} })
  assert.deepStrictEqual(parseQuery('tool:'), { terms: ['tool:'], filters: {} }) // empty value = plain term
  assert.deepStrictEqual(parseQuery('error:false').filters, { isError: false })
  assert.deepStrictEqual(parseQuery('session:abc-123').filters, { sessionId: 'abc-123' })
})

test('ftsMatchFor quotes terms (FTS syntax injection dies) and prefix-stars them', () => {
  assert.strictEqual(ftsMatchFor(['hello', 'wor"ld']), '"hello"* "wor""ld"*')
  assert.strictEqual(ftsMatchFor(['NEAR(']), '"NEAR("*') // operators neutralized by quoting
})

// ---- entriesFromItems -----------------------------------------------------------

test('entriesFromItems mirrors the legacy extraction rules with timeline-aligned indices', () => {
  const items = [
    { kind: 'user', ts: 't0', text: 'find the bug' },
    { kind: 'image', ts: 't1', data: 'AAAA', mediaType: 'image/png' }, // skipped, but still counts an index
    { kind: 'tool_use', ts: 't2', toolName: 'Bash', toolInput: 'ls -la' },
    { kind: 'tool_result', ts: 't3', isError: true, text: 'boom' },
    { kind: 'text', ts: 't4', text: '   ' } // whitespace only — skipped
  ]
  const entries = entriesFromItems(items, 10)
  assert.deepStrictEqual(entries.map((e) => e.msgIdx), [10, 12, 13])
  assert.strictEqual(entries[0].role, 'user')
  assert.strictEqual(entries[1].text, 'Bash ls -la')
  assert.strictEqual(entries[1].tool, 'Bash')
  assert.strictEqual(entries[2].isError, 1)
  assert.strictEqual(entries[0].isError, 0)
})

test('entriesFromItems caps entry text at 2048 chars', () => {
  const entries = entriesFromItems([{ kind: 'text', ts: null, text: 'x'.repeat(5000) }], 0)
  assert.strictEqual(entries[0].text.length, 2049) // 2048 + ellipsis
})

// ---- snippetToOffsets -----------------------------------------------------------

test('snippetToOffsets maps the first marked region and strips all markers', () => {
  const marked = 'before ' + MARK_L + 'match' + MARK_R + ' middle ' + MARK_L + 'again' + MARK_R
  const r = snippetToOffsets(marked)
  assert.strictEqual(r.snippet, 'before match middle again')
  assert.strictEqual(r.snippet.slice(r.matchStart, r.matchEnd), 'match')
})

test('snippetToOffsets tolerates no markers', () => {
  const r = snippetToOffsets('plain text')
  assert.deepStrictEqual(r, { snippet: 'plain text', matchStart: 0, matchEnd: 0 })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '../src/main/searchindex'`. 234 pre-existing pass.

- [ ] **Step 3: Create src/main/searchindex.js (helpers only — the class is appended in Task 3)**

```js
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
```

- [ ] **Step 4: Register in electron.vite.config.mjs**

```js
          searchindex: resolve('src/main/searchindex.js'),
```

- [ ] **Step 5: Run tests** → ALL pass (241 = 234 + 7 new).

- [ ] **Step 6: Commit**

```powershell
git add tests/searchindex.test.js src/main/searchindex.js electron.vite.config.mjs
git commit -m "feat(search): query parsing, entry extraction, snippet offsets (pure helpers)"
```

---

### Task 3: the SearchIndex class — schema, reconcile, queue, query

**Files:**
- Modify: `src/main/searchindex.js` (append the class + schema + defaultOpenDb)
- Test: `tests/searchindex.test.js` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `tests/searchindex.test.js`:

```js
// ---- SearchIndex (in-memory DB, scripted world, manual tick draining) ----------
const { SearchIndex } = require('../src/main/searchindex')
const { DatabaseSync } = require('node:sqlite')

function searchWorld() {
  const world = {
    files: new Map(), // file -> { meta, lines, tailsMade: [] }
    ticks: [] // captured enqueueTick callbacks — tests drain manually
  }
  world.addFile = (name, lines, mtimeMs) => {
    const file = 'P:\\proj\\' + name + '.jsonl'
    world.files.set(file, {
      meta: { sessionId: name, file, projectDir: 'proj', projectApprox: 'P:\\proj', mtimeMs, size: lines.join('').length },
      lines: lines.slice(),
      tailsMade: []
    })
    return file
  }
  world.append = (file, lines, mtimeMs) => {
    const f = world.files.get(file)
    f.lines.push(...lines)
    f.meta.mtimeMs = mtimeMs
    f.meta.size = f.lines.join('').length
  }
  world.drain = () => {
    while (world.ticks.length) world.ticks.shift()()
  }
  return world
}

function lineFor(text, role = 'user') {
  if (role === 'user') return { type: 'user', message: { content: text }, timestamp: '2026-06-11T10:00:00Z' }
  return {
    type: 'assistant',
    timestamp: '2026-06-11T10:00:05Z',
    message: { id: 'm' + Math.abs(hash(text)), model: 'claude-test', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text }] }
  }
}
function hash(s) {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0
  return h
}

function searchIndexFor(world, opts = {}) {
  const db = opts.db || new DatabaseSync(':memory:')
  const progress = []
  const si = new SearchIndex({
    openDb: opts.openDb || (() => db),
    dbPath: null,
    listFiles: () => [...world.files.values()].map((f) => ({ ...f.meta })),
    makeTail: (file, startOffset) => {
      const f = world.files.get(file)
      if (f) f.tailsMade.push(startOffset)
      // lines consumed by index, not bytes: offset = number of lines consumed
      let consumed = startOffset
      return {
        get offset() {
          return consumed
        },
        readDelta() {
          const fw = world.files.get(file)
          if (!fw) throw new Error('ENOENT ' + file)
          if (fw.lines.length < consumed) {
            consumed = 0
            return { reset: true, objects: [], parseErrors: 0, size: fw.meta.size, mtimeMs: fw.meta.mtimeMs }
          }
          const objects = fw.lines.slice(consumed)
          consumed = fw.lines.length
          return { reset: false, objects: objects.slice(), parseErrors: 0, size: fw.meta.size, mtimeMs: fw.meta.mtimeMs }
        }
      }
    },
    enqueueTick: (fn) => world.ticks.push(fn),
    onProgress: (p) => progress.push(p)
  })
  return { si, db, progress }
}

test('reconcile indexes every file once and FTS queries hit with the legacy DTO', () => {
  const world = searchWorld()
  world.addFile('s1', [lineFor('the quick brown fox'), lineFor('jumped over', 'assistant')], 500)
  world.addFile('s2', [lineFor('nothing relevant here')], 400)
  const { si } = searchIndexFor(world)
  si.start()
  world.drain()

  const hits = si.query('quick fox')
  assert.strictEqual(hits.length, 1)
  const h = hits[0]
  assert.strictEqual(h.sessionId, 's1')
  assert.strictEqual(h.msgIdx, 0)
  assert.strictEqual(h.role, 'user')
  assert.ok(typeof h.snippet === 'string' && h.snippet.includes('quick'))
  assert.strictEqual(h.snippet.slice(h.matchStart, h.matchEnd).toLowerCase(), 'quick')
  assert.deepStrictEqual(Object.keys(h).sort(), ['matchEnd', 'matchStart', 'msgIdx', 'project', 'role', 'sessionId', 'snippet', 'title', 'ts'])
})

test('incremental: an appended delta indexes from the persisted offset with correct msgIdx', () => {
  const world = searchWorld()
  const file = world.addFile('s1', [lineFor('first prompt')], 500)
  const { si } = searchIndexFor(world)
  si.start()
  world.drain()
  assert.deepStrictEqual(world.files.get(file).tailsMade, [0])

  world.append(file, [lineFor('zebra cadenza', 'assistant')], 700)
  si.enqueue(file)
  world.drain()
  assert.deepStrictEqual(world.files.get(file).tailsMade, [0, 1]) // resumed at offset 1, not 0
  const hits = si.query('zebra')
  assert.strictEqual(hits.length, 1)
  assert.strictEqual(hits[0].msgIdx, 1)
})

test('restart resumes from the DB-persisted offset (no re-index)', () => {
  const world = searchWorld()
  const db = new DatabaseSync(':memory:')
  const file = world.addFile('s1', [lineFor('alpha')], 500)
  const a = searchIndexFor(world, { db })
  a.si.start()
  world.drain()

  world.append(file, [lineFor('bravo', 'assistant')], 700)
  const b = searchIndexFor(world, { db }) // "restart": same DB, fresh instance
  b.si.start()
  world.drain()
  assert.deepStrictEqual(world.files.get(file).tailsMade, [0, 1])
  assert.strictEqual(b.si.query('alpha').length, 1) // old rows survived
  assert.strictEqual(b.si.query('bravo').length, 1)
})

test('a reset (truncated file) purges and re-indexes; a deleted file purges', () => {
  const world = searchWorld()
  // two lines so the 1-line replacement is a genuine shrink (the fake tail
  // detects reset by line count: lines.length < consumed)
  const file = world.addFile('s1', [lineFor('old content here'), lineFor('second old line', 'assistant')], 500)
  const { si } = searchIndexFor(world)
  si.start()
  world.drain()
  assert.strictEqual(si.query('old').length, 2)

  world.files.get(file).lines = [lineFor('replacement text')]
  world.files.get(file).meta.mtimeMs = 900
  si.enqueue(file)
  world.drain()
  assert.strictEqual(si.query('old').length, 0)
  assert.strictEqual(si.query('replacement').length, 1)

  world.files.delete(file)
  si.remove(file)
  assert.strictEqual(si.query('replacement').length, 0)
})

test('operator queries filter and operator-only queries work without terms', () => {
  const world = searchWorld()
  world.addFile('s1', [
    lineFor('deploy the flow'),
    { type: 'assistant', timestamp: '2026-06-11T10:00:05Z', message: { id: 'mt', model: 'claude-test', usage: {}, content: [{ type: 'tool_use', name: 'Bash', input: { command: 'sf deploy' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'deploy FAILED hard' }] } }
  ], 500)
  const { si } = searchIndexFor(world)
  si.start()
  world.drain()

  assert.strictEqual(si.query('deploy').length, 3)
  assert.strictEqual(si.query('deploy role:user').length, 1)
  assert.strictEqual(si.query('deploy tool:bash').length, 1) // tool match is case-insensitive
  const errOnly = si.query('error:true')
  assert.strictEqual(errOnly.length, 1)
  assert.strictEqual(errOnly[0].role, 'tool_result')
  assert.strictEqual(si.query('deploy file:s1').length, 3)
  assert.strictEqual(si.query('deploy file:nope').length, 0)
})

test('openDb that throws once recovers; twice leaves the index unavailable with empty queries', () => {
  const world = searchWorld()
  world.addFile('s1', [lineFor('hello')], 500)
  let calls = 0
  const good = new DatabaseSync(':memory:')
  const flaky = searchIndexFor(world, {
    openDb: () => {
      calls++
      if (calls === 1) throw new Error('corrupt')
      return good
    }
  })
  flaky.si.start()
  world.drain()
  assert.strictEqual(flaky.si.available, true)
  assert.strictEqual(flaky.si.query('hello').length, 1)

  const dead = searchIndexFor(world, { openDb: () => { throw new Error('no sqlite') } })
  dead.si.start()
  assert.strictEqual(dead.si.available, false)
  assert.deepStrictEqual(dead.si.query('hello'), [])
})

test('progress fires during a multi-file build', () => {
  const world = searchWorld()
  for (let i = 0; i < 6; i++) world.addFile('s' + i, [lineFor('content ' + i)], 100 + i)
  const { si, progress } = searchIndexFor(world)
  si.start()
  world.drain()
  assert.ok(progress.length >= 6)
  assert.deepStrictEqual(progress[progress.length - 1], { done: 6, total: 6 })
})
```

NOTE on the fake tails: they count offsets in LINES, not bytes — the SearchIndex must treat `offset` as an opaque number it persists and hands back to `makeTail`, never doing arithmetic on it. That's the contract this fake enforces.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL (`SearchIndex is not a constructor`). 241 pre-existing pass.

- [ ] **Step 3: Append the class to src/main/searchindex.js**

Add these requires at the top of the file (after the header comment):

```js
const fs = require('fs')
const path = require('path')
const sessionsMod = require('./sessions')
const { freshModel, applyEvent } = require('./parser')
const { createTail } = require('./tailer')
```

Append below `snippetToOffsets` (above module.exports):

```js
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
  db.exec('PRAGMA journal_mode=WAL')
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
    try {
      const db = this.openDb(this.dbPath)
      db.exec(SCHEMA)
      return db
    } catch {
      // corrupt DB file — delete and start over (one rebuild beats a dead search)
      if (this.dbPath) {
        try {
          this.fsImpl.unlinkSync(this.dbPath)
        } catch {
          /* ignore */
        }
      }
      const db = this.openDb(this.dbPath)
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
    if (delta.reset) {
      this.db.prepare('DELETE FROM records WHERE file = ?').run(file)
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
      sql = `SELECT r.sessionId, r.msgIdx, r.role, r.ts, f.project, f.title,
               snippet(records_fts, 0, char(1), char(2), '…', 40) AS marked
             FROM records_fts
             JOIN records r ON r.id = records_fts.rowid
             JOIN files f ON f.file = r.file`
      where.push('records_fts MATCH ?')
      params.push(ftsMatchFor(terms))
    } else {
      sql = `SELECT r.sessionId, r.msgIdx, r.role, r.ts, r.text AS marked, f.project, f.title
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
```

Extend module.exports:

```js
module.exports = {
  parseQuery, ftsMatchFor, entriesFromItems, snippetToOffsets,
  MARK_L, MARK_R, ENTRY_TEXT_CAP, SearchIndex
}
```

- [ ] **Step 4: Run tests** → ALL pass (248 = 241 + 7 new).

- [ ] **Step 5: Commit**

```powershell
git add tests/searchindex.test.js src/main/searchindex.js
git commit -m "feat(search): SearchIndex - FTS5 schema, reconcile/queue, restart-safe incremental indexing, operator queries"
```

---

### Task 4: Main wiring — FTS serves search:query, legacy scan as fallback

**Files:**
- Modify: `src/main/index.js`

- [ ] **Step 1: Wire it**

1. Add the require: `const { SearchIndex } = require('./searchindex')`
2. Add `let searchIndex = null` next to the other singletons.
3. Replace the `search:query` handler with:

```js
ipcMain.handle('search:query', (_e, { query }) => {
  try {
    if (searchIndex && searchIndex.available) {
      return { ok: true, hits: searchIndex.query(query) }
    }
    // Fallback: node:sqlite unavailable — the legacy synchronous scan.
    const { listSessionFiles } = require('./sessions')
    const sessions = listSessionFiles()
    const hits = search(query, sessions, {
      onProgress: (p) => emit('search:progress', p)
    })
    return { ok: true, hits }
  } catch (err) {
    return { ok: false, error: err.message, hits: [] }
  }
})
```

4. In `whenReady`, change the `sessionIndex = new SessionIndex({...})` construction to add the feed callback (searchIndex is constructed right after; the guard covers boot-sweep events that fire before it exists — the search index's own reconcile catches those):

```js
  sessionIndex = new SessionIndex({
    cachePath: path.join(app.getPath('userData'), 'session-index.json'),
    onSessions: (sessions) => emit('sessions:changed', { sessions }),
    onWatchRefresh: (payload) => emit('session:refresh', payload),
    onWatchAppend: (payload) => emit('session:append', payload),
    onFileChanged: (file, info) => {
      if (!searchIndex) return
      if (info && info.deleted) searchIndex.remove(file)
      else searchIndex.enqueue(file)
    }
  })
  sessionIndex.start()

  searchIndex = new SearchIndex({
    dbPath: path.join(app.getPath('userData'), 'search-index.db'),
    onProgress: (p) => emit('search:progress', p)
  })
  searchIndex.start()
```

5. In `window-all-closed`, after `if (sessionIndex) sessionIndex.dispose()`, add:

```js
  if (searchIndex) searchIndex.dispose()
```

- [ ] **Step 2: Tests + build + smoke**

Run: `npm test` (248 expected — no new tests; this is wiring) and `npm run build` (out/main/searchindex.js exists).
Dev sanity:

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
$env:FLUX_SMOKE_SHOT = "C:\tmp\flux-fts-wiring.png"
npx electron .
Remove-Item env:FLUX_SMOKE_SHOT
```

Expected: `FLUX_SMOKE_SHOT_OK`; READ the png — normal app. Then confirm the index was built: `Get-ChildItem "$env:APPDATA\flux-terminal\search-index.db"` exists and is large (tens of MB on this corpus).

- [ ] **Step 3: Commit**

```powershell
git add src/main/index.js
git commit -m "feat(search): serve search:query from the FTS index (legacy scan as fallback)"
```

---

### Task 5: SearchOverlay keyboard UX + SessionView scroll-race fix

**Files:**
- Create: `src/renderer/src/lib/searchnav.js` (pure)
- Modify: `src/renderer/src/components/SearchOverlay.jsx`
- Modify: `src/renderer/src/components/SessionView.jsx` (scroll-target effect + auto-scroll guard)
- Modify: `src/renderer/src/index.css` (selected-hit + hint styles)
- Test: `tests/searchnav.test.js` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/searchnav.test.js`:

```js
// tests/searchnav.test.js
const test = require('node:test')
const assert = require('node:assert')
const { groupHits, moveSelection } = require('../src/renderer/src/lib/searchnav.js')

test('groupHits groups by session preserving order and returns a flat list aligned with rendering', () => {
  const sessions = [{ sessionId: 'a', file: 'F:\\a.jsonl', title: 'Session A' }]
  const hits = [
    { sessionId: 'a', msgIdx: 1, title: null, project: 'P' },
    { sessionId: 'b', msgIdx: 5, title: 'B title', project: 'Q' },
    { sessionId: 'a', msgIdx: 9, title: null, project: 'P' }
  ]
  const { grouped, flat } = groupHits(hits, sessions)
  assert.strictEqual(grouped.length, 2)
  assert.strictEqual(grouped[0].sessionId, 'a')
  assert.strictEqual(grouped[0].title, 'Session A') // resolved from the live list
  assert.strictEqual(grouped[0].file, 'F:\\a.jsonl')
  assert.strictEqual(grouped[0].hits.length, 2)
  assert.strictEqual(grouped[1].file, null) // unknown session — openById synthesis handles it upstream? no file → falls back
  // flat order matches render order: group 0 hits, then group 1 hits
  assert.deepStrictEqual(flat.map((f) => [f.sessionId, f.hit.msgIdx]), [['a', 1], ['a', 9], ['b', 5]])
})

test('moveSelection clamps to bounds and handles empty lists', () => {
  assert.strictEqual(moveSelection(5, 0, 1), 1)
  assert.strictEqual(moveSelection(5, 4, 1), 4)
  assert.strictEqual(moveSelection(5, 0, -1), 0)
  assert.strictEqual(moveSelection(0, 0, 1), -1)
  assert.strictEqual(moveSelection(3, -1, 1), 0) // first move selects the first hit
})
```

- [ ] **Step 2: Run to verify failure** (`Cannot find module ... searchnav.js`), 248 pre-existing pass.

- [ ] **Step 3: Create src/renderer/src/lib/searchnav.js**

```js
// Pure helpers for SearchOverlay keyboard navigation (unit-tested without React).

/** Group hits by session (render order) + a flat selection list aligned with it. */
export function groupHits(hits, sessions) {
  const grouped = []
  const seen = new Map()
  for (const h of hits) {
    if (!seen.has(h.sessionId)) {
      const meta = (sessions || []).find((s) => s.sessionId === h.sessionId) || {}
      const group = {
        sessionId: h.sessionId,
        project: h.project,
        title: h.title || meta.title || h.sessionId,
        file: meta.file || null,
        hits: []
      }
      seen.set(h.sessionId, group)
      grouped.push(group)
    }
    seen.get(h.sessionId).hits.push(h)
  }
  const flat = []
  for (const g of grouped) {
    for (const hit of g.hits) flat.push({ sessionId: g.sessionId, file: g.file, hit })
  }
  return { grouped, flat }
}

/** Clamped selection movement; -1 means nothing selected. */
export function moveSelection(flatLen, current, delta) {
  if (!flatLen) return -1
  if (current < 0) return delta > 0 ? 0 : 0
  return Math.max(0, Math.min(flatLen - 1, current + delta))
}
```

- [ ] **Step 4: Run tests** → ALL pass (250).

- [ ] **Step 5: Rework SearchOverlay.jsx**

Replace the whole file with:

```jsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { groupHits, moveSelection } from '../lib/searchnav.js'

// Reopening the overlay restores the previous results ("back to results"
// after jumping to a hit). Module-level on purpose: survives unmount.
let lastState = { query: '', hits: [] }

/**
 * Cross-session search overlay (FTS-backed).
 * Ctrl+Shift+F from App.jsx; Esc closes (works from any focus inside the
 * modal); ArrowUp/Down + Enter navigate hits. Operators: role: tool: file:
 * project: error:true. onOpen(sessionId, file, msgIdx) navigates to the hit.
 */
export default function SearchOverlay({ sessions, onOpen, onClose }) {
  const [query, setQuery] = useState(lastState.query)
  const [hits, setHits] = useState(lastState.hits)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total } or null
  const [selected, setSelected] = useState(lastState.hits.length ? 0 : -1)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const selectedRef = useRef(null)

  useEffect(() => {
    inputRef.current && inputRef.current.focus()
    const off = window.flux.search.onProgress((p) => setProgress(p))
    return () => {
      off()
      clearTimeout(debounceRef.current)
    }
  }, [])

  // Keep the restore cache current.
  useEffect(() => {
    lastState = { query, hits }
  }, [query, hits])

  // Keep the selected hit visible.
  useEffect(() => {
    if (selectedRef.current) selectedRef.current.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const runSearch = useCallback((q) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setHits([])
      setSelected(-1)
      setBusy(false)
      setProgress(null)
      return
    }
    setBusy(true)
    window.flux.search.query(trimmed).then((res) => {
      setBusy(false)
      setProgress(null)
      const next = res && res.ok ? res.hits || [] : []
      setHits(next)
      setSelected(next.length ? 0 : -1)
    })
  }, [])

  const onChange = (e) => {
    const q = e.target.value
    setQuery(q)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(q), 250)
  }

  const { grouped, flat } = groupHits(hits, sessions)

  const openFlat = useCallback(
    (f) => {
      if (!f) return
      onOpen(f.sessionId, f.file, f.hit.msgIdx)
      onClose()
    },
    [onOpen, onClose]
  )

  // Modal-level keys: Esc always closes; arrows/Enter drive the selection even
  // while the input has focus.
  const onModalKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => moveSelection(flat.length, s, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => moveSelection(flat.length, s, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      openFlat(flat[selected] || flat[0])
    }
  }

  let flatIndex = -1

  return (
    <div className="search-overlay-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="search-overlay-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Cross-session search"
        onKeyDown={onModalKeyDown}
      >
        <div className="search-overlay-input-row">
          <span className="search-overlay-icon">⌕</span>
          <input
            ref={inputRef}
            className="search-overlay-input"
            type="text"
            placeholder="Search all sessions…  (Ctrl+Shift+F)"
            value={query}
            onChange={onChange}
            spellCheck={false}
          />
          {busy && <span className="search-overlay-spinner" aria-label="Searching" />}
          <button className="search-overlay-close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="search-overlay-ops">
          role:user&thinsp;·&thinsp;tool:Bash&thinsp;·&thinsp;file:&thinsp;·&thinsp;project:&thinsp;·&thinsp;error:true
          <span className="search-overlay-ops-kbd">↑↓ select · Enter open · Esc close</span>
        </div>

        {progress && (
          <div className="search-overlay-progress">
            Indexing sessions… {progress.done}/{progress.total}
          </div>
        )}

        <div className="search-overlay-results">
          {!query.trim() && (
            <div className="search-overlay-hint">
              Type to search across all session transcripts.
              <span className="search-overlay-hint-kbd">Ctrl+Shift+F</span> to open,
              <span className="search-overlay-hint-kbd">Esc</span> to close.
            </div>
          )}

          {query.trim() && !busy && hits.length === 0 && !progress && (
            <div className="search-overlay-hint">No results for &ldquo;{query.trim()}&rdquo;</div>
          )}

          {grouped.map((group) => (
            <div key={group.sessionId} className="search-group">
              <div className="search-group-header">
                <span className="search-group-project">{projectName(group.project)}</span>
                <span className="search-group-sep">·</span>
                <span className="search-group-title">{group.title}</span>
              </div>
              {group.hits.map((h, i) => {
                flatIndex++
                const isSelected = flatIndex === selected
                const idx = flatIndex
                return (
                  <button
                    key={i}
                    ref={isSelected ? selectedRef : null}
                    className={'search-hit' + (isSelected ? ' selected' : '')}
                    onMouseEnter={() => setSelected(idx)}
                    onClick={() => openFlat(flat[idx])}
                  >
                    <span className={'search-hit-role role-' + h.role}>{h.role}</span>
                    <span className="search-hit-snippet">
                      {h.snippet.slice(0, h.matchStart)}
                      <mark className="search-hit-mark">{h.snippet.slice(h.matchStart, h.matchEnd)}</mark>
                      {h.snippet.slice(h.matchEnd)}
                    </span>
                    {h.ts && <span className="search-hit-time">{shortDate(h.ts)}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function projectName(p) {
  if (!p) return '(unknown)'
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 2) return parts.join('/')
  return parts.slice(-2).join('/')
}

function shortDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
```

(Notes: the old per-input `onKeyDown` Esc handler is replaced by the modal-level one; the literal `?`/`x` placeholder glyphs become `⌕`/`✕`; results restore from `lastState` when reopened — typing or re-running replaces them.)

- [ ] **Step 6: Fix the SessionView scroll race**

In `src/renderer/src/components/SessionView.jsx`:

1. Add a ref next to the other refs (near `prevSession`):

```js
  const consumedScrollKey = useRef(null)
```

2. Replace the scroll-target effect (the one with deps `[scrollTarget]` and the eslint-disable comment) with:

```js
  // Scroll to a specific timeline index and briefly flash it.
  // scrollTarget = { idx, key } — runs when the target changes AND re-runs when
  // detail finishes loading (jumping into a not-yet-open session used to bail
  // silently on the loading early-return). consumedScrollKey stops live
  // appends from re-scrolling an already-consumed target.
  useEffect(() => {
    if (scrollTarget == null || scrollTarget.idx == null) return
    if (consumedScrollKey.current === scrollTarget.key) return
    if (!detail || detail.ok === false) return // wait for load; deps re-run us
    const el = scrollRef.current
    if (!el) return
    const item = el.querySelectorAll('.tl-item')[scrollTarget.idx]
    if (!item) return
    consumedScrollKey.current = scrollTarget.key
    autoFollow.current = false
    setShowJump(false)
    item.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlashIdx(scrollTarget.idx)
    const timer = setTimeout(() => setFlashIdx(null), 900)
    return () => clearTimeout(timer)
  }, [scrollTarget, detail]) // eslint-disable-line react-hooks/exhaustive-deps
```

3. In the auto-scroll effect above it (the one keyed on `[sessionId, timelineLen, pending, sendState, detail]`), guard the new-session snap so it doesn't fight an unconsumed jump target. Change:

```js
    if (sessionId !== prevSession.current) {
      prevSession.current = sessionId
      autoFollow.current = true
      setShowJump(false)
      // wait a frame for the DOM to paint the (possibly long) timeline
      requestAnimationFrame(scrollToBottom)
    } else if (autoFollow.current) {
```

to:

```js
    if (sessionId !== prevSession.current) {
      prevSession.current = sessionId
      const pendingJump = scrollTarget != null && consumedScrollKey.current !== scrollTarget.key
      autoFollow.current = !pendingJump
      setShowJump(false)
      // wait a frame for the DOM to paint the (possibly long) timeline —
      // unless a search jump is about to scroll to its own target.
      if (!pendingJump) requestAnimationFrame(scrollToBottom)
    } else if (autoFollow.current) {
```

- [ ] **Step 7: Styles** — in `src/renderer/src/index.css`, find the `.search-hit` rule block and add after it:

```css
.search-hit.selected {
  background: var(--bg-hover);
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
.search-overlay-ops {
  display: flex;
  justify-content: space-between;
  padding: 4px 14px 6px;
  font-size: 11px;
  color: var(--fg-dim);
  border-bottom: 1px solid var(--border);
}
.search-overlay-ops-kbd {
  opacity: 0.8;
}
```

(If a var name differs — e.g. no `--fg-dim` — match whatever the existing `.search-overlay-hint` rule uses; check before inventing variables.)

- [ ] **Step 8: Tests + build + smoke** — `npm test` (250), `npm run build`, then both standard smokes (main + session views, kill stray electron first) and READ the screenshots: app renders normally.

- [ ] **Step 9: Commit**

```powershell
git add tests/searchnav.test.js src/renderer/src/lib/searchnav.js src/renderer/src/components/SearchOverlay.jsx src/renderer/src/components/SessionView.jsx src/renderer/src/index.css
git commit -m "feat(search): keyboard-first overlay (arrows/Enter/Esc, restored results, operator hints) + scroll-race fix"
```

---

### Task 6: E2E verification on the real corpus + README

**Files:**
- Modify: `src/main/index.js` (smoke harness: FLUX_SMOKE_VIEW=search support)
- Modify: `README.md`

- [ ] **Step 1: Real-corpus build + query proof.** Run this script and paste its full output (uses real defaults — real transcripts, a temp DB):

```powershell
node -e "
const path = require('path');
const os = require('os');
const { SearchIndex } = require('./src/main/searchindex');
const dbPath = path.join(os.tmpdir(), 'flux-fts-proof-' + Date.now() + '.db');
const t0 = Date.now();
let last = null;
const si = new SearchIndex({ dbPath, onProgress: (p) => { last = p } });
si.start();
const wait = () => {
  if (si.draining || si.queue.length) { setImmediate(wait); return }
  const buildMs = Date.now() - t0;
  const q0 = Date.now();
  const plain = si.query('null__NotFound');
  const tool = si.query('tool:Bash deploy');
  const role = si.query('role:user flux');
  const err = si.query('error:true');
  const queryMs = Date.now() - q0;
  console.log('build:', buildMs + 'ms', '| indexed:', JSON.stringify(last));
  console.log('queries (4 total):', queryMs + 'ms');
  console.log('null__NotFound hits:', plain.length, plain[0] ? '| top: ' + plain[0].snippet.slice(0, 80) : '');
  console.log('tool:Bash deploy hits:', tool.length);
  console.log('role:user flux hits:', role.length);
  console.log('error:true hits:', err.length);
  const fs = require('fs');
  console.log('db size:', Math.round(fs.statSync(dbPath).size / 1024 / 1024 * 10) / 10 + 'MB');
  si.dispose();
};
wait();
"
```

PASS criteria: build completes (expect seconds, not minutes); the 4 queries answer in low milliseconds combined; `null__NotFound` (a string that exists in this user's PGW transcripts) returns > 0 hits; `tool:Bash deploy` returns plausible filtered counts. Report every number.

- [ ] **Step 2: Smoke-harness search view.** In the FLUX_SMOKE_SHOT block of `src/main/index.js`, add a branch after the `settings` one:

```js
        } else if (process.env.FLUX_SMOKE_VIEW === 'search') {
          await wc.executeJavaScript(
            "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, bubbles: true }))"
          )
          if (process.env.FLUX_SMOKE_QUERY) {
            await wait(800)
            await wc.executeJavaScript(`(() => {
              const input = document.querySelector('.search-overlay-input')
              if (!input) return
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
              setter.call(input, ${JSON.stringify(process.env.FLUX_SMOKE_QUERY)})
              input.dispatchEvent(new Event('input', { bubbles: true }))
            })()`)
            await wait(2000)
          }
        }
```

- [ ] **Step 3: Overlay screenshot with real results:**

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
npm run build
$env:FLUX_SMOKE_SHOT = "C:\tmp\flux-fts-overlay.png"
$env:FLUX_SMOKE_VIEW = "search"
$env:FLUX_SMOKE_QUERY = "flux terminal"
npx electron .
Remove-Item env:FLUX_SMOKE_SHOT; Remove-Item env:FLUX_SMOKE_VIEW; Remove-Item env:FLUX_SMOKE_QUERY
```

READ the png: the overlay must show grouped results with highlighted matches and the first hit visibly selected. If empty: check whether the index finished building (search-index.db in userData), debug, re-run. Report what you see.

- [ ] **Step 4: README roadmap entry** — add after the session-index substrate entry:

```markdown
- [x] **FTS search:** a persistent SQLite FTS5 index (node:sqlite — no native
      modules) built incrementally off the session index, with `role:` `tool:`
      `file:` `project:` `error:true` operators, millisecond queries, and a
      keyboard-first overlay (↑↓/Enter/Esc, restored results). Replaces the
      synchronous corpus scan that froze live terminals; jumping to a hit in an
      unopened session now actually scrolls to it.
```

- [ ] **Step 5: Commit**

```powershell
git add src/main/index.js README.md
git commit -m "feat(search): smoke-harness search view; docs: FTS search in the roadmap"
```
