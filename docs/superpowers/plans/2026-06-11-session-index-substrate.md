# Session-Index Substrate (Freshness Phase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One watcher-driven, incrementally-updated, persisted session index that makes the sidebar live, serves `sessions:list` without parsing, and replaces the whole-file re-parses in the open-session watch and the monitor with O(appended-bytes) work.

**Architecture:** Extract live.js's byte-offset tail into `tailer.js`; build `sessionindex.js` (recursive fs.watch + 15s reconciliation sweep + per-file accumulators with bounded timeline rings + persisted summary cache + a single full-timeline "watch slot" for the open session); rewire main (`sessions:list`, `session:watch/unwatch`, `sessions:changed` push, monitor defaults) and the renderer (a SessionsProvider store, append-merge for the open session, dead-click fixes).

**Tech Stack:** Electron 42 main (CommonJS), React 19 renderer, node:test. No new dependencies.

**Spec:** docs/superpowers/specs/2026-06-11-session-index-substrate-design.md (probes verified 2026-06-11: recursive fs.watch works on this machine; node:sqlite+FTS5 available but NOT used this phase).

**Branch:** create `feat/session-index-substrate` off main before Task 1. Working dir: `C:\Users\james\Projects\Flux Terminal`. Always run commands from there.

**Conventions (do not deviate):**
- Every new `src/main/*.js` module MUST be added to `electron.vite.config.mjs` rollupOptions inputs — the build succeeds without it but the app crashes at boot.
- node:test + assert + dependency injection (no mocking libraries). `npm test` runs everything (212 passing at branch start).
- IPC handlers return `{ ok, error }`; never throw across the bridge.
- Renderer lib modules are ESM (`src/renderer/src/lib/package.json` is `{"type":"module"}`); node:test can `require()` them on Node 24 (the workspace.js tests prove it).

---

### Task 1: tailer.js — extract the incremental byte-offset reader

**Files:**
- Create: `src/main/tailer.js`
- Modify: `src/main/live.js` (use the tailer; no behavior change)
- Modify: `electron.vite.config.mjs` (add `tailer` input)
- Test: `tests/tailer.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/tailer.test.js`:

```js
// tests/tailer.test.js
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createTail } = require('../src/main/tailer')

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-tail-'))
  return path.join(dir, 's.jsonl')
}

test('readDelta returns appended objects across calls, only consuming complete lines', () => {
  const file = tmpFile()
  fs.writeFileSync(file, '{"a":1}\n{"a":2}\n')
  const tail = createTail(file)
  const d1 = tail.readDelta()
  assert.strictEqual(d1.reset, false)
  assert.deepStrictEqual(d1.objects.map((o) => o.a), [1, 2])

  fs.appendFileSync(file, '{"a":3}\n{"a":4')
  const d2 = tail.readDelta()
  assert.deepStrictEqual(d2.objects.map((o) => o.a), [3]) // partial line 4 left for next call

  fs.appendFileSync(file, '}\n')
  const d3 = tail.readDelta()
  assert.deepStrictEqual(d3.objects.map((o) => o.a), [4]) // completed now

  const d4 = tail.readDelta()
  assert.deepStrictEqual(d4.objects, []) // nothing new
})

test('a shrunk file signals reset and restarts from offset 0', () => {
  const file = tmpFile()
  fs.writeFileSync(file, '{"a":1}\n{"a":2}\n{"a":3}\n')
  const tail = createTail(file)
  tail.readDelta()
  fs.writeFileSync(file, '{"b":1}\n') // truncation/rotation
  const r = tail.readDelta()
  assert.strictEqual(r.reset, true)
  assert.deepStrictEqual(r.objects, [])
  const again = tail.readDelta() // caller re-reads from 0 after rebuilding its accumulator
  assert.deepStrictEqual(again.objects.map((o) => o.b), [1])
})

test('readDelta reports size and mtimeMs from the stat it took', () => {
  const file = tmpFile()
  fs.writeFileSync(file, '{"a":1}\n')
  const tail = createTail(file)
  const d = tail.readDelta()
  const st = fs.statSync(file)
  assert.strictEqual(d.size, st.size)
  assert.strictEqual(typeof d.mtimeMs, 'number')
})

test('invalid JSON lines are skipped, multi-byte UTF-8 offsets stay correct', () => {
  const file = tmpFile()
  fs.writeFileSync(file, '{"t":"héllo — ünïcode"}\nnot json\n')
  const tail = createTail(file)
  const d1 = tail.readDelta()
  assert.strictEqual(d1.objects.length, 1)
  fs.appendFileSync(file, '{"t":"next"}\n')
  const d2 = tail.readDelta()
  assert.strictEqual(d2.objects.length, 1)
  assert.strictEqual(d2.objects[0].t, 'next')
})

test('a missing file throws from readDelta (caller decides policy)', () => {
  const tail = createTail(path.join(os.tmpdir(), 'flux-tail-missing', 'nope.jsonl'))
  assert.throws(() => tail.readDelta())
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '../src/main/tailer'`. The 212 pre-existing tests pass.

- [ ] **Step 3: Create src/main/tailer.js**

```js
// src/main/tailer.js
// Incremental byte-offset reader for actively-written JSONL files (extracted
// from live.js so every consumer shares one correct tail implementation).
//
// Contract per readDelta():
//   - reads only bytes appended since the previous call
//   - consumes up to the LAST newline; a partial trailing line is left for the
//     next call (the file is being written while we read)
//   - a shrink (truncation/rotation) returns { reset: true } with no objects
//     and restarts the offset at 0 — the caller rebuilds its accumulator and
//     calls readDelta() again to re-read from the start
//   - stat/read errors throw; the caller decides whether that means "starting",
//     "evict", or "retry next tick"
const fs = require('fs')
const { parseLine } = require('./parser')

function createTail(file, { fsImpl = fs } = {}) {
  let offset = 0
  return {
    get offset() {
      return offset
    },
    /** => { reset, objects, size, mtimeMs } */
    readDelta() {
      const stat = fsImpl.statSync(file)
      if (stat.size < offset) {
        offset = 0
        return { reset: true, objects: [], size: stat.size, mtimeMs: stat.mtimeMs }
      }
      const objects = []
      if (stat.size > offset) {
        const len = stat.size - offset
        const buf = Buffer.alloc(len)
        const fd = fsImpl.openSync(file, 'r')
        try {
          fsImpl.readSync(fd, buf, 0, len, offset)
        } finally {
          fsImpl.closeSync(fd)
        }
        const chunk = buf.toString('utf8')
        const lastNl = chunk.lastIndexOf('\n')
        if (lastNl !== -1) {
          const complete = chunk.slice(0, lastNl)
          offset += Buffer.byteLength(chunk.slice(0, lastNl + 1), 'utf8')
          for (const line of complete.split('\n')) {
            if (!line.trim()) continue
            const o = parseLine(line)
            if (o) objects.push(o)
          }
        }
      }
      return { reset: false, objects, size: stat.size, mtimeMs: stat.mtimeMs }
    }
  }
}

module.exports = { createTail }
```

