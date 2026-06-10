// tests/monitor.test.js
const test = require('node:test')
const assert = require('node:assert')
const { SessionMonitor, isRecentlyActive } = require('../src/main/monitor')

test('isRecentlyActive compares mtime against now within window', () => {
  assert.strictEqual(isRecentlyActive(1000, 1000 + 5000, 10000), true)
  assert.strictEqual(isRecentlyActive(1000, 1000 + 20000, 10000), false)
})

// A scripted fake world: each "tick" the test advances `now` and mutates files.
function makeWorld() {
  return {
    now: 0,
    files: [], // [{ sessionId, file, projectDir, projectApprox, mtimeMs }]
    parsed: {} // file -> parse result
  }
}

function monitorFor(world, sinks) {
  return new SessionMonitor({
    now: () => world.now,
    tickMs: 1000,
    activeWindowMs: 60000,
    recentWindowMs: 24 * 3600 * 1000,
    listFiles: () => world.files,
    parseFile: (file) => world.parsed[file],
    countSub: () => ({ running: 0, total: 0 }),
    getOpenSessionId: () => null,
    onAttention: sinks.onAttention,
    onCards: sinks.onCards
  })
}

test('a long turn across ticks produces a turn:finished attention event', () => {
  const world = makeWorld()
  const attn = []
  const cards = []
  const mon = monitorFor(world, { onAttention: (e) => attn.push(e), onCards: (c) => cards.push(c) })

  const file = '/p/s1.jsonl'
  const base = { sessionId: 's1', file, projectDir: 'p', projectApprox: 'C:\\p' }
  world.files = [{ ...base, mtimeMs: 0 }]
  world.parsed[file] = { ok: true, sessionId: 's1', cwd: 'C:\\p', title: 't', models: ['claude-x'],
    counts: { user: 0, assistant: 0 }, usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    errorCount: 0, timeline: [], lastTimestamp: null }

  mon._tick() // baseline

  world.now = 1000
  world.files = [{ ...base, mtimeMs: 1000 }]
  world.parsed[file] = { ...world.parsed[file], counts: { user: 1, assistant: 0 } } // turn opens
  mon._tick()

  world.now = 1000 + 31000
  world.files = [{ ...base, mtimeMs: 30000 }]
  world.parsed[file] = { ...world.parsed[file], counts: { user: 1, assistant: 1 } } // closes, long
  mon._tick()

  const finished = attn.filter((e) => e.event.type === 'turn:finished')
  assert.strictEqual(finished.length, 1)
  assert.strictEqual(finished[0].sessionId, 's1')
  assert.ok(cards.length >= 1) // cards pushed when state changed
})

test('idle (beyond recent window) sessions are pruned from cards', () => {
  const world = makeWorld()
  const cards = []
  const mon = monitorFor(world, { onAttention: () => {}, onCards: (c) => { cards.length = 0; cards.push(...c) } })
  const file = '/p/old.jsonl'
  world.parsed[file] = { ok: true, sessionId: 'old', cwd: 'C:\\p', title: 'old', models: [],
    counts: { user: 1, assistant: 1 }, usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    errorCount: 0, timeline: [], lastTimestamp: null }
  world.now = 100 * 24 * 3600 * 1000
  world.files = [{ sessionId: 'old', file, projectDir: 'p', projectApprox: 'C:\\p', mtimeMs: 0 }] // ancient
  mon._tick()
  assert.strictEqual(cards.length, 0)
})
