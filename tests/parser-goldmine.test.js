const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { parseSessionFile } = require('../src/main/parser')

function tmp(lines) {
  const f = path.join(os.tmpdir(), 'flux-gm-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.jsonl')
  fs.writeFileSync(f, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'))
  return f
}

test('timeline items carry uuid/parentUuid and tool_use carries id', () => {
  const f = tmp([
    { type: 'user', uuid: 'u1', parentUuid: null, message: { content: 'hello there' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { id: 'm1', content: [
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 'tool_abc', name: 'Bash', input: { command: 'ls' } }
    ] } }
  ])
  const r = parseSessionFile(f, { timeline: true })
  const user = r.timeline.find((t) => t.kind === 'user')
  const tool = r.timeline.find((t) => t.kind === 'tool_use')
  assert.strictEqual(user.uuid, 'u1')
  assert.strictEqual(user.parentUuid, null)
  assert.strictEqual(tool.uuid, 'a1')
  assert.strictEqual(tool.parentUuid, 'u1')
  assert.strictEqual(tool.id, 'tool_abc')
})
