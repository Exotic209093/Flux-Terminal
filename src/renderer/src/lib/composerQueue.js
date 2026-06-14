// Pure FIFO queue for composer sends while a turn is running. Immutable ops so
// React state updates stay predictable.

function emptyQueue() {
  return { items: [] }
}

function size(q) {
  return q && q.items ? q.items.length : 0
}

function peek(q) {
  return size(q) ? q.items[0] : null
}

function enqueue(q, msg) {
  if (typeof msg !== 'string' || !msg.trim()) return q
  return { items: [...q.items, msg] }
}

function dequeue(q) {
  if (!size(q)) return { state: q, msg: null }
  const [msg, ...rest] = q.items
  return { state: { items: rest }, msg }
}

export { emptyQueue, enqueue, dequeue, peek, size }
