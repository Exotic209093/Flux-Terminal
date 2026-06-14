const { test, describe, before } = require('node:test')
const assert = require('node:assert')

describe('reactivity', () => {
  let tokensPerSecFrom, reactiveSpeed
  before(async () => {
    ;({ tokensPerSecFrom, reactiveSpeed } = await import('../src/renderer/src/lib/reactivity.js'))
  })
  test('tokensPerSecFrom computes rate, guards zero/negative', () => {
    assert.strictEqual(tokensPerSecFrom(0, 1000, 100, 2000), 100) // 100 tokens / 1s
    assert.strictEqual(tokensPerSecFrom(0, 0, 100, 2000), 0) // no prevTs
    assert.strictEqual(tokensPerSecFrom(200, 1000, 100, 2000), 0) // token count went down -> 0
    assert.strictEqual(tokensPerSecFrom(0, 2000, 100, 2000), 0) // dt<=0
  })
  test('reactiveSpeed scales base up to ~3x, never below base', () => {
    assert.strictEqual(reactiveSpeed(10, 0), 10)
    assert.ok(reactiveSpeed(10, 1000) <= 30 && reactiveSpeed(10, 1000) >= 25)
    assert.ok(reactiveSpeed(10, 25) > 10)
  })
})
