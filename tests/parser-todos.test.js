const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { parseSessionFile } = require('../src/main/parser')

function tmp(lines) {
  const f = path.join(os.tmpdir(), 'flux-todos-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.jsonl')
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n'))
  return f
}

test('parser captures the latest TodoWrite todos as lastTodos', () => {
  const f = tmp([
    { type: 'assistant', message: { id: 'm1', content: [
      { type: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos: [
        { content: 'first', status: 'completed' },
        { content: 'second', status: 'in_progress' }
      ] } }
    ] } },
    { type: 'assistant', message: { id: 'm2', content: [
      { type: 'tool_use', id: 't2', name: 'TodoWrite', input: { todos: [
        { content: 'first', status: 'completed' },
        { content: 'second', status: 'completed' },
        { content: 'third', status: 'pending' }
      ] } }
    ] } }
  ])
  const r = parseSessionFile(f, { timeline: true })
  assert.ok(Array.isArray(r.lastTodos))
  assert.strictEqual(r.lastTodos.length, 3) // latest TodoWrite wins
  assert.strictEqual(r.lastTodos[1].status, 'completed')
  assert.strictEqual(r.lastTodos[0].content, 'first')
})

test('no TodoWrite => lastTodos stays null', () => {
  const f = tmp([{ type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: 'hi' }] } }])
  const r = parseSessionFile(f)
  assert.strictEqual(r.lastTodos, null)
})
