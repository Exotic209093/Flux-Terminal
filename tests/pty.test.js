const { test } = require('node:test')
const assert = require('node:assert')
const { isAllowedShell, createPty } = require('../src/main/pty')

test('null shell is allowed (falls back to default)', () => {
  assert.strictEqual(isAllowedShell(null), true)
  assert.strictEqual(isAllowedShell(undefined), true)
})

test('known shells are allowed, by basename, case-insensitively', () => {
  assert.strictEqual(isAllowedShell('powershell.exe'), true)
  assert.strictEqual(isAllowedShell('PowerShell.exe'), true)
  assert.strictEqual(isAllowedShell('cmd.exe'), true)
  assert.strictEqual(isAllowedShell('C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe'), true)
  assert.strictEqual(isAllowedShell('/bin/bash'), true)
})

test('arbitrary executables are rejected', () => {
  assert.strictEqual(isAllowedShell('notepad.exe'), false)
  assert.strictEqual(isAllowedShell('evil.exe'), false)
  assert.strictEqual(isAllowedShell(''), false)
  assert.strictEqual(isAllowedShell(42), false)
})

test('createPty throws (before spawning) for a disallowed shell', () => {
  assert.throws(() => createPty({ shell: 'notepad.exe' }), /not allowed/)
})
