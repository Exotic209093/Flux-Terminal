const { test } = require('node:test')
const assert = require('node:assert')
const { Notifier } = require('../src/main/notify')

function mk(now) {
  const shown = []
  const n = new Notifier({
    getSettings: () => ({ notify: { turnError: 'toast' } }),
    getWindow: () => null,
    NotificationImpl: class { constructor(o) { this.o = o } on() {} show() { shown.push(this.o) } },
    now: () => now.t
  })
  return { n, shown }
}

test('snooze suppresses delivery until the deadline, then resumes', () => {
  const now = { t: 1000 }
  const { n, shown } = mk(now)
  n.snooze('s1', 1) // 1 minute
  n.deliver({ sessionId: 's1', title: 'x', event: { type: 'turn:error' } })
  assert.strictEqual(shown.length, 0) // snoozed
  now.t = 1000 + 61_000 // past the 1-min deadline
  n.deliver({ sessionId: 's1', title: 'x', event: { type: 'turn:error' } })
  assert.strictEqual(shown.length, 1) // resumed
})

test('snooze is per-session', () => {
  const now = { t: 5000 }
  const { n, shown } = mk(now)
  n.snooze('s1', 10)
  n.deliver({ sessionId: 's2', title: 'y', event: { type: 'turn:error' } })
  assert.strictEqual(shown.length, 1) // s2 not snoozed
})
