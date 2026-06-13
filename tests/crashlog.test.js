const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { appendLine, rotateIfNeeded } = require('../src/main/crashlog')

function tmpDir() {
  const d = path.join(os.tmpdir(), 'flux-crash-' + Date.now() + '-' + Math.random().toString(36).slice(2))
  fs.mkdirSync(d, { recursive: true })
  return d
}

test('appendLine writes a JSON line and creates the dir', () => {
  const file = path.join(tmpDir(), 'logs', 'main.log')
  appendLine(file, 'uncaughtException', 'boom', 'stack here')
  const body = fs.readFileSync(file, 'utf-8').trim()
  const obj = JSON.parse(body)
  assert.strictEqual(obj.kind, 'uncaughtException')
  assert.strictEqual(obj.message, 'boom')
  assert.strictEqual(obj.stack, 'stack here')
})

test('appendLine never throws even when the write fails', () => {
  const fsImpl = { mkdirSync() {}, statSync() { throw new Error('x') }, appendFileSync() { throw new Error('nope') } }
  assert.doesNotThrow(() => appendLine('/nope/main.log', 'k', 'm', 's', { fsImpl }))
})

test('rotateIfNeeded shifts files when over the threshold', () => {
  const file = path.join(tmpDir(), 'main.log')
  fs.writeFileSync(file, 'x'.repeat(50))
  rotateIfNeeded(file, { maxBytes: 10, keep: 3 })
  assert.ok(fs.existsSync(file.replace(/\.log$/, '.1.log')))
  assert.ok(!fs.existsSync(file)) // current was renamed away
})

test('rotateIfNeeded does nothing under the threshold', () => {
  const file = path.join(tmpDir(), 'main.log')
  fs.writeFileSync(file, 'tiny')
  rotateIfNeeded(file, { maxBytes: 1000 })
  assert.ok(fs.existsSync(file))
  assert.ok(!fs.existsSync(file.replace(/\.log$/, '.1.log')))
})
