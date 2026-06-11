// tests/sessionlist.test.js
const test = require('node:test')
const assert = require('node:assert')
const { resolveSession, mergeAppend } = require('../src/renderer/src/lib/sessionlist.js')

test('resolveSession finds by id, synthesizes from fallback, or returns null', () => {
  const sessions = [{ sessionId: 'a', file: 'F:\\a.jsonl', title: 'A' }]
  assert.strictEqual(resolveSession(sessions, 'a').title, 'A')
  const synth = resolveSession(sessions, 'b', { file: 'F:\\b.jsonl', title: 'B', cwd: 'F:\\' })
  assert.deepStrictEqual(synth, { sessionId: 'b', file: 'F:\\b.jsonl', title: 'B', cwd: 'F:\\' })
  const minimal = resolveSession(sessions, 'c', { file: 'F:\\c.jsonl' })
  assert.strictEqual(minimal.title, 'c') // short-id fallback title
  assert.strictEqual(resolveSession(sessions, 'd'), null) // unknown, no file → nothing to open
})

test('mergeAppend appends items onto the open detail and refreshes the model fields', () => {
  const detail = { ok: true, file: 'F:\\a.jsonl', counts: { total: 1 }, timeline: [{ kind: 'user', text: 'hi' }] }
  const payload = {
    file: 'F:\\a.jsonl',
    session: { ok: true, file: 'F:\\a.jsonl', counts: { total: 2 } },
    items: [{ kind: 'text', text: 'reply' }]
  }
  const merged = mergeAppend(detail, payload)
  assert.strictEqual(merged.counts.total, 2)
  assert.strictEqual(merged.timeline.length, 2)
  assert.strictEqual(merged.timeline[1].text, 'reply')
})

test('mergeAppend ignores mismatched files and broken details', () => {
  const detail = { ok: true, file: 'F:\\a.jsonl', timeline: [] }
  const other = { file: 'F:\\b.jsonl', session: {}, items: [{}] }
  assert.strictEqual(mergeAppend(detail, other), detail)
  assert.strictEqual(mergeAppend(null, other), null)
  const broken = { ok: false, error: 'x' }
  assert.strictEqual(mergeAppend(broken, other), broken)
})
