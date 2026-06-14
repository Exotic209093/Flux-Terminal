const { test } = require('node:test')
const assert = require('node:assert')
const { composeCards, cardsChanged } = require('../src/main/missioncontrol')

function rec(over) {
  return { sessionId: 's', file: 'f', project: 'p', cwd: 'c', title: 't', model: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, subagents: { running: 0, total: 0 },
    lastSnippet: '', lastActivityMs: 1000, hasError: false, blocked: false, turnOpen: false, ...over }
}

test('composeCards surfaces attnSince and todos', () => {
  const cards = composeCards([rec({ attnSince: 500, todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] })], 2000)
  assert.strictEqual(cards[0].attnSince, 500)
  assert.strictEqual(cards[0].todos.length, 2)
})

test('cardsChanged flips when the todo signature changes', () => {
  const a = composeCards([rec({ todos: [{ content: 'x', status: 'pending' }] })], 1000)
  const b = composeCards([rec({ todos: [{ content: 'x', status: 'completed' }] })], 1000)
  assert.strictEqual(cardsChanged(a, b), true)
})

test('cardsChanged stays false when nothing relevant changed', () => {
  const a = composeCards([rec({ todos: [{ content: 'x', status: 'pending' }] })], 1000)
  const b = composeCards([rec({ todos: [{ content: 'x', status: 'pending' }] })], 1000)
  assert.strictEqual(cardsChanged(a, b), false)
})
