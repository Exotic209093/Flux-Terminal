// tests/missioncontrol.test.js
const test = require('node:test')
const assert = require('node:assert')
const { composeCards, cardsChanged, statusFor } = require('../src/main/missioncontrol')

function rec(over) {
  return Object.assign({
    sessionId: 's', file: 'f', project: 'p', cwd: 'c', title: 't', model: 'm',
    usage: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 },
    subagents: { running: 0, total: 0 }, lastSnippet: '', lastActivityMs: 1000,
    lastRole: 'assistant', hasError: false, blocked: false, turnOpen: false, origin: 'auto'
  }, over)
}

test('status precedence: error > blocked > running > finished > idle', () => {
  const now = 1000
  assert.strictEqual(statusFor(rec({ hasError: true, blocked: true, turnOpen: true }), now), 'error')
  assert.strictEqual(statusFor(rec({ blocked: true, turnOpen: true }), now), 'blocked')
  assert.strictEqual(statusFor(rec({ turnOpen: true }), now), 'running')
  assert.strictEqual(statusFor(rec({ lastRole: 'assistant', lastActivityMs: now - 1000 }), now), 'finished')
  assert.strictEqual(statusFor(rec({ lastRole: 'assistant', lastActivityMs: now - 99999999 }), now), 'idle')
})

test('composeCards groups + sorts needs-you first, then by recency', () => {
  const now = 10_000
  const cards = composeCards([
    rec({ sessionId: 'idle1', turnOpen: false, lastRole: 'assistant', lastActivityMs: now - 99999999 }),
    rec({ sessionId: 'err1', hasError: true, lastActivityMs: now - 5000 }),
    rec({ sessionId: 'run1', turnOpen: true, lastActivityMs: now - 1000 })
  ], now)
  assert.deepStrictEqual(cards.map((c) => c.sessionId), ['err1', 'run1', 'idle1'])
  assert.strictEqual(cards[0].group, 'needsYou')
  assert.strictEqual(cards[1].group, 'running')
  assert.strictEqual(cards[2].group, 'idle')
})

test('cardsChanged detects status/usage/snippet/subagent/count changes', () => {
  const a = composeCards([rec({ sessionId: 'x' })], 1000)
  const b = composeCards([rec({ sessionId: 'x' })], 1000)
  assert.strictEqual(cardsChanged(a, b), false)
  assert.strictEqual(cardsChanged(null, b), true)
  assert.strictEqual(cardsChanged(a, composeCards([rec({ sessionId: 'x', usage: { input: 999, output: 50, cacheRead: 0, cacheCreation: 0 } })], 1000)), true)
  assert.strictEqual(cardsChanged(a, composeCards([rec({ sessionId: 'x', turnOpen: true })], 1000)), true)
})

test('composeCards passes usage + model through for renderer-side cost', () => {
  const cards = composeCards([rec({ sessionId: 'x', model: 'claude-opus-4-8', usage: { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 } })], 1000)
  assert.deepStrictEqual(cards[0].usage, { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 })
  assert.strictEqual(cards[0].model, 'claude-opus-4-8')
})
