// tests/attention.test.js
const test = require('node:test')
const assert = require('node:assert')
const {
  createAttentionState, observe, createUsageState, observeUsage,
  MIN_TURN_MS, BLOCKED_MS
} = require('../src/main/attention')

// obs = { ts, mtimeMs, userCount, assistantCount, errorCount }
function obs(ts, mtimeMs, u, a, e = 0) {
  return { ts, mtimeMs, userCount: u, assistantCount: a, errorCount: e }
}

test('first observation only establishes a baseline (no events)', () => {
  const s = createAttentionState()
  const ev = observe(s, obs(1000, 1000, 3, 3, 0))
  assert.deepStrictEqual(ev, [])
})

test('a long turn emits turn:finished; a short one does not', () => {
  const s = createAttentionState()
  observe(s, obs(0, 0, 0, 0)) // baseline
  observe(s, obs(1000, 1000, 1, 0)) // user msg → turn opens at ts=1000
  const ev = observe(s, obs(1000 + MIN_TURN_MS + 1, 5000, 1, 1)) // assistant closes, long
  assert.strictEqual(ev.length, 1)
  assert.strictEqual(ev[0].type, 'turn:finished')

  // short turn: open and close within MIN_TURN_MS
  const s2 = createAttentionState()
  observe(s2, obs(0, 0, 0, 0))
  observe(s2, obs(1000, 1000, 1, 0))
  const ev2 = observe(s2, obs(1000 + 5000, 2000, 1, 1))
  assert.deepStrictEqual(ev2, [])
})

test('error record during an open turn emits turn:error once and closes the turn', () => {
  const s = createAttentionState()
  observe(s, obs(0, 0, 0, 0))
  observe(s, obs(1000, 1000, 1, 0)) // turn open
  const ev = observe(s, obs(2000, 1500, 1, 0, 1)) // error appears
  assert.strictEqual(ev.length, 1)
  assert.strictEqual(ev[0].type, 'turn:error')
  // a later assistant message must NOT also fire turn:finished (turn already closed)
  const ev2 = observe(s, obs(3000 + MIN_TURN_MS, 1600, 1, 1, 1))
  assert.deepStrictEqual(ev2, [])
})

test('blocked fires once when an open turn goes silent past BLOCKED_MS', () => {
  const s = createAttentionState()
  observe(s, obs(0, 0, 0, 0))
  observe(s, obs(1000, 1000, 1, 0)) // turn open, last write ts=1000
  const quiet = observe(s, obs(1000 + BLOCKED_MS + 1, 1000, 1, 0)) // mtime unchanged
  assert.strictEqual(quiet.length, 1)
  assert.strictEqual(quiet[0].type, 'blocked')
  const again = observe(s, obs(1000 + BLOCKED_MS + 5000, 1000, 1, 0)) // still quiet
  assert.deepStrictEqual(again, []) // once per turn
})

test('a write (mtime change) resets the blocked clock', () => {
  const s = createAttentionState()
  observe(s, obs(0, 0, 0, 0))
  observe(s, obs(1000, 1000, 1, 0))
  observe(s, obs(1000 + 60000, 2000, 1, 0)) // wrote at 61s → clock resets
  const ev = observe(s, obs(1000 + 60000 + 60000, 2000, 1, 0)) // 60s more silence < BLOCKED_MS
  assert.deepStrictEqual(ev, [])
})

test('a turn that opens and closes in the same observation never fires (duration 0)', () => {
  const s = createAttentionState()
  observe(s, obs(0, 0, 0, 0)) // baseline
  const ev = observe(s, obs(500, 500, 1, 1)) // user+assistant both jump in one poll
  assert.deepStrictEqual(ev, [])
  assert.strictEqual(s.turnOpen, false)
})

test('usage:threshold fires once per window per reset cycle', () => {
  const us = createUsageState()
  const w = (u, resetsAt) => ({ fiveHour: { utilization: u, resetsAt }, sevenDay: null, sevenDayOpus: null, sevenDaySonnet: null })
  assert.deepStrictEqual(observeUsage(us, w(50, 'R1'), 1), [])
  const ev = observeUsage(us, w(91, 'R1'), 2)
  assert.strictEqual(ev.length, 1)
  assert.strictEqual(ev[0].type, 'usage:threshold')
  assert.strictEqual(ev[0].window, 'fiveHour')
  assert.deepStrictEqual(observeUsage(us, w(95, 'R1'), 3), []) // same cycle → silent
  const ev2 = observeUsage(us, w(95, 'R2'), 4) // new reset boundary → re-arms
  assert.strictEqual(ev2.length, 1)
})

test('observeUsage tolerates null windows', () => {
  assert.deepStrictEqual(observeUsage(createUsageState(), null, 1), [])
})
