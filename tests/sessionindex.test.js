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