- [ ] **Step 4: Refactor live.js to use it (no behavior change)**

In `src/main/live.js`:

1. Replace the requires at the top:

```js
const { freshModel, applyEvent, finalize } = require('./parser')
const { findSessionFileById } = require('./sessions')
const { countSubagents } = require('./subagents')
const { createTail } = require('./tailer')
```

(Drop `const fs = require('fs')` and the `parseLine` import — both now live in tailer.js.)

2. In `_reset()` add `this.tail = null` after `this.offset = 0` — then DELETE the `this.offset = 0` line (offset now lives inside the tail).

3. Replace the whole `_tick()` body with:

```js
  _tick() {
    if (!this.sessionId) return
    try {
      if (!this.file) {
        this.file = findSessionFileById(this.sessionId)
        if (!this.file) {
          this._emit('starting')
          return
        }
        this.tail = createTail(this.file)
      }
      let delta = this.tail.readDelta()
      if (delta.reset) {
        // file truncated/rotated — restart accumulation and re-read from 0
        this.model = freshModel(null)
        this.timeline = []
        delta = this.tail.readDelta()
      }
      for (const o of delta.objects) applyEvent(o, this.model, this.timeline)
      if (this.timeline.length > MAX_RECENT) {
        this.timeline = this.timeline.slice(-MAX_RECENT)
      }
      this._emit('live', delta.mtimeMs)
    } catch (err) {
      // File vanished or transient read error — report but keep trying.
      this._emit('starting')
    }
  }
```

- [ ] **Step 5: Register the module in electron.vite.config.mjs**

Add to the rollupOptions `input` map:

```js
          tailer: resolve('src/main/tailer.js'),
```

- [ ] **Step 6: Run tests + build**

Run: `npm test` → ALL pass (217 = 212 + 5 new).
Run: `npm run build` → succeeds; `out/main/tailer.js` exists.

- [ ] **Step 7: Commit**

```powershell
git add tests/tailer.test.js src/main/tailer.js src/main/live.js electron.vite.config.mjs
git commit -m "refactor(live): extract the incremental JSONL tail into tailer.js"
```

---

### Task 2: sessionindex.js core — summaries, cache, incremental updates, reads

**Files:**
- Create: `src/main/sessionindex.js`
- Modify: `electron.vite.config.mjs` (add `sessionindex` input)
- Test: `tests/sessionindex.test.js` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/sessionindex.test.js`:

```js
// tests/sessionindex.test.js
const test = require('node:test')
const assert = require('node:assert')
const { SessionIndex, summarizeModel, RING_MAX } = require('../src/main/sessionindex')
const { freshModel, applyEvent } = require('../src/main/parser')

// ---- scripted world ---------------------------------------------------------
// Files are described as arrays of JSONL objects; fake tails replay them and
// track how many full reads happened so cache-hit behavior is observable.

function userLine(text) {
  return { type: 'user', message: { content: text }, timestamp: '2026-06-11T10:00:00Z' }
}
function assistantLine(id, text) {
  return {
    type: 'assistant',
    timestamp: '2026-06-11T10:00:05Z',
    message: { id, model: 'claude-test', usage: { input_tokens: 1, output_tokens: 2 }, content: [{ type: 'text', text }] }
  }
}

function makeWorld() {
  const world = {
    now: 1_000_000,
    files: new Map(), // file -> { meta: {sessionId,file,projectDir,projectApprox,mtimeMs,size}, lines: [], reads: 0 }
    saved: null, // last cache JSON written
    cacheRaw: null // what _loadCache will read
  }
  world.addFile = (name, lines, mtimeMs) => {
    const file = 'P:\\proj\\' + name + '.jsonl'
    world.files.set(file, {
      meta: { sessionId: name, file, projectDir: 'proj', projectApprox: 'P:\\proj', mtimeMs, size: lines.length * 100 },
      lines: lines.slice(),
      reads: 0
    })
    return file
  }
  world.append = (file, lines, mtimeMs) => {
    const f = world.files.get(file)
    f.lines.push(...lines)
    f.meta.mtimeMs = mtimeMs
    f.meta.size = f.lines.length * 100
  }
  return world
}

function indexFor(world, opts = {}) {
  const emitted = []
  const idx = new SessionIndex({
    projectsDir: 'P:\\',
    cachePath: 'P:\\cache.json',
    now: () => world.now,
    listFiles: () => [...world.files.values()].map((f) => ({ ...f.meta })),
    makeTail: (file) => {
      let consumed = 0
      return {
        readDelta() {
          const f = world.files.get(file)
          if (!f) throw new Error('ENOENT: ' + file)
          if (consumed === 0 && f.lines.length) f.reads++ // a from-zero read = one full parse
          const objects = f.lines.slice(consumed)
          consumed = f.lines.length
          return { reset: false, objects: objects.slice(), size: f.meta.size, mtimeMs: f.meta.mtimeMs }
        }
      }
    },
    watchFactory: opts.watchFactory || (() => ({ close() {} })),
    fsImpl: {
      readFileSync: () => {
        if (world.cacheRaw == null) throw new Error('ENOENT cache')
        return world.cacheRaw
      },
      writeFileSync: (_p, data) => {
        world.saved = data
      }
    },
    debounceMs: 0,
    emitDebounceMs: 0,
    saveDebounceMs: 0,
    sweepMs: 60_000,
    onSessions: (sessions) => emitted.push(sessions),
    ...opts.overrides
  })
  return { idx, emitted }
}

const tick = () => new Promise((r) => setTimeout(r, 10))

test('boot parses every file once and serves a sorted, summarized list', async () => {
  const world = makeWorld()
  world.addFile('old', [userLine('first prompt'), assistantLine('m1', 'reply one')], 500)
  world.addFile('new', [userLine('second prompt')], 900)
  const { idx, emitted } = indexFor(world)
  idx.start()
  await tick()

  const list = idx.list(10)
  assert.strictEqual(list.length, 2)
  assert.strictEqual(list[0].sessionId, 'new') // newest first
  assert.strictEqual(list[1].counts.user, 1)
  assert.strictEqual(list[1].counts.assistant, 1)
  assert.strictEqual(list[1].usage.output, 2)
  assert.ok(!('timeline' in list[0])) // list payloads never carry timelines
  assert.ok(emitted.length >= 1)
  assert.ok(world.saved) // cache persisted
  idx.dispose()
})

test('warm boot from a valid cache parses nothing', async () => {
  const world = makeWorld()
  const file = world.addFile('s1', [userLine('hi'), assistantLine('m1', 'yo')], 500)

  // first boot builds the cache
  const a = indexFor(world)
  a.idx.start()
  await tick()
  world.cacheRaw = world.saved
  a.idx.dispose()
  world.files.get(file).reads = 0

  // second boot: cache valid (same mtime+size) → zero full reads
  const b = indexFor(world)
  b.idx.start()
  await tick()
  assert.strictEqual(world.files.get(file).reads, 0)
  assert.strictEqual(b.idx.list(10)[0].counts.user, 1)
  b.idx.dispose()
})

