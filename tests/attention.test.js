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

// ---- turn_duration ("td") mode: exact closes from system records --------------
function tdObs(ts, mtimeMs, u, a, tdCount, tdMs, e = 0) {
  return { ts, mtimeMs, userCount: u, assistantCount: a, errorCount: e, turnDurationCount: tdCount, lastTurnDurationMs: tdMs }
}

test('td mode: mid-turn assistant records do not close the turn; the turn_duration record does, with the exact duration', () => {
  const s = createAttentionState()
  observe(s, tdObs(0, 0, 5, 5, 3, 0)) // baseline on a transcript that writes turn_duration
  observe(s, tdObs(1000, 1000, 6, 5, 3, 0)) // new prompt → turn opens
  const mid = observe(s, tdObs(5000, 5000, 6, 6, 3, 0)) // first reply lands mid-turn
  assert.deepStrictEqual(mid, [])
  assert.strictEqual(s.turnOpen, true)
  const done = observe(s, tdObs(9000, 9000, 6, 8, 4, 260620)) // CLI wrote turn_duration
  assert.strictEqual(done.length, 1)
  assert.strictEqual(done[0].type, 'turn:finished')
  assert.strictEqual(done[0].durationMs, 260620)
  assert.strictEqual(s.turnOpen, false)
})

test('td mode: a short exact duration does not notify', () => {
  const s = createAttentionState()
  observe(s, tdObs(0, 0, 0, 0, 1, 0))
  observe(s, tdObs(1000, 1000, 1, 0, 1, 0))
  const done = observe(s, tdObs(9000, 9000, 1, 1, 2, 5000)) // 5s < MIN_TURN_MS
  assert.deepStrictEqual(done, [])
  assert.strictEqual(s.turnOpen, false)
})

test('td mode: blocked still fires after assistant records stream mid-turn', () => {
  const s = createAttentionState()
  observe(s, tdObs(0, 0, 0, 0, 1, 0))
  observe(s, tdObs(1000, 1000, 1, 0, 1, 0)) // turn opens
  observe(s, tdObs(2000, 2000, 1, 1, 1, 0)) // reply streams (write at ts=2000), turn stays open
  const ev = observe(s, tdObs(2000 + BLOCKED_MS + 1, 2000, 1, 1, 1, 0)) // silence past BLOCKED_MS
  assert.strictEqual(ev.length, 1)
  assert.strictEqual(ev[0].type, 'blocked')
})

test('legacy transcripts (no turn_duration anywhere) keep the assistant-close behavior', () => {
  const s = createAttentionState()
  observe(s, obs(0, 0, 0, 0))
  observe(s, obs(1000, 1000, 1, 0))
  const ev = observe(s, obs(1000 + MIN_TURN_MS + 1, 5000, 1, 1))
  assert.strictEqual(ev.length, 1)
  assert.strictEqual(ev[0].type, 'turn:finished')
})

test('td mode: queued prompt — previous turn closes and the new turn opens in the same observation', () => {
  const s = createAttentionState()
  observe(s, tdObs(0, 0, 5, 5, 3, 0)) // baseline, td-capable
  observe(s, tdObs(1000, 1000, 6, 5, 3, 0)) // turn 1 opens
  // one poll sees turn 1's td record AND the queued prompt for turn 2
  const ev = observe(s, tdObs(60000, 60000, 7, 7, 4, 45000))
  assert.strictEqual(ev.length, 1)
  assert.strictEqual(ev[0].type, 'turn:finished')
  assert.strictEqual(ev[0].durationMs, 45000)
  assert.strictEqual(s.turnOpen, true) // turn 2 is alive
  // turn 2's own td record later closes it with its own duration
  const ev2 = observe(s, tdObs(120000, 120000, 7, 9, 5, 55000))
  assert.strictEqual(ev2.length, 1)
  assert.strictEqual(ev2[0].durationMs, 55000)
})

test('a write while blocked clears the standing blocked state and re-arms the notification', () => {
  const s = createAttentionState()
  observe(s, obs(0, 0, 0, 0))
  observe(s, obs(1000, 1000, 1, 0)) // turn opens, last write @1000
  const first = observe(s, obs(1000 + BLOCKED_MS + 1, 1000, 1, 0)) // stall → blocked
  assert.strictEqual(first.length, 1)
  assert.strictEqual(s.blockedEmitted, true)
  observe(s, obs(1000 + BLOCKED_MS + 5000, 99999, 1, 0)) // user approved → file written
  assert.strictEqual(s.blockedEmitted, false) // standing status cleared
  const second = observe(s, obs(1000 + BLOCKED_MS + 5000 + BLOCKED_MS + 1, 99999, 1, 0)) // second stall
  assert.strictEqual(second.length, 1)
  assert.strictEqual(second[0].type, 'blocked')
})

test('td mode: an errored turn whose error + turn_duration land in one tick fires turn:error, not turn:finished', () => {
  const s = createAttentionState()
  observe(s, tdObs(0, 0, 5, 5, 3, 0)) // baseline, td-capable
  observe(s, tdObs(1000, 1000, 6, 5, 3, 0)) // turn opens
  const ev = observe(s, tdObs(212000, 212000, 6, 7, 4, 211906, 1)) // error + td same tick
  assert.strictEqual(ev.length, 1)
  assert.strictEqual(ev[0].type, 'turn:error')
  assert.strictEqual(s.turnOpen, false)
})
