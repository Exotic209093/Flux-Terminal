const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { streamLinesSync, parseSessionFile } = require('../src/main/parser')

function tmp(content) {
  const f = path.join(os.tmpdir(), 'flux-jsonl-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.jsonl')
  fs.writeFileSync(f, content)
  return f
}

test('streamLinesSync reconstructs lines across tiny chunks incl. multibyte', () => {
  const f = tmp('héllo\nwörld\nok') // no trailing newline; é/ö are 2-byte UTF-8
  const seen = []
  streamLinesSync(f, (line, isLast) => seen.push([line, isLast]), { chunkSize: 3 })
  assert.deepStrictEqual(seen, [['héllo', false], ['wörld', false], ['ok', true]])
})

test('streamLinesSync: trailing newline => no isLast leftover', () => {
  const f = tmp('a\nb\n')
  const seen = []
  streamLinesSync(f, (line, isLast) => seen.push([line, isLast]), { chunkSize: 1 })
  assert.deepStrictEqual(seen, [['a', false], ['b', false]])
})

test('parseSessionFile (streamed) counts messages and tolerates a truncated final line', () => {
  const lines = [
    JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/p', timestamp: '2026-01-01T00:00:00Z', message: { content: 'hi there' } }),
    JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'claude-x', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: 'hello' }] } }),
    '{ this line is truncated and not valid json'
  ].join('\n')
  const f = tmp(lines) // no trailing newline -> last (bad) line is the expected truncation
  const r = parseSessionFile(f, { timeline: true })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.counts.user, 1)
  assert.strictEqual(r.counts.assistant, 1)
  assert.strictEqual(r.usage.output, 5)
  assert.strictEqual(r.parseErrors, 0) // truncated FINAL line is expected, not an error
  assert.ok(r.timeline.length >= 2)
})

test('parseSessionFile counts an invalid NON-final (newline-terminated) line as a parse error', () => {
  const f = tmp('not json\n' + JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n')
  const r = parseSessionFile(f)
  assert.strictEqual(r.parseErrors, 1)
})

test('parseSessionFile returns ok:false for a missing file', () => {
  const r = parseSessionFile(path.join(os.tmpdir(), 'flux-does-not-exist-' + Date.now() + '.jsonl'))
  assert.strictEqual(r.ok, false)
})
