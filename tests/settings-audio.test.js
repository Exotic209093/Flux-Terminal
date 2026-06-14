const { test } = require('node:test')
const assert = require('node:assert')
const os = require('os'); const path = require('path')
const { SettingsStore } = require('../src/main/settings')
function tmp() { return path.join(os.tmpdir(), 'flux-aud-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json') }

test('audio.enabled defaults false and round-trips', () => {
  const f = tmp()
  assert.strictEqual(new SettingsStore(f).get().audio.enabled, false)
  const s = new SettingsStore(f); s.setByPath('audio.enabled', true)
  assert.strictEqual(new SettingsStore(f).get().audio.enabled, true)
})
test('invalid audio.enabled throws', () => {
  assert.throws(() => new SettingsStore(tmp()).setByPath('audio.enabled', 'yes'))
})
