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
