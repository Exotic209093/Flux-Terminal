const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { SettingsStore } = require('../src/main/settings')

function tmpFile() {
  return path.join(os.tmpdir(), 'flux-set-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json')
}

test('onboarding defaults to not-dismissed', () => {
  const s = new SettingsStore(tmpFile())
  assert.deepStrictEqual(s.get().onboarding, { dismissed: false, version: 1 })
})

test('setByPath persists onboarding.dismissed and survives reload', () => {
  const f = tmpFile()
  const s = new SettingsStore(f)
  s.setByPath('onboarding.dismissed', true)
  assert.strictEqual(s.get().onboarding.dismissed, true)
  const reloaded = new SettingsStore(f)
  assert.strictEqual(reloaded.get().onboarding.dismissed, true)
})

test('a v2 file without onboarding loads with the default section', () => {
  const f = tmpFile()
  fs.writeFileSync(f, JSON.stringify({ version: 2, appearance: { theme: 'nord', animations: 'on', model: null } }))
  const s = new SettingsStore(f)
  assert.deepStrictEqual(s.get().onboarding, { dismissed: false, version: 1 })
  assert.strictEqual(s.get().appearance.theme, 'nord')
})

test('invalid onboarding value throws', () => {
  const s = new SettingsStore(tmpFile())
  assert.throws(() => s.setByPath('onboarding.dismissed', 'yes'))
})
