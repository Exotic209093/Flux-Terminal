// tests/parser-turns.test.js
const test = require('node:test')
const assert = require('node:assert')
const { freshModel, applyEvent } = require('../src/main/parser')

test('tool_result carrier user records are not counted as user prompts', () => {
  const m = freshModel(null)
  applyEvent({ type: 'user', message: { content: 'do the thing' } }, m, null)
  applyEvent({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }, m, null)
  applyEvent({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok2' }] } }, m, null)
  assert.strictEqual(m.counts.user, 1)
  assert.strictEqual(m.counts.toolResult, 2) // still tallied + rendered
})

test('isMeta user records are not prompts', () => {
  const m = freshModel(null)
  applyEvent({ type: 'user', isMeta: true, message: { content: 'injected context' } }, m, null)
  assert.strictEqual(m.counts.user, 0)
})

test('empty/whitespace string content is not a prompt', () => {
  const m = freshModel(null)
  applyEvent({ type: 'user', message: { content: '   ' } }, m, null)
  assert.strictEqual(m.counts.user, 0)
})

test('image-only array content counts as a prompt (pasted screenshot)', () => {
  const m = freshModel(null)
  applyEvent({ type: 'user', message: { content: [{ type: 'image', source: { type: 'base64', data: 'x' } }] } }, m, null)
  assert.strictEqual(m.counts.user, 1)
})

test('turn_duration system records are tracked', () => {
  const m = freshModel(null)
  applyEvent({ type: 'system', subtype: 'turn_duration', durationMs: 260620 }, m, null)
  applyEvent({ type: 'system', subtype: 'turn_duration', durationMs: 41000 }, m, null)
  assert.strictEqual(m.turnDurationCount, 2)
  assert.strictEqual(m.lastTurnDurationMs, 41000)
  assert.strictEqual(m.counts.system, 2)
})
