const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

// Helpers -----------------------------------------------------------------

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-prompts-'))
  return path.join(dir, 'prompts.json')
}

function makeStore(file) {
  const { PromptStore } = require('../src/main/prompts')
  return new PromptStore(file)
}

// -------------------------------------------------------------------------

test('PromptStore: list returns empty array on missing file', () => {
  const store = makeStore(tmpFile())
  assert.deepStrictEqual(store.list(), [])
})

test('PromptStore: save creates a new prompt with id, timestamps, uses=0', () => {
  const store = makeStore(tmpFile())
  const p = store.save({ name: 'Greet', body: 'Hello {{name}}!' })
  assert.ok(typeof p.id === 'string' && p.id.length > 8)
  assert.strictEqual(p.name, 'Greet')
  assert.strictEqual(p.body, 'Hello {{name}}!')
  assert.strictEqual(p.uses, 0)
  assert.ok(typeof p.createdAt === 'string')
  assert.ok(typeof p.updatedAt === 'string')
})

test('PromptStore: list round-trips through disk', () => {
  const file = tmpFile()
  const store = makeStore(file)
  store.save({ name: 'A', body: 'body A' })
  store.save({ name: 'B', body: 'body B' })

  // fresh instance reads from the same file
  const store2 = makeStore(file)
  const list = store2.list()
  assert.strictEqual(list.length, 2)
  assert.ok(list.some((p) => p.name === 'A'))
  assert.ok(list.some((p) => p.name === 'B'))
})

test('PromptStore: save updates existing prompt, preserves uses and createdAt', () => {
  const store = makeStore(tmpFile())
  const p = store.save({ name: 'Orig', body: 'old body' })
  store.used(p.id)

  const updated = store.save({ id: p.id, name: 'Updated', body: 'new body' })
  assert.strictEqual(updated.id, p.id)
  assert.strictEqual(updated.name, 'Updated')
  assert.strictEqual(updated.body, 'new body')
  assert.strictEqual(updated.uses, 1)
  assert.strictEqual(updated.createdAt, p.createdAt)
})

test('PromptStore: delete removes the prompt', () => {
  const store = makeStore(tmpFile())
  const p = store.save({ name: 'Del', body: 'x' })
  store.delete(p.id)
  assert.strictEqual(store.list().length, 0)
})

test('PromptStore: delete unknown id is a no-op', () => {
  const store = makeStore(tmpFile())
  store.save({ name: 'Keep', body: 'x' })
  store.delete('does-not-exist')
  assert.strictEqual(store.list().length, 1)
})

test('PromptStore: used increments count and persists', () => {
  const file = tmpFile()
  const store = makeStore(file)
  const p = store.save({ name: 'T', body: 'x' })
  store.used(p.id)
  store.used(p.id)

  const list = makeStore(file).list()
  assert.strictEqual(list[0].uses, 2)
})

test('PromptStore: list is sorted most-used first', () => {
  const store = makeStore(tmpFile())
  const a = store.save({ name: 'A', body: 'a' })
  const b = store.save({ name: 'B', body: 'b' })
  store.used(b.id)
  store.used(b.id)
  store.used(a.id)

  const list = store.list()
  assert.strictEqual(list[0].name, 'B')
  assert.strictEqual(list[1].name, 'A')
})

test('PromptStore: atomic write (tmp + rename) — file never contains partial data', () => {
  const file = tmpFile()
  const store = makeStore(file)
  store.save({ name: 'Safe', body: 'x' })

  // After save the file must be valid JSON and contain the version header
  const raw = fs.readFileSync(file, 'utf-8')
  const parsed = JSON.parse(raw)
  assert.strictEqual(parsed.version, 1)
  assert.ok(Array.isArray(parsed.prompts))
})

test('PromptStore: corrupt file recovery replaces with fresh store and backs up', () => {
  const file = tmpFile()
  fs.writeFileSync(file, '{ this is not json }', 'utf-8')

  const store = makeStore(file)
  const list = store.list()
  assert.deepStrictEqual(list, [])

  // A .corrupt backup must exist
  const corruptFile = file + '.corrupt'
  assert.ok(fs.existsSync(corruptFile), '.corrupt backup missing')
  assert.strictEqual(fs.readFileSync(corruptFile, 'utf-8'), '{ this is not json }')
})

test('PromptStore: seed() populates 3 starter prompts on first run', () => {
  const store = makeStore(tmpFile())
  store.seed()
  const list = store.list()
  assert.strictEqual(list.length, 3)
  // seed() is idempotent — calling again changes nothing
  store.seed()
  assert.strictEqual(store.list().length, 3)
})

test('PromptStore: seed() does not overwrite existing prompts', () => {
  const store = makeStore(tmpFile())
  store.save({ name: 'Mine', body: 'custom' })
  store.seed()
  // user prompt survives and no starters are added because store is non-empty
  const list = store.list()
  assert.strictEqual(list.length, 1)
  assert.strictEqual(list[0].name, 'Mine')
})