test('a changed file updates incrementally and re-emits; counts stay whole-file-correct', async () => {
  const world = makeWorld()
  const file = world.addFile('s1', [userLine('hi')], 500)
  const { idx, emitted } = indexFor(world)
  idx.start()
  await tick()
  const before = emitted.length

  world.append(file, [assistantLine('m1', 'reply')], 600)
  idx._update(file)
  await tick()

  const s = idx.list(10)[0]
  assert.strictEqual(s.counts.assistant, 1)
  assert.strictEqual(s.counts.user, 1)
  assert.strictEqual(s.mtimeMs, 600)
  assert.strictEqual(s.lastRole, 'assistant')
  assert.ok(s.lastSnippet.includes('reply'))
  assert.ok(emitted.length > before)
  assert.strictEqual(world.files.get(file).reads, 1) // still only the boot read
  idx.dispose()
})

test('summary(file) carries a bounded ring timeline for the monitor', async () => {
  const world = makeWorld()
  const lines = [userLine('p')]
  for (let i = 0; i < 30; i++) lines.push(assistantLine('m' + i, 'reply ' + i))
  const file = world.addFile('s1', lines, 500)
  const { idx } = indexFor(world)
  idx.start()
  await tick()

  const s = idx.summary(file)
  assert.strictEqual(s.ok, true)
  assert.ok(Array.isArray(s.timeline))
  assert.ok(s.timeline.length <= RING_MAX)
  assert.strictEqual(s.counts.assistant, 30) // counts cover the whole file, not the ring
  assert.deepStrictEqual(idx.summary('P:\\proj\\nope.jsonl'), { ok: false, error: 'unknown session' })
  idx.dispose()
})

test('recent(windowMs) returns metadata shaped like listSessionFiles output', async () => {
  const world = makeWorld()
  world.now = 100 * 24 * 3600 * 1000 // far from epoch so "stale" really is outside the window
  world.addFile('fresh', [userLine('a')], world.now - 1000)
  world.addFile('stale', [userLine('b')], 1)
  const { idx } = indexFor(world)
  idx.start()
  await tick()

  const r = idx.recent(24 * 3600 * 1000)
  assert.strictEqual(r.length, 1)
  assert.deepStrictEqual(Object.keys(r[0]).sort(), ['file', 'mtimeMs', 'projectApprox', 'projectDir', 'sessionId', 'size'])
  assert.strictEqual(r[0].sessionId, 'fresh')
  idx.dispose()
})

test('a corrupt cache is ignored (cold boot, no crash)', async () => {
  const world = makeWorld()
  world.addFile('s1', [userLine('hi')], 500)
  world.cacheRaw = '{ not json'
  const { idx } = indexFor(world)
  idx.start()
  await tick()
  assert.strictEqual(idx.list(10).length, 1)
  idx.dispose()
})

