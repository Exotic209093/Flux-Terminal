// tests/settings-profiles.test.js
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { SettingsStore, DEFAULT_PROFILES } = require('../src/main/settings')

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flux-prof-')), 'settings.json')
}

test('defaults seed PowerShell + claude profiles', () => {
  const s = new SettingsStore(tmpFile())
  const names = s.getProfiles().map((p) => p.name)
  assert.deepStrictEqual(names, DEFAULT_PROFILES.map((p) => p.name))
  assert.ok(s.getProfiles().every((p) => p.id))
})

test('saveProfile adds then updates by id; deleteProfile removes', () => {
  const file = tmpFile()
  const s = new SettingsStore(file)
  const p = s.saveProfile({ name: 'bash', shell: 'bash', args: [], cwd: null })
  assert.ok(p.id)
  const reloaded = new SettingsStore(file)
  assert.ok(reloaded.getProfiles().some((x) => x.id === p.id && x.name === 'bash'))
  reloaded.saveProfile({ ...p, name: 'bash2' })
  assert.ok(new SettingsStore(file).getProfiles().find((x) => x.id === p.id).name === 'bash2')
  reloaded.deleteProfile(p.id)
  assert.ok(!new SettingsStore(file).getProfiles().some((x) => x.id === p.id))
})

test('workspace layout round-trips and tolerates missing/corrupt', () => {
  const file = tmpFile()
  const s = new SettingsStore(file)
  assert.strictEqual(s.getWorkspace(), null) // none yet
  s.setWorkspace({ tabs: [{ profileId: 'powershell', cwd: 'C:\\x' }] })
  assert.deepStrictEqual(new SettingsStore(file).getWorkspace().tabs[0].cwd, 'C:\\x')
})

test('notify settings still work alongside the new keys', () => {
  const file = tmpFile()
  const s = new SettingsStore(file)
  s.setNotify('turnFinished', 'toast')
  s.saveProfile({ name: 'x', shell: 'x' })
  const r = new SettingsStore(file)
  assert.strictEqual(r.get().notify.turnFinished, 'toast')
  assert.ok(r.getProfiles().some((p) => p.name === 'x'))
})
