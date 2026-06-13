const { test } = require('node:test')
const assert = require('node:assert')
const { emptyQueue, enqueue, dequeue, peek, size } = require('../src/renderer/src/lib/composerQueue.js')

test('empty queue', () => {
  const q = emptyQueue()
  assert.strictEqual(size(q), 0)
  assert.strictEqual(peek(q), null)
  assert.deepStrictEqual(dequeue(q), { state: q, msg: null })
})

test('enqueue then dequeue is FIFO and immutable', () => {
  const q0 = emptyQueue()
  const q1 = enqueue(q0, 'a')
  const q2 = enqueue(q1, 'b')
  assert.strictEqual(size(q0), 0) // original untouched
  assert.strictEqual(size(q2), 2)
  assert.strictEqual(peek(q2), 'a')
  const { state: q3, msg } = dequeue(q2)
  assert.strictEqual(msg, 'a')
  assert.strictEqual(size(q3), 1)
  assert.strictEqual(peek(q3), 'b')
})

test('enqueue ignores empty/blank messages', () => {
  const q = enqueue(enqueue(emptyQueue(), '   '), '')
  assert.strictEqual(size(q), 0)
})