test('summarizeModel maps the accumulator into the listSessions shape', () => {
  const meta = { sessionId: 'x', file: 'P:\\proj\\x.jsonl', projectDir: 'proj', projectApprox: 'P:\\proj', mtimeMs: 5, size: 10 }
  const m = freshModel(meta.file)
  const ring = []
  applyEvent(userLine('hello world'), m, ring)
  applyEvent(assistantLine('m1', 'the reply'), m, ring)
  const s = summarizeModel(meta, m, ring)
  // title comes from ai-title/last-prompt records, neither present here
  assert.strictEqual(s.title, '(untitled session)')
  assert.strictEqual(s.counts.user, 1)
  assert.strictEqual(s.lastRole, 'assistant')
  assert.ok(s.lastSnippet.includes('the reply'))
  assert.strictEqual(s.mtimeMs, 5)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '../src/main/sessionindex'`. 217 pre-existing pass.

- [ ] **Step 3: Create src/main/sessionindex.js (core; watcher/sweep/slot wiring arrives in Task 3 but the class skeleton below already includes the fields they use)**

```js
// src/main/sessionindex.js
// The session-index substrate: one source of truth for "what sessions exist
// and what do they look like", kept fresh by fs events + a reconciliation
// sweep, updated incrementally (O(appended bytes)) via tailer.js, persisted
// so a warm boot parses nothing.
//
// Consumers:
//   sessions:list IPC       -> list(limit)         (summaries, no timelines)
//   SessionMonitor defaults -> recent(), summary() (summary carries a bounded
//                              ring timeline so monitor's snippet/lastRole
//                              helpers keep working unchanged)
//   open-session watch      -> subscribe()/unsubscribe() + delta events
//                              (Task 3)
const fs = require('fs')
const path = require('path')
const sessionsMod = require('./sessions')
const { freshModel, applyEvent, finalize } = require('./parser')
const { snippetOf, lastRoleOf } = require('./monitor')
const { createTail } = require('./tailer')

const RING_MAX = 12 // bounded recent-items ring per session (live.js precedent)
const SWEEP_MS = 15_000
const RECENT_WINDOW_MS = 24 * 3600 * 1000
const DEBOUNCE_MS = 300
const EMIT_DEBOUNCE_MS = 500
const SAVE_DEBOUNCE_MS = 2000

/** Snapshot an accumulator without disturbing it (finalize mutates its clone only). */
function snapshotModel(model) {
  return finalize({ ...model, __models: model.__models, __usageIds: model.__usageIds })
}

/** Map an accumulator + metadata + ring into the exact listSessions entry shape. */
function summarizeModel(meta, model, ring) {
  const snap = snapshotModel(model)
  return {
    sessionId: snap.sessionId || meta.sessionId,
    file: meta.file,
    projectDir: meta.projectDir,
    projectApprox: meta.projectApprox,
    size: meta.size,
    mtimeMs: meta.mtimeMs,
    cwd: snap.cwd || meta.projectApprox,
    title: snap.title || snap.lastUserPrompt || '(untitled session)',
    gitBranch: snap.gitBranch,
    models: snap.models,
    version: snap.version,
    counts: snap.counts,
    usage: snap.usage,
    tools: snap.tools,
    firstTimestamp: snap.firstTimestamp,
    lastTimestamp: snap.lastTimestamp,
    parseErrors: snap.parseErrors,
    errorCount: snap.errorCount,
    turnDurationCount: snap.turnDurationCount,
    lastTurnDurationMs: snap.lastTurnDurationMs,
    lastContextTokens: snap.lastContextTokens,
    lastRole: lastRoleOf({ timeline: ring }),
    lastSnippet: snippetOf({ timeline: ring })
  }
}

function defaultWatchFactory(dir, onEvent) {
  const w = fs.watch(dir, { recursive: true }, (_ev, fname) => {
    if (fname) onEvent(String(fname))
  })
  // Runtime watcher errors are non-fatal: the sweep reconciles regardless.
  w.on('error', () => {})
  return w
}

class SessionIndex {
  constructor(opts = {}) {
    this.fs = opts.fsImpl || fs
    this.now = opts.now || Date.now
    this.listFiles = opts.listFiles || sessionsMod.listSessionFiles
    this.makeTail = opts.makeTail || ((file) => createTail(file))
    this.watchFactory = opts.watchFactory || defaultWatchFactory
    this.projectsDir = opts.projectsDir || sessionsMod.projectsDir()
    this.cachePath = opts.cachePath || null
    this.sweepMs = opts.sweepMs || SWEEP_MS
    this.recentWindowMs = opts.recentWindowMs || RECENT_WINDOW_MS
    this.debounceMs = opts.debounceMs ?? DEBOUNCE_MS
    this.emitDebounceMs = opts.emitDebounceMs ?? EMIT_DEBOUNCE_MS
    this.saveDebounceMs = opts.saveDebounceMs ?? SAVE_DEBOUNCE_MS
    this.onSessions = opts.onSessions || (() => {})
    this.onWatchRefresh = opts.onWatchRefresh || (() => {})
    this.onWatchAppend = opts.onWatchAppend || (() => {})

    this.summaries = new Map() // file -> { meta, summary, ring }
    this.hot = new Map() // file -> { tail, model } (files changed since boot, inside the recent window)
    this.watchSlot = null // { file, tail, model, timeline } — the open session (Task 3)
    this.mode = 'starting' // 'watch' | 'sweep-only'
    this.watcher = null
    this.sweepTimer = null
    this.pending = new Map() // file -> debounce timer
    this.emitTimer = null
    this.saveTimer = null
  }

  start() {
    this._loadCache()
    try {
      this.watcher = this.watchFactory(this.projectsDir, (rel) => this._onFsEvent(rel))
      this.mode = 'watch'
    } catch {
      this.mode = 'sweep-only' // exotic filesystems: the sweep alone keeps us correct
    }
    this._sweep()
    this.sweepTimer = setInterval(() => this._sweep(), this.sweepMs)
    if (this.sweepTimer.unref) this.sweepTimer.unref()
  }

  dispose() {
    if (this.watcher) {
      try {
        this.watcher.close()
      } catch {
        /* ignore */
      }
    }
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    for (const t of this.pending.values()) clearTimeout(t)
    this.pending.clear()
    if (this.emitTimer) clearTimeout(this.emitTimer)
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this._saveNow()
  }

  // ---- public reads ---------------------------------------------------------

  /** Sorted summaries, newest first. No timelines (IPC payload discipline). */
  list(limit = 200) {
    return [...this.summaries.values()]
      .filter((e) => e.summary)
      .map((e) => e.summary)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit)
  }

  /** Metadata for files active inside the window — monitor's listFiles shape. */
  recent(windowMs = this.recentWindowMs) {
    const now = this.now()
    return [...this.summaries.values()]
      .filter((e) => now - e.meta.mtimeMs <= windowMs)
      .map((e) => ({ ...e.meta }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
  }

  /** Monitor's parse replacement: summary + the bounded ring as `timeline`. */
  summary(file) {
    const e = this.summaries.get(file)
    if (!e || !e.summary) return { ok: false, error: 'unknown session' }
    return { ...e.summary, ok: true, timeline: (e.ring || []).slice() }
  }

  // ---- update path ----------------------------------------------------------

  _metaFor(file) {
    const projectDir = path.basename(path.dirname(file))
    return {
      sessionId: path.basename(file).replace(/\.jsonl$/i, ''),
      file,
      projectDir,
      projectApprox: sessionsMod.approxDecodeProject(projectDir),
      mtimeMs: 0,
      size: 0
    }
  }

  /** Bring one file up to date (incremental; first touch reads from 0). */
  _update(file) {
    let entry = this.summaries.get(file)
    let hot = this.hot.get(file)
    if (!hot) {
      hot = { tail: this.makeTail(file), model: freshModel(file) }
      this.hot.set(file, hot)
      const ring = []
      if (!entry) {
        entry = { meta: this._metaFor(file), summary: null, ring }
        this.summaries.set(file, entry)
      } else {
        // cold entry going hot: the fresh from-zero read rebuilds the ring
        entry.ring = ring
      }
    }
    let delta
    try {
      delta = hot.tail.readDelta()
    } catch {
      this._evict(file)
      return
    }
    if (delta.reset) {
      hot.model = freshModel(file)
      entry.ring.length = 0
      try {
        delta = hot.tail.readDelta()
      } catch {
        this._evict(file)
        return
      }
    }
    for (const o of delta.objects) applyEvent(o, hot.model, entry.ring)
    if (entry.ring.length > RING_MAX) entry.ring.splice(0, entry.ring.length - RING_MAX)
    // Image items carry base64 — keep the ring light (live.js does the same).
    for (let i = 0; i < entry.ring.length; i++) {
      const it = entry.ring[i]
      if (it.kind === 'image' && it.data) entry.ring[i] = { ...it, data: undefined, truncated: true }
    }
    entry.meta.mtimeMs = delta.mtimeMs
    entry.meta.size = delta.size
    entry.summary = summarizeModel(entry.meta, hot.model, entry.ring)
    this._scheduleEmit()
    this._scheduleSave()
  }

  _evict(file) {
    if (this.summaries.delete(file) | this.hot.delete(file)) {
      this._scheduleEmit()
      this._scheduleSave()
    }
  }

  _sweep() {
    let files
    try {
      files = this.listFiles()
    } catch {
      return
    }
    const seen = new Set()
    for (const meta of files) {
      seen.add(meta.file)
      const entry = this.summaries.get(meta.file)
      if (!entry || !entry.summary || entry.meta.mtimeMs !== meta.mtimeMs || entry.meta.size !== meta.size) {
        this._update(meta.file)
        if (this.watchSlot && this.watchSlot.file === meta.file) this._updateSlot()
      }
    }
    for (const file of [...this.summaries.keys()]) {
      if (!seen.has(file)) this._evict(file)
    }
    // Hot accumulators for files idle past the recent window go cold
    // (summary + ring survive; a later change re-seeds from zero).
    const now = this.now()
    for (const file of [...this.hot.keys()]) {
      const entry = this.summaries.get(file)
      if (entry && now - entry.meta.mtimeMs > this.recentWindowMs) this.hot.delete(file)
    }
  }

  // ---- fs events + slot (completed in Task 3) -------------------------------

  _onFsEvent(rel) {
    const parts = String(rel).split(/[\\/]/)
    if (parts.length !== 2 || !parts[1].toLowerCase().endsWith('.jsonl')) return
    const file = path.join(this.projectsDir, parts[0], parts[1])
    const existing = this.pending.get(file)
    if (existing) clearTimeout(existing)
    this.pending.set(
      file,
      setTimeout(() => {
        this.pending.delete(file)
        this._update(file)
        if (this.watchSlot && this.watchSlot.file === file) this._updateSlot()
      }, this.debounceMs)
    )
  }

  _updateSlot() {
    /* implemented in Task 3 */
  }

  // ---- debounced outputs ----------------------------------------------------

  _scheduleEmit() {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.onSessions(this.list(500))
    }, this.emitDebounceMs)
  }

  _scheduleSave() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this._saveNow()
    }, this.saveDebounceMs)
  }

  _loadCache() {
    if (!this.cachePath) return
    try {
      const raw = JSON.parse(this.fs.readFileSync(this.cachePath, 'utf-8'))
      if (!raw || raw.v !== 1 || !Array.isArray(raw.entries)) return
      for (const e of raw.entries) {
        if (e && e.meta && e.meta.file && e.summary) {
          this.summaries.set(e.meta.file, { meta: e.meta, summary: e.summary, ring: Array.isArray(e.ring) ? e.ring : [] })
        }
      }
    } catch {
      /* corrupt/missing cache → cold boot; the sweep rebuilds everything */
    }
  }

  _saveNow() {
    if (!this.cachePath) return
    try {
      const entries = [...this.summaries.values()]
        .filter((e) => e.summary)
        .map((e) => ({ meta: e.meta, summary: e.summary, ring: e.ring || [] }))
      this.fs.writeFileSync(this.cachePath, JSON.stringify({ v: 1, entries }))
    } catch {
      /* a failed save costs a slower next boot, never correctness */
    }
  }
}

