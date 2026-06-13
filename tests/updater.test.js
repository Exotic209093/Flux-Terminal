const { test } = require('node:test')
const assert = require('node:assert')
const { shouldAutoUpdate, initAutoUpdate } = require('../src/main/updater')

test('shouldAutoUpdate only when packaged', () => {
  assert.strictEqual(shouldAutoUpdate({ isPackaged: true }), true)
  assert.strictEqual(shouldAutoUpdate({ isPackaged: false }), false)
  assert.strictEqual(shouldAutoUpdate(undefined), false)
})

test('initAutoUpdate is a no-op (returns false) in dev / unpackaged', () => {
  let touched = false
  const fake = { on() { touched = true }, checkForUpdatesAndNotify() { touched = true } }
  const r = initAutoUpdate({ app: { isPackaged: false }, updater: fake })
  assert.strictEqual(r, false)
  assert.strictEqual(touched, false)
})

test('initAutoUpdate wires handlers and checks for updates when packaged', () => {
  const events = []
  const fake = {
    on(name) { events.push(name) },
    checkForUpdatesAndNotify() { events.push('checked') }
  }
  const r = initAutoUpdate({ app: { isPackaged: true }, updater: fake, logger: { log() {}, error() {} } })
  assert.strictEqual(r, true)
  assert.ok(events.includes('error'))
  assert.ok(events.includes('update-available'))
  assert.ok(events.includes('update-downloaded'))
  assert.ok(events.includes('checked'))
})
