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
