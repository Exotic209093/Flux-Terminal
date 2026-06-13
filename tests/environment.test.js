const { test } = require('node:test')
const assert = require('node:assert')
const { detectCli, detectLoggedIn, getEnvironment } = require('../src/main/environment')

test('detectCli reports found + version when --version succeeds', () => {
  const r = detectCli({ resolveBin: () => 'C:/bin/claude.exe', execFile: () => '2.1.170 (Claude Code)' })
  assert.strictEqual(r.found, true)
  assert.strictEqual(r.version, '2.1.170 (Claude Code)')
  assert.strictEqual(r.path, 'C:/bin/claude.exe')
})

test('detectCli reports not-found when the binary fails', () => {
  const r = detectCli({ resolveBin: () => 'claude', execFile: () => { throw new Error('ENOENT') } })
  assert.strictEqual(r.found, false)
  assert.strictEqual(r.version, null)
  assert.strictEqual(r.path, null) // bare fallback => unknown path
})

test('detectLoggedIn true when credentials carry an access token', () => {
  const fsImpl = { readFileSync: () => JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } }) }
  assert.strictEqual(detectLoggedIn({ fsImpl, home: '/home' }), true)
})

test('detectLoggedIn false when missing/malformed', () => {
  assert.strictEqual(detectLoggedIn({ fsImpl: { readFileSync: () => { throw new Error('no file') } }, home: '/home' }), false)
  assert.strictEqual(detectLoggedIn({ fsImpl: { readFileSync: () => '{}' }, home: '/home' }), false)
})

test('getEnvironment passes session count through and assembles the shape', () => {
  const env = getEnvironment({
    sessionCount: 7,
    resolveBin: () => 'claude',
    execFile: () => '9.9.9',
    fsImpl: { readFileSync: () => JSON.stringify({ claudeAiOauth: { accessToken: 't' } }) },
    home: '/h'
  })
  assert.strictEqual(env.sessionCount, 7)
  assert.strictEqual(env.cli.found, true)
  assert.strictEqual(env.loggedIn, true)
})
