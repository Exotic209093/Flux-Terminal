const { test } = require('node:test')
const assert = require('node:assert')
const os = require('os')
const path = require('path')
const { SettingsStore } = require('../src/main/settings')

function tmp() { return path.join(os.tmpdir(), 'flux-pt-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json') }

test('push/tray defaults', () => {
  const s = new SettingsStore(tmp())
  assert.deepStrictEqual(s.get().push, { enabled: false, url: '' })
  assert.deepStrictEqual(s.get().tray, { closeToTray: false })
})
test('setByPath persists push.url and tray.closeToTray', () => {
  const f = tmp()
  const s = new SettingsStore(f)
  s.setByPath('push.enabled', true)
  s.setByPath('push.url', 'https://ntfy.sh/mytopic')
  s.setByPath('tray.closeToTray', true)
  const r = new SettingsStore(f).get()
  assert.strictEqual(r.push.enabled, true)
  assert.strictEqual(r.push.url, 'https://ntfy.sh/mytopic')
  assert.strictEqual(r.tray.closeToTray, true)
})
test('invalid types throw', () => {
  const s = new SettingsStore(tmp())
  assert.throws(() => s.setByPath('push.enabled', 'yes'))
  assert.throws(() => s.setByPath('tray.closeToTray', 1))
})
