// tests/parser-usage.test.js
const test = require('node:test')
const assert = require('node:assert')
const { freshModel, applyEvent } = require('../src/main/parser')

function assistantRecord(id, usage, model = 'claude-test-1') {
  return { type: 'assistant', message: { id, model, usage, content: [{ type: 'text', text: 'hi' }] } }
}
const USAGE = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 5 }

test('usage is counted once per message.id (streamed blocks share an id with identical usage)', () => {
  const m = freshModel(null)
  applyEvent(assistantRecord('msg_1', USAGE), m, null)
  applyEvent(assistantRecord('msg_1', USAGE), m, null)
  applyEvent(assistantRecord('msg_1', USAGE), m, null)
  assert.strictEqual(m.usage.output, 100)
  assert.strictEqual(m.usage.input, 10)
  assert.strictEqual(m.usage.cacheRead, 1000)
  assert.strictEqual(m.usage.cacheCreation, 5)
  assert.strictEqual(m.counts.assistant, 1)
})

test('distinct message ids accumulate normally', () => {
  const m = freshModel(null)
  applyEvent(assistantRecord('msg_1', USAGE), m, null)
  applyEvent(assistantRecord('msg_2', USAGE), m, null)
  assert.strictEqual(m.usage.output, 200)
  assert.strictEqual(m.counts.assistant, 2)
})

test('records without a message id are each counted (synthetic/error records)', () => {
  const m = freshModel(null)
  applyEvent({ type: 'assistant', message: { usage: USAGE, content: [] } }, m, null)
  applyEvent({ type: 'assistant', message: { usage: USAGE, content: [] } }, m, null)
  assert.strictEqual(m.usage.output, 200)
  assert.strictEqual(m.counts.assistant, 2)
})

test('lastContextTokens tracks the newest message, not duplicates', () => {
  const m = freshModel(null)
  applyEvent(assistantRecord('msg_1', { input_tokens: 50, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), m, null)
  applyEvent(assistantRecord('msg_2', { input_tokens: 70, output_tokens: 1, cache_read_input_tokens: 30, cache_creation_input_tokens: 0 }), m, null)
  assert.strictEqual(m.lastContextTokens, 100)
})

test('timeline items are still collected for duplicate-id records (each block renders)', () => {
  const m = freshModel(null)
  const tl = []
  applyEvent(assistantRecord('msg_1', USAGE), m, tl)
  applyEvent(assistantRecord('msg_1', USAGE), m, tl)
  assert.strictEqual(tl.length, 2)
})
