// tests/notify.test.js
const test = require('node:test')
const assert = require('node:assert')
const { Notifier, titleFor } = require('../src/main/notify')

function fakeWin() {
  return {
    focused: false,
    overlay: null,
    flashed: false,
    isFocused() { return this.focused },
    isDestroyed() { return false },
    setOverlayIcon(img, desc) { this.overlay = desc },
    flashFrame(b) { this.flashed = b },
    focus() { this.focused = true },
    webContents: { send() {} }
  }
}

function fakeNotificationFactory(sink) {
  return class FakeNotification {
    constructor(opts) { this.opts = opts; sink.created.push(opts) }
    show() { sink.shown.push(this.opts) }
    on() {}
  }
}

const SETTINGS = { notify: { turnFinished: 'badge', turnError: 'toast', blocked: 'toast', usageThreshold: 'toast', sound: false } }

function makeNotifier(world) {
  return new Notifier({
    getWindow: () => world.win,
    getSettings: () => world.settings,
    getOpenSessionId: () => world.openId,
    NotificationImpl: fakeNotificationFactory(world.sink),
    beep: () => world.beeps++,
    now: () => world.now
  })
}

function world() {
  return { win: fakeWin(), settings: JSON.parse(JSON.stringify(SETTINGS)), openId: null, now: 0, beeps: 0,
    sink: { created: [], shown: [] } }
}

test('toast event shows a Notification', () => {
  const w = world()
  makeNotifier(w).deliver({ sessionId: 's', title: 'My sesh', event: { type: 'turn:error' } })
  assert.strictEqual(w.sink.shown.length, 1)
  assert.match(w.sink.shown[0].title, /error/i)
})

test('badge event sets overlay + flash, no toast', () => {
  const w = world()
  makeNotifier(w).deliver({ sessionId: 's', title: 'x', event: { type: 'turn:finished' } })
  assert.strictEqual(w.sink.shown.length, 0)
  assert.ok(w.win.overlay)
  assert.strictEqual(w.win.flashed, true)
})

test('off mode delivers nothing', () => {
  const w = world()
  w.settings.notify.turnError = 'off'
  makeNotifier(w).deliver({ sessionId: 's', title: 'x', event: { type: 'turn:error' } })
  assert.strictEqual(w.sink.shown.length, 0)
  assert.strictEqual(w.win.overlay, null)
})

test('suppressed when window focused AND that session is open', () => {
  const w = world()
  w.win.focused = true
  w.openId = 's'
  makeNotifier(w).deliver({ sessionId: 's', title: 'x', event: { type: 'turn:error' } })
  assert.strictEqual(w.sink.shown.length, 0)
  // a DIFFERENT open session does not suppress
  w.openId = 'other'
  makeNotifier(w).deliver({ sessionId: 's', title: 'x', event: { type: 'turn:error' } })
  assert.strictEqual(w.sink.shown.length, 1)
})

test('coalesces repeat events for the same session within 10s', () => {
  const w = world()
  const n = makeNotifier(w)
  n.deliver({ sessionId: 's', title: 'x', event: { type: 'turn:error' } })
  w.now = 5000
  n.deliver({ sessionId: 's', title: 'x', event: { type: 'turn:error' } }) // within 10s → dropped
  assert.strictEqual(w.sink.shown.length, 1)
  w.now = 11000
  n.deliver({ sessionId: 's', title: 'x', event: { type: 'turn:error' } }) // window passed
  assert.strictEqual(w.sink.shown.length, 2)
})

test('sound beeps only when enabled', () => {
  const w = world()
  w.settings.notify.sound = true
  makeNotifier(w).deliver({ sessionId: 's', title: 'x', event: { type: 'turn:error' } })
  assert.strictEqual(w.beeps, 1)
})

test('clicking a toast focuses the window and sends notify:open-session', () => {
  const w = world()
  const sent = []
  w.win.webContents = { send: (channel, payload) => sent.push({ channel, payload }) }
  let clickCb = null
  const Factory = class {
    constructor(opts) { this.opts = opts; w.sink.created.push(opts) }
    show() { w.sink.shown.push(this.opts) }
    on(evt, cb) { if (evt === 'click') clickCb = cb }
  }
  const n = new Notifier({
    getWindow: () => w.win,
    getSettings: () => w.settings,
    getOpenSessionId: () => w.openId,
    NotificationImpl: Factory,
    beep: () => {},
    now: () => w.now
  })
  n.deliver({ sessionId: 's1', title: 'x', event: { type: 'turn:error' } })
  assert.ok(clickCb, 'click handler should be registered')
  clickCb()
  assert.strictEqual(w.win.focused, true)
  assert.strictEqual(sent.length, 1)
  assert.strictEqual(sent[0].channel, 'notify:open-session')
  assert.strictEqual(sent[0].payload.sessionId, 's1')
})

test('records delivered notices to a bounded history (newest first) and fires onHistory', () => {
  const w = world()
  const hist = []
  const n = new Notifier({
    getWindow: () => w.win, getSettings: () => w.settings, getOpenSessionId: () => w.openId,
    NotificationImpl: fakeNotificationFactory(w.sink), beep: () => {}, now: () => w.now,
    onHistory: (e) => hist.push(e)
  })
  n.deliver({ sessionId: 's1', title: 'A', event: { type: 'turn:error' } })
  w.now = 20000
  n.deliver({ sessionId: 's2', title: 'B', event: { type: 'turn:finished' } })
  const h = n.getHistory()
  assert.strictEqual(h.length, 2)
  assert.strictEqual(h[0].sessionId, 's2') // newest first
  assert.strictEqual(h[0].mode, 'badge') // turn:finished default = badge
  assert.strictEqual(h[1].mode, 'toast') // turn:error default = toast
  assert.strictEqual(hist.length, 2) // onHistory fired per delivery
})

test('history is bounded to MAX_HISTORY', () => {
  const { Notifier, MAX_HISTORY } = require('../src/main/notify')
  const w = world()
  const n = new Notifier({ getWindow: () => w.win, getSettings: () => w.settings, getOpenSessionId: () => w.openId, NotificationImpl: fakeNotificationFactory(w.sink), beep: () => {}, now: () => w.now })
  for (let i = 0; i < MAX_HISTORY + 10; i++) { w.now = i * 20000; n.deliver({ sessionId: 's' + i, title: 't', event: { type: 'turn:error' } }) }
  assert.strictEqual(n.getHistory().length, MAX_HISTORY)
})

test('muted short-circuits delivery (no toast/badge/history)', () => {
  const w = world()
  w.settings.notify.muted = true
  const n = makeNotifier(w)
  n.deliver({ sessionId: 's', title: 'x', event: { type: 'turn:error' } })
  assert.strictEqual(w.sink.shown.length, 0)
  assert.strictEqual(w.win.overlay, null)
  assert.strictEqual(n.getHistory().length, 0)
})

test('test() always shows a toast bypassing mute/suppression/coalescing and records mode test', () => {
  const w = world()
  w.settings.notify.muted = true
  w.win.focused = true
  w.openId = '__test__'
  const n = makeNotifier(w)
  n.test()
  n.test() // immediate repeat — coalescing bypassed
  assert.strictEqual(w.sink.shown.length, 2)
  assert.strictEqual(n.getHistory()[0].mode, 'test')
})
