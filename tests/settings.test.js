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
