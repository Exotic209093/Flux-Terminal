// tests/parser-errors.test.js
const test = require('node:test')
const assert = require('node:assert')
const { isErrorRecord, freshModel, applyEvent } = require('../src/main/parser')

test('isErrorRecord matches the documented best-effort markers', () => {
  assert.strictEqual(isErrorRecord({ isApiErrorMessage: true }), true)
  assert.strictEqual(isErrorRecord({ type: 'result', is_error: true }), true)
  assert.strictEqual(isErrorRecord({ type: 'system', subtype: 'error' }), true)
  assert.strictEqual(isErrorRecord({ type: 'assistant' }), false)
  assert.strictEqual(isErrorRecord({ type: 'result', is_error: false }), false)
  assert.strictEqual(isErrorRecord(null), false)
})

test('applyEvent increments errorCount on error records only', () => {
  const m = freshModel(null)
  applyEvent({ type: 'assistant', message: { content: [] } }, m, null)
  assert.strictEqual(m.errorCount, 0)
  applyEvent({ isApiErrorMessage: true }, m, null)
  applyEvent({ type: 'result', is_error: true }, m, null)
  assert.strictEqual(m.errorCount, 2)
})

test('isErrorRecord matches a real API-error assistant record but NOT a synthetic non-error or a tool error', () => {
  // Real shape observed in ~/.claude/projects: top-level isApiErrorMessage flag.
  const apiError = {
    type: 'assistant',
    isApiErrorMessage: true,
    message: { model: '<synthetic>', content: [{ type: 'text', text: 'API Error: Overloaded' }] }
  }
  const syntheticNonError = {
    type: 'assistant',
    isApiErrorMessage: false,
    message: { model: '<synthetic>', content: [{ type: 'text', text: 'No response requested.' }] }
  }
  const toolError = { type: 'user', message: { content: [{ type: 'tool_result', is_error: true }] } }
  assert.strictEqual(isErrorRecord(apiError), true)
  assert.strictEqual(isErrorRecord(syntheticNonError), false) // <synthetic> alone is not an error
  assert.strictEqual(isErrorRecord(toolError), false) // tool errors are not turn errors
})
