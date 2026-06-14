const { test } = require('node:test')
const assert = require('node:assert')
const { Notifier, shouldPush, buildPushMessage } = require('../src/main/notify')

test('shouldPush only for needs-you events when enabled + url set', () => {
  const on = { enabled: true, url: 'https://ntfy.sh/t' }
  assert.strictEqual(shouldPush('turn:error', on), true)
  assert.strictEqual(shouldPush('blocked', on), true)
  assert.strictEqual(shouldPush('usage:threshold', on), true)
  assert.strictEqual(shouldPush('turn:finished', on), false)
  assert.strictEqual(shouldPush('turn:error', { enabled: false, url: 'x' }), false)
  assert.strictEqual(shouldPush('turn:error', { enabled: true, url: '' }), false)
})

test('Notifier posts to the push URL on an error event when configured', () => {
  const posts = []
  const n = new Notifier({
    getSettings: () => ({ notify: { turnError: 'toast' }, push: { enabled: true, url: 'https://ntfy.sh/t' } }),
    getWindow: () => null,
    NotificationImpl: class { on() {} show() {} },
    httpPost: (url, msg) => posts.push({ url, msg }),
    now: () => 1000
  })
  n.deliver({ sessionId: 's', title: 'My session', event: { type: 'turn:error' } })
  assert.strictEqual(posts.length, 1)
  assert.strictEqual(posts[0].url, 'https://ntfy.sh/t')
  assert.ok(posts[0].msg.title)
})

test('Notifier does not post when push disabled', () => {
  const posts = []
  const n = new Notifier({
    getSettings: () => ({ notify: { turnError: 'toast' }, push: { enabled: false, url: '' } }),
    getWindow: () => null, NotificationImpl: class { on() {} show() {} },
    httpPost: (url, msg) => posts.push({ url, msg }), now: () => 1000
  })
  n.deliver({ sessionId: 's', title: 't', event: { type: 'turn:error' } })
  assert.strictEqual(posts.length, 0)
})
