const { test } = require('node:test')
const assert = require('node:assert')
const os = require('os'); const path = require('path')
const { SettingsStore } = require('../src/main/settings')
function tmp() { return path.join(os.tmpdir(), 'flux-int-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json') }

test('appearance.intensity defaults to balanced and round-trips', () => {
  const f = tmp()
  const s = new SettingsStore(f)
  assert.strictEqual(s.get().appearance.intensity, 'balanced')
  s.setByPath('appearance.intensity', 'bold')
  assert.strictEqual(new SettingsStore(f).get().appearance.intensity, 'bold')
})
test('invalid intensity throws', () => {
  assert.throws(() => new SettingsStore(tmp()).setByPath('appearance.intensity', 'loud'))
})
