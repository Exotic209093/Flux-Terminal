// tests/settings.test.js
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { SettingsStore, DEFAULTS } = require('../src/main/settings')

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-settings-'))
  return path.join(dir, 'settings.json')
}

test('missing file yields defaults (deep clone, not shared)', () => {
  const s = new SettingsStore(path.join(os.tmpdir(), 'flux-nope', 'x.json'))
  assert.deepStrictEqual(s.get().notify, DEFAULTS.notify)
  s.get().notify.sound = true // mutate the returned copy
  assert.strictEqual(s.get().notify.sound, false) // defaults untouched
})

test('setNotify persists and round-trips through a new instance', () => {
  const file = tmpFile()
  const s = new SettingsStore(file)
  s.setNotify('turnFinished', 'toast')
  s.setNotify('sound', true)
  const reloaded = new SettingsStore(file)
  assert.strictEqual(reloaded.get().notify.turnFinished, 'toast')
  assert.strictEqual(reloaded.get().notify.sound, true)
})

test('setNotify rejects unknown keys and bad modes', () => {
  const s = new SettingsStore(tmpFile())
  assert.throws(() => s.setNotify('bogus', 'toast'))
  assert.throws(() => s.setNotify('turnError', 'sideways'))
  s.setNotify('sound', false) // boolean key accepts boolean
  assert.throws(() => s.setNotify('sound', 'toast'))
})

test('corrupt file falls back to defaults without throwing', () => {
  const file = tmpFile()
  fs.writeFileSync(file, '{not json')
  const s = new SettingsStore(file)
  assert.deepStrictEqual(s.get().notify, DEFAULTS.notify)
})

test('unknown future keys in file are merged under known defaults', () => {
  const file = tmpFile()
  fs.writeFileSync(file, JSON.stringify({ version: 1, notify: { turnError: 'badge' }, futureThing: 7 }))
  const s = new SettingsStore(file)
  assert.strictEqual(s.get().notify.turnError, 'badge') // honored
  assert.strictEqual(s.get().notify.blocked, 'toast') // default filled in
})

test('muted is a boolean notify key, defaults false, round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-mute-'))
  const file = path.join(dir, 's.json')
  const s = new SettingsStore(file)
  assert.strictEqual(s.get().notify.muted, false)
  s.setNotify('muted', true)
  assert.strictEqual(new SettingsStore(file).get().notify.muted, true)
  assert.throws(() => s.setNotify('muted', 'yes')) // must be boolean
})

test('appearance defaults + version 3', () => {
  const { DEFAULTS } = require('../src/main/settings.js')
  assert.strictEqual(DEFAULTS.version, 3)
  assert.deepStrictEqual(DEFAULTS.appearance, { theme: 'midnight', animations: 'auto', model: null })
  assert.strictEqual(DEFAULTS.appearanceMigrated, false)
})

test('setAppearance validates and persists', (t) => {
  const os = require('os'); const path = require('path'); const fs = require('fs')
  const { SettingsStore } = require('../src/main/settings.js')
  const file = path.join(os.tmpdir(), 'flux-set-' + Math.random().toString(36).slice(2) + '.json')
  const s = new SettingsStore(file)
  s.setAppearance('theme', 'aurora')
  s.setAppearance('animations', 'off')
  s.setAppearance('model', 'claude-opus-4-8')
  assert.deepStrictEqual(s.get().appearance, { theme: 'aurora', animations: 'off', model: 'claude-opus-4-8' })
  assert.throws(() => s.setAppearance('animations', 'sometimes'))
  assert.throws(() => s.setAppearance('theme', ''))
  assert.throws(() => s.setAppearance('nope', 'x'))
  const s2 = new SettingsStore(file)
  assert.strictEqual(s2.get().appearance.theme, 'aurora')
  fs.unlinkSync(file)
})

test('setByPath routes appearance/notify/appearanceMigrated', (t) => {
  const os = require('os'); const path = require('path'); const fs = require('fs')
  const { SettingsStore } = require('../src/main/settings.js')
  const file = path.join(os.tmpdir(), 'flux-set-' + Math.random().toString(36).slice(2) + '.json')
  const s = new SettingsStore(file)
  s.setByPath('appearance.theme', 'matrix')
  s.setByPath('notify.sound', true)
  s.setByPath('appearanceMigrated', true)
  const d = s.get()
  assert.strictEqual(d.appearance.theme, 'matrix')
  assert.strictEqual(d.notify.sound, true)
  assert.strictEqual(d.appearanceMigrated, true)
  assert.throws(() => s.setByPath('bogus.key', 1))
  fs.unlinkSync(file)
})

test('v1 file loads forward to v3 with default appearance', (t) => {
  const os = require('os'); const path = require('path'); const fs = require('fs')
  const { SettingsStore } = require('../src/main/settings.js')
  const file = path.join(os.tmpdir(), 'flux-v1-' + Math.random().toString(36).slice(2) + '.json')
  fs.writeFileSync(file, JSON.stringify({ version: 1, notify: { sound: true } }))
  const s = new SettingsStore(file)
  const d = s.get()
  assert.strictEqual(d.version, 3)
  assert.deepStrictEqual(d.appearance, { theme: 'midnight', animations: 'auto', model: null })
  assert.strictEqual(d.notify.sound, true)
  assert.strictEqual(d.appearanceMigrated, false)
  fs.unlinkSync(file)
})
