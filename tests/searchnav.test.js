// tests/searchnav.test.js
const test = require('node:test')
const assert = require('node:assert')
const { groupHits, moveSelection } = require('../src/renderer/src/lib/searchnav.js')

test('groupHits groups by session preserving order and returns a flat list aligned with rendering', () => {
  const sessions = [{ sessionId: 'a', file: 'F:\\a.jsonl', title: 'Session A' }]
  const hits = [
    { sessionId: 'a', msgIdx: 1, title: null, project: 'P' },
    { sessionId: 'b', msgIdx: 5, title: 'B title', project: 'Q' },
    { sessionId: 'a', msgIdx: 9, title: null, project: 'P' }
  ]
  const { grouped, flat } = groupHits(hits, sessions)
  assert.strictEqual(grouped.length, 2)
  assert.strictEqual(grouped[0].sessionId, 'a')
  assert.strictEqual(grouped[0].title, 'Session A') // resolved from the live list
  assert.strictEqual(grouped[0].file, 'F:\\a.jsonl')
  assert.strictEqual(grouped[0].hits.length, 2)
  assert.strictEqual(grouped[1].file, null) // unknown session — openById synthesis handles it upstream? no file → falls back
  // flat order matches render order: group 0 hits, then group 1 hits
  assert.deepStrictEqual(flat.map((f) => [f.sessionId, f.hit.msgIdx]), [['a', 1], ['a', 9], ['b', 5]])
})

test('moveSelection clamps to bounds and handles empty lists', () => {
  assert.strictEqual(moveSelection(5, 0, 1), 1)
  assert.strictEqual(moveSelection(5, 4, 1), 4)
  assert.strictEqual(moveSelection(5, 0, -1), 0)
  assert.strictEqual(moveSelection(0, 0, 1), -1)
  assert.strictEqual(moveSelection(3, -1, 1), 0) // first move selects the first hit
})