module.exports = { SessionIndex, summarizeModel, snapshotModel, RING_MAX }
```

NOTE: `_evict` uses `|` deliberately (both deletes must run); if that reads too clever, use two statements and an `if (a || b)`.

- [ ] **Step 4: Register in electron.vite.config.mjs**

```js
          sessionindex: resolve('src/main/sessionindex.js'),
```

- [ ] **Step 5: Run tests**

Run: `npm test` → ALL pass (224 = 217 + 7 new).

- [ ] **Step 6: Commit**

```powershell
git add tests/sessionindex.test.js src/main/sessionindex.js electron.vite.config.mjs
git commit -m "feat(index): SessionIndex core - cached summaries + incremental updates"
```

---

### Task 3: SessionIndex watch events, sweep semantics, and the watch slot

**Files:**
- Modify: `src/main/sessionindex.js` (subscribe/unsubscribe/_updateSlot/slotSnapshotFor)
- Test: `tests/sessionindex.test.js` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `tests/sessionindex.test.js`:

```js
// ---- watcher events, sweep, deletion ----------------------------------------

test('an fs event for a session file updates it after debounce; nested/non-jsonl events are ignored', async () => {
  const world = makeWorld()
  const file = world.addFile('s1', [userLine('hi')], 500)
  let fire
  const { idx } = indexFor(world, { watchFactory: (_dir, onEvent) => { fire = onEvent; return { close() {} } } })
  idx.start()
  await tick()

  world.append(file, [assistantLine('m1', 'pushed')], 700)
  fire('proj\\s1.jsonl')
  await tick()
  assert.strictEqual(idx.list(10)[0].counts.assistant, 1)

  // these must all be ignored (no throw, no state change)
  fire('proj\\s1\\subagents\\agent-1.jsonl')
  fire('proj')
  fire('proj\\notes.txt')
  await tick()
  assert.strictEqual(idx.list(10).length, 1)
  idx.dispose()
})

test('the sweep catches changes the watcher missed and evicts deleted files', async () => {
  const world = makeWorld()
  const file = world.addFile('s1', [userLine('hi')], 500)
  world.addFile('gone', [userLine('bye')], 400)
  const { idx, emitted } = indexFor(world)
  idx.start()
  await tick()
  assert.strictEqual(idx.list(10).length, 2)

  world.append(file, [assistantLine('m1', 'silent change')], 800)
  world.files.delete('P:\\proj\\gone.jsonl')
  idx._sweep()
  await tick()

  const list = idx.list(10)
  assert.strictEqual(list.length, 1)
  assert.strictEqual(list[0].counts.assistant, 1)
  assert.ok(emitted.length >= 2)
  idx.dispose()
})

test('a watcher factory that throws leaves the index in sweep-only mode, still correct', async () => {
  const world = makeWorld()
  world.addFile('s1', [userLine('hi')], 500)
  const { idx } = indexFor(world, { watchFactory: () => { throw new Error('EPERM') } })
  idx.start()
  await tick()
  assert.strictEqual(idx.mode, 'sweep-only')
  assert.strictEqual(idx.list(10).length, 1)
  idx.dispose()
})

// ---- watch slot (open session) ----------------------------------------------

test('subscribe returns the full parsed session and deltas emit appended items', async () => {
  const world = makeWorld()
  const file = world.addFile('s1', [userLine('hi'), assistantLine('m1', 'first reply')], 500)
  const appends = []
  const refreshes = []
  const { idx } = indexFor(world, {
    overrides: {
      onWatchAppend: (p) => appends.push(p),
      onWatchRefresh: (p) => refreshes.push(p)
    }
  })
  idx.start()
  await tick()

  const session = idx.subscribe(file)
  assert.strictEqual(session.ok, true)
  assert.strictEqual(session.file, file)
  assert.strictEqual(session.timeline.length, 2) // full timeline, not the ring
  assert.strictEqual(idx.slotSnapshotFor(file).timeline.length, 2)
  assert.strictEqual(idx.slotSnapshotFor('P:\\proj\\other.jsonl'), null)

  world.append(file, [assistantLine('m2', 'second reply')], 700)
  idx._update(file)
  idx._updateSlot()
  await tick()

  assert.strictEqual(appends.length, 1)
  assert.strictEqual(appends[0].file, file)
  assert.strictEqual(appends[0].items.length, 1)
  assert.strictEqual(appends[0].items[0].kind, 'text')
  assert.strictEqual(appends[0].session.counts.assistant, 2)
  assert.ok(!('timeline' in appends[0].session)) // items carry the delta; session is the summary model
  assert.strictEqual(refreshes.length, 0)

  idx.unsubscribe()
  world.append(file, [assistantLine('m3', 'after unsub')], 900)
  idx._update(file)
  idx._updateSlot()
  await tick()
  assert.strictEqual(appends.length, 1) // nothing after unsubscribe
  idx.dispose()
})

