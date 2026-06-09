const test = require('node:test')
const assert = require('node:assert')

test('models list has id+label and a resolvable default', async () => {
  const { MODELS, DEFAULT_MODEL, isKnownModel } = await import('../src/renderer/src/lib/models.js')
  assert.ok(Array.isArray(MODELS) && MODELS.length >= 4)
  for (const m of MODELS) {
    assert.strictEqual(typeof m.id, 'string')
    assert.strictEqual(typeof m.label, 'string')
  }
  assert.ok(MODELS.some((m) => m.id === DEFAULT_MODEL), 'default must be in the list')
  assert.strictEqual(isKnownModel(DEFAULT_MODEL), true)
  assert.strictEqual(isKnownModel('nope'), false)
})