test('a slot reset (truncated file) re-seeds and emits a full refresh', async () => {
  const world = makeWorld()
  const file = world.addFile('s1', [userLine('hi'), assistantLine('m1', 'one')], 500)
  const refreshes = []
  // a tail that resets once, then replays the new content
  let phase = 0
  const { idx } = indexFor(world, {
    overrides: {
      onWatchRefresh: (p) => refreshes.push(p),
      makeTail: (f) => {
        let consumed = 0
        return {
          readDelta() {
            const fw = world.files.get(f)
            if (phase === 1) {
              phase = 2
              consumed = 0
              return { reset: true, objects: [], size: fw.meta.size, mtimeMs: fw.meta.mtimeMs }
            }
            const objects = fw.lines.slice(consumed)
            consumed = fw.lines.length
            return { reset: false, objects: objects.slice(), size: fw.meta.size, mtimeMs: fw.meta.mtimeMs }
          }
        }
      }
    }
  })
  idx.start()
  await tick()
  idx.subscribe(file)
  world.files.get(file).lines = [userLine('rewritten')]
  phase = 1
  idx._updateSlot()
  await tick()
  assert.strictEqual(refreshes.length, 1)
  assert.strictEqual(refreshes[0].session.counts.user, 1)
  assert.strictEqual(refreshes[0].session.timeline.length, 1)
  idx.dispose()
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test`
Expected: the subscribe test FAILS (`idx.subscribe is not a function`). All prior tests pass.

- [ ] **Step 3: Implement the slot in sessionindex.js**

Replace the `_updateSlot() { /* implemented in Task 3 */ }` stub and add the public methods (place them under the `// ---- fs events + slot` banner):

```js
  /**
   * Subscribe the single open-session slot to `file`. Seeds a full-timeline
   * accumulator (one full read — the same parse session:read used to do) and
   * returns the parsed session. Replaces any previous subscription.
   */
  subscribe(file) {
    this.unsubscribe()
    const tail = this.makeTail(file)
    const model = freshModel(file)
    const timeline = []
    let delta
    try {
      delta = tail.readDelta()
    } catch (err) {
      return { ok: false, error: err.message, file }
    }
    for (const o of delta.objects) applyEvent(o, model, timeline)
    this.watchSlot = { file, tail, model, timeline }
    return this._slotSnapshot()
  }

  unsubscribe() {
    this.watchSlot = null
  }

  /** The full parsed session for `file` IF it is the subscribed slot, else null. */
  slotSnapshotFor(file) {
    if (!this.watchSlot || this.watchSlot.file !== file) return null
    return this._slotSnapshot()
  }

  _slotSnapshot() {
    const s = this.watchSlot
    const snap = snapshotModel(s.model)
    return { ...snap, ok: true, timeline: s.timeline.slice() }
  }

  _updateSlot() {
    const s = this.watchSlot
    if (!s) return
    let delta
    try {
      delta = s.tail.readDelta()
    } catch {
      return // mid-write/transient — the next event or sweep retries
    }
    if (delta.reset) {
      s.model = freshModel(s.file)
      s.timeline = []
      try {
        delta = s.tail.readDelta()
      } catch {
        return
      }
      for (const o of delta.objects) applyEvent(o, s.model, s.timeline)
      this.onWatchRefresh({ file: s.file, session: this._slotSnapshot() })
      return
    }
    if (!delta.objects.length) return
    const before = s.timeline.length
    for (const o of delta.objects) applyEvent(o, s.model, s.timeline)
    const items = s.timeline.slice(before)
    this.onWatchAppend({ file: s.file, session: { ...snapshotModel(s.model), ok: true }, items })
  }
```

(`freshModel(file)` sets `model.file`, so `_slotSnapshot`'s spread carries `file` — no extra assignment needed. The append payload's `session` has no `timeline` key because the accumulator never holds one; the renderer supplies `[...prev.timeline, ...items]`.)

- [ ] **Step 4: Run tests**

Run: `npm test` → ALL pass (229 = 224 + 5 new).

- [ ] **Step 5: Commit**

```powershell
git add tests/sessionindex.test.js src/main/sessionindex.js
git commit -m "feat(index): watch events, reconciliation sweep, and the open-session slot"
```

---

### Task 4: Main wiring — serve IPC from the index

**Files:**
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

- [ ] **Step 1: Wire the index in src/main/index.js**

1. Add the require: `const { SessionIndex } = require('./sessionindex')` (next to the other requires).
2. Add `let sessionIndex = null` next to the other singletons.
3. Replace the `sessions:list` handler with:

```js
ipcMain.handle('sessions:list', (_e, opts) => {
  try {
    const limit = (opts && opts.limit) || 200
    if (sessionIndex) return { ok: true, sessions: sessionIndex.list(limit) }
    return { ok: true, sessions: listSessions(opts || {}) } // pre-ready fallback
  } catch (err) {
    return { ok: false, error: err.message, sessions: [] }
  }
})
```

4. Replace the `session:read` handler with:

```js
ipcMain.handle('session:read', (_e, file) => {
  try {
    if (!isSessionPathAllowed(file)) return { ok: false, error: 'path not allowed' }
    // openSession watches first, then reads — serve the slot's parse instead
    // of parsing the same file a second time.
    const slot = sessionIndex ? sessionIndex.slotSnapshotFor(file) : null
    return { ok: true, session: slot || parseSessionFile(file, { timeline: true }) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
```

5. DELETE the whole `// ---- Session watch (re-parse on change) ----` block (the `watchFile`/`watchTimer`/`watchMtime` lets and both handlers; lines ~317-354). Replace with:

```js
// ---- Session watch (served by the index's watch slot) ----------------------
ipcMain.on('session:watch', (_e, file) => {
  if (!isSessionPathAllowed(file)) return
  if (sessionIndex) sessionIndex.subscribe(file)
})
ipcMain.on('session:unwatch', () => {
  if (sessionIndex) sessionIndex.unsubscribe()
})
```

6. In `whenReady`, BEFORE the `sessionMonitor = new SessionMonitor({...})` block, add:

```js
  sessionIndex = new SessionIndex({
    cachePath: path.join(app.getPath('userData'), 'session-index.json'),
    onSessions: (sessions) => emit('sessions:changed', { sessions }),
    onWatchRefresh: (payload) => emit('session:refresh', payload),
    onWatchAppend: (payload) => emit('session:append', payload)
  })
  sessionIndex.start()
```

7. Change the `sessionMonitor` construction to source its defaults from the index (everything else unchanged):

```js
  sessionMonitor = new SessionMonitor({
    listFiles: () => sessionIndex.recent(),
    parseFile: (file) => sessionIndex.summary(file),
    getOpenSessionId: () => openSessionId,
    onAttention: (notice) => notifier.deliver(notice),
    onCards: (cards) => emit('missioncontrol:update', cards)
  })
```

8. In `window-all-closed`, replace the `if (watchTimer) clearInterval(watchTimer)` line with:

```js
  if (sessionIndex) sessionIndex.dispose()
```

9. In the FLUX_SMOKE_SHOT harness, directly after the `await wait(2500)` line, add delay support (Task 6's freshness smoke needs it):

```js
        if (process.env.FLUX_SMOKE_DELAY) {
          await wait(parseInt(process.env.FLUX_SMOKE_DELAY, 10) || 0)
        }
```

- [ ] **Step 2: Add the new channels to src/preload/index.js**

Inside the `sessions: { ... }` object, after `onSendStatus`, add:

```js
    onChanged: (cb) => {
      const listener = (_e, payload) => cb(payload) // { sessions }
      ipcRenderer.on('sessions:changed', listener)
      return () => ipcRenderer.removeListener('sessions:changed', listener)
    },
    onAppend: (cb) => {
      const listener = (_e, payload) => cb(payload) // { file, session, items }
      ipcRenderer.on('session:append', listener)
      return () => ipcRenderer.removeListener('session:append', listener)
    },
```

- [ ] **Step 3: Run tests + build**

Run: `npm test` → ALL pass (229; no new tests — main wiring is covered by the packaged smoke in Task 6).
Run: `npm run build` → succeeds; `out/main/sessionindex.js` and `out/main/tailer.js` exist.

- [ ] **Step 4: Quick dev sanity (the renderer still works against the new backend before the store lands)**

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
$env:FLUX_SMOKE_SHOT = "C:\tmp\flux-index-wiring-smoke.png"
npx electron .
Remove-Item env:FLUX_SMOKE_SHOT
```

Expected: `FLUX_SMOKE_SHOT_OK`; READ the png — sidebar lists sessions (served from the index now), terminal renders. The old renderer code path (`sessions.list` once at mount) still works unchanged at this point.

- [ ] **Step 5: Commit**

```powershell
git add src/main/index.js src/preload/index.js
git commit -m "feat(index): serve sessions:list/watch from SessionIndex; push sessions:changed + session:append"
```

---

### Task 5: Renderer — live sessions store, append merge, dead-click fixes

**Files:**
- Create: `src/renderer/src/lib/sessionlist.js` (pure helpers)
- Create: `src/renderer/src/lib/sessions-context.jsx`
- Modify: `src/renderer/src/main.jsx` (mount the provider)
- Modify: `src/renderer/src/App.jsx`
- Test: `tests/sessionlist.test.js` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/sessionlist.test.js`:

```js
// tests/sessionlist.test.js
const test = require('node:test')
const assert = require('node:assert')
const { resolveSession, mergeAppend } = require('../src/renderer/src/lib/sessionlist.js')

test('resolveSession finds by id, synthesizes from fallback, or returns null', () => {
  const sessions = [{ sessionId: 'a', file: 'F:\\a.jsonl', title: 'A' }]
  assert.strictEqual(resolveSession(sessions, 'a').title, 'A')
  const synth = resolveSession(sessions, 'b', { file: 'F:\\b.jsonl', title: 'B', cwd: 'F:\\' })
  assert.deepStrictEqual(synth, { sessionId: 'b', file: 'F:\\b.jsonl', title: 'B', cwd: 'F:\\' })
  const minimal = resolveSession(sessions, 'c', { file: 'F:\\c.jsonl' })
  assert.strictEqual(minimal.title, 'c') // short-id fallback title
  assert.strictEqual(resolveSession(sessions, 'd'), null) // unknown, no file → nothing to open
})

test('mergeAppend appends items onto the open detail and refreshes the model fields', () => {
  const detail = { ok: true, file: 'F:\\a.jsonl', counts: { total: 1 }, timeline: [{ kind: 'user', text: 'hi' }] }
  const payload = {
    file: 'F:\\a.jsonl',
    session: { ok: true, file: 'F:\\a.jsonl', counts: { total: 2 } },
    items: [{ kind: 'text', text: 'reply' }]
  }
  const merged = mergeAppend(detail, payload)
  assert.strictEqual(merged.counts.total, 2)
  assert.strictEqual(merged.timeline.length, 2)
  assert.strictEqual(merged.timeline[1].text, 'reply')
})

test('mergeAppend ignores mismatched files and broken details', () => {
  const detail = { ok: true, file: 'F:\\a.jsonl', timeline: [] }
  const other = { file: 'F:\\b.jsonl', session: {}, items: [{}] }
  assert.strictEqual(mergeAppend(detail, other), detail)
  assert.strictEqual(mergeAppend(null, other), null)
  const broken = { ok: false, error: 'x' }
  assert.strictEqual(mergeAppend(broken, other), broken)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with cannot find `sessionlist.js`. All 229 pre-existing pass.

- [ ] **Step 3: Create src/renderer/src/lib/sessionlist.js**

```js
// Pure helpers for the live sessions store (unit-tested without React).

/** Find a session by id, or synthesize the minimum openSession needs from
 *  fallback fields (a Mission Control card, a search hit). Null if neither. */
export function resolveSession(sessions, sessionId, fallback = {}) {
  const found = (sessions || []).find((s) => s.sessionId === sessionId)
  if (found) return found
  if (!fallback.file) return null
  return {
    sessionId,
    file: fallback.file,
    title: fallback.title || String(sessionId).slice(0, 8),
    cwd: fallback.cwd || ''
  }
}

/** Merge a session:append payload into the open detail object. */
export function mergeAppend(detail, payload) {
  if (!detail || detail.ok === false || !Array.isArray(detail.timeline)) return detail
  if (!payload || payload.file !== detail.file) return detail
  return { ...payload.session, timeline: [...detail.timeline, ...payload.items] }
}
```

- [ ] **Step 4: Run tests** → ALL pass (232).

- [ ] **Step 5: Create src/renderer/src/lib/sessions-context.jsx**

```jsx
import { createContext, useContext, useState, useEffect } from 'react'

const SessionsContext = createContext(null)

// The live sessions store: seeded by one sessions:list, then kept fresh by
// main's sessions:changed pushes (the SessionIndex watcher). Replaces the old
// fetch-once-at-mount list that went stale the moment a new session started.
export function SessionsProvider({ children }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    window.flux.sessions
      .list({ limit: 500 })
      .then((res) => {
        if (!alive) return
        if (res.ok) setSessions(res.sessions)
        else setError(res.error || 'failed to load sessions')
        setLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        setError(String(e))
        setLoading(false)
      })
    const off = window.flux.sessions.onChanged(({ sessions: next }) => {
      setSessions(next)
      setLoading(false)
      setError(null)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  return <SessionsContext.Provider value={{ sessions, loading, error }}>{children}</SessionsContext.Provider>
}

export function useSessions() {
  const ctx = useContext(SessionsContext)
  if (!ctx) throw new Error('useSessions must be used within SessionsProvider')
  return ctx
}
```

- [ ] **Step 6: Mount the provider in src/renderer/src/main.jsx**

Add the import: `import { SessionsProvider } from './lib/sessions-context'`
Change the render call to:

```jsx
createRoot(document.getElementById('root')).render(
  <SettingsProvider initial={seeded}>
    <SessionsProvider>
      <App />
    </SessionsProvider>
  </SettingsProvider>
)
```

- [ ] **Step 7: Rework src/renderer/src/App.jsx**

1. Imports: add `import { useSessions } from './lib/sessions-context'` and `import { resolveSession, mergeAppend } from './lib/sessionlist.js'`.
2. DELETE the local list state + fetch effect: the `const [sessions, setSessions] = useState([])`, `sessionsLoading`, `sessionsError` lines and the whole `// One session-list fetch...` useEffect. Replace with:

```js
  const { sessions, loading: sessionsLoading, error: sessionsError } = useSessions()
```

3. After the existing live-refresh effect (`offRefresh`/`offStatus`), add the append subscription:

```js
  // Incremental updates for the open session: main sends only appended items.
  useEffect(() => {
    return window.flux.sessions.onAppend((payload) => {
      if (payload.file === openFileRef.current) setDetail((prev) => mergeAppend(prev, payload))
    })
  }, [])
```

4. Add a unified open-by-id (after `openSession`):

```js
  // Open by id from anywhere (cards, search hits, notifications); synthesizes
  // from fallback fields when the store hasn't caught up yet.
  const openById = useCallback(
    (sessionId, fallback) => {
      const sess = resolveSession(sessions, sessionId, fallback)
      if (sess) openSession(sess)
    },
    [sessions, openSession]
  )
```

5. Rewrite `openCard` and `openSearchResult` on top of it:

```js
  const openCard = useCallback((card) => openById(card.sessionId, card), [openById])

  const openSearchResult = useCallback(
    (sessionId, file, msgIdx) => {
      openById(sessionId, { file })
      // setScrollTarget with a unique key so the effect re-triggers even if
      // the same idx is selected twice.
      setScrollTarget({ idx: msgIdx, key: Date.now() })
    },
    [openById]
  )
```

6. Replace the two notification-click handlers with `openById`: the `useEffect` for `window.flux.notify.onOpenSession` becomes:

```js
  useEffect(() => {
    return window.flux.notify.onOpenSession(({ sessionId }) => openById(sessionId))
  }, [openById])
```

and the `<NotificationBell onOpenSession={...}>` prop becomes:

```jsx
          <NotificationBell onOpenSession={(id) => openById(id)} />
```

7. Replace `sendNewChat`'s retry-poll with a store wait. Add state next to `newChat`:

```js
  const [pendingOpenId, setPendingOpenId] = useState(null) // newChat session waiting to appear in the store
```

Replace the whole `sendNewChat` callback with:

```js
  const sendNewChat = useCallback(
    (message) => {
      if (sendState === 'running') return
      setSendState('running')
      setSendError(null)
      window.flux.sessions
        .newChat({ message, cwd: newChat?.cwd || null, model })
        .then((res) => {
          if (!res.ok) {
            setSendState('error')
            setSendError(res.error || 'failed to start chat')
            return
          }
          setPendingOpenId(res.sessionId) // the live store will surface it
        })
        .catch((e) => {
          setSendState('error')
          setSendError(String(e))
        })
    },
    [newChat, model, sendState]
  )

  // Open the new chat as soon as the watcher-driven store sees its file.
  useEffect(() => {
    if (!pendingOpenId) return
    const found = sessions.find((s) => s.sessionId === pendingOpenId)
    if (found) {
      setPendingOpenId(null)
      setNewChat(null)
      openSession(found)
    }
  }, [sessions, pendingOpenId, openSession])
  useEffect(() => {
    if (!pendingOpenId) return
    const t = setTimeout(() => {
      setPendingOpenId(null)
      setSendState('error')
      setSendError('New session did not appear — it may still be starting. Try again.')
    }, 15000)
    return () => clearTimeout(t)
  }, [pendingOpenId])
```

- [ ] **Step 8: Run tests + build + smoke**

Run: `npm test` → ALL pass (232).
Run: `npm run build` → succeeds.
Smoke both views (read the screenshots and confirm normal rendering):

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
$env:FLUX_SMOKE_SHOT = "C:\tmp\flux-store-main.png"
npx electron .
Remove-Item env:FLUX_SMOKE_SHOT
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
$env:FLUX_SMOKE_SHOT = "C:\tmp\flux-store-session.png"
$env:FLUX_SMOKE_VIEW = "session"
npx electron .
Remove-Item env:FLUX_SMOKE_SHOT; Remove-Item env:FLUX_SMOKE_VIEW
```

- [ ] **Step 9: Commit**

```powershell
git add tests/sessionlist.test.js src/renderer/src/lib/sessionlist.js src/renderer/src/lib/sessions-context.jsx src/renderer/src/main.jsx src/renderer/src/App.jsx
git commit -m "feat(renderer): live sessions store + append merge + open-by-id (dead clicks fixed)"
```

---

### Task 6: End-to-end freshness verification + README

**Files:**
- Modify: `README.md`
- (no code changes; verification only — except a fix if verification fails)

- [ ] **Step 1: Full suite + build**

Run: `npm test` → ALL pass (232). `npm run build` → green.

- [ ] **Step 2: The freshness proof — a session started OUTSIDE the app appears in the sidebar while the app is running.** Launch the built app with a 30s capture delay; 8s in, start a real claude session from a separate shell; the screenshot must show it at the TOP of the sidebar.

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
$env:FLUX_SMOKE_SHOT = "C:\tmp\flux-freshness.png"
$env:FLUX_SMOKE_DELAY = "30000"
Start-Process -NoNewWindow npx -ArgumentList "electron","."
Start-Sleep -Seconds 8
node -e "const {ClaudeRunner, resolveClaudeBin} = require('./src/main/resume'); const r = new ClaudeRunner({ bin: resolveClaudeBin(), onStatus: (id, st) => console.log('STATUS', st) }); console.log(JSON.stringify(r.newChat({ message: 'Reply with exactly: FRESHNESS-PROBE', cwd: process.cwd() })))"
Start-Sleep -Seconds 35
Remove-Item env:FLUX_SMOKE_SHOT; Remove-Item env:FLUX_SMOKE_DELAY
```

READ `C:\tmp\flux-freshness.png`: the sidebar's top entry must be the new session (title around "Reply with exactly: FRESHNESS-PROBE"). If it is NOT there, the substrate's push path is broken — debug (likely the fs.watch event filter or the sessions:changed emit), fix, and re-run. Do not rationalize a failure away.

- [ ] **Step 3: Cache effectiveness check**

Run the app once (any smoke), then check the cache exists and boot again timing the sidebar:

```powershell
Get-ChildItem "$env:APPDATA\flux-terminal\session-index.json" -ErrorAction SilentlyContinue
```

Expected: the file exists and is non-trivial (>10KB with ~200 sessions). (The userData dir name follows productName; if not found, check `$env:APPDATA\Flux Terminal\`.)

- [ ] **Step 4: README roadmap entry**

Add after the correctness + security week entry:

```markdown
- [x] **Session-index substrate:** one recursive `fs.watch` + 15s reconciliation
      sweep feeding an incrementally-updated, persisted session index — the
      sidebar updates live (sessions started anywhere appear without restart),
      `sessions:list` serves from cache (warm boot parses nothing), the open
      session streams only appended timeline items, and the monitor stops
      re-parsing transcripts. Notification/search clicks on brand-new sessions
      now open them.
```

- [ ] **Step 5: Commit**

```powershell
git add README.md
git commit -m "docs: session-index substrate in the roadmap"
```
