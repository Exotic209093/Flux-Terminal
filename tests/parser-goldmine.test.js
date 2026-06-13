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

test('tool_result items carry capped toolUseResult (structuredPatch + filePath + stdout)', () => {
  const f = tmp([
    { type: 'user', uuid: 'u2', toolUseResult: { filePath: 'C:/x/a.txt', structuredPatch: [{ oldStart: 1, lines: ['-old', '+new'] }] },
      message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'edited' }] }] } },
    { type: 'user', uuid: 'u3', toolUseResult: { stdout: 'line1\nline2' },
      message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'ran' }] }] } }
  ])
  const r = parseSessionFile(f, { timeline: true })
  const results = r.timeline.filter((t) => t.kind === 'tool_result')
  assert.strictEqual(results[0].result.filePath, 'C:/x/a.txt')
  assert.ok(Array.isArray(results[0].result.structuredPatch))
  assert.strictEqual(results[1].result.stdout, 'line1\nline2')
})

test('an oversized structuredPatch is marked truncated, not inlined whole', () => {
  const huge = Array.from({ length: 5000 }, (_, i) => ({ line: 'x'.repeat(20), n: i }))
  const f = tmp([
    { type: 'user', toolUseResult: { structuredPatch: huge },
      message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'big' }] }] } }
  ])
  const r = parseSessionFile(f, { timeline: true })
  const res = r.timeline.find((t) => t.kind === 'tool_result')
  assert.strictEqual(res.result.structuredPatch.truncated, true)
})

test('attachment records become hook timeline items and bump hookCount', () => {
  const f = tmp([
    { type: 'attachment', uuid: 'h1', timestamp: '2026-01-01T00:00:00Z',
      attachment: { type: 'hook_success', hookName: 'SessionStart:startup', hookEvent: 'SessionStart', toolUseID: 'tu9', content: '', stdout: 'ran the hook' } }
  ])
  const r = parseSessionFile(f, { timeline: true })
  const hook = r.timeline.find((t) => t.kind === 'hook')
  assert.strictEqual(hook.hookName, 'SessionStart:startup')
  assert.strictEqual(hook.status, 'hook_success')
  assert.strictEqual(hook.toolUseId, 'tu9')
  assert.strictEqual(hook.text, 'ran the hook')
  assert.strictEqual(r.hookCount, 1)
})

test('compact_boundary system records become compact markers and bump compactions', () => {
  const f = tmp([
    { type: 'system', subtype: 'compact_boundary', uuid: 'c1', timestamp: '2026-01-01T00:00:00Z' }
  ])
  const r = parseSessionFile(f, { timeline: true })
  const c = r.timeline.find((t) => t.kind === 'compact')
  assert.ok(c)
  assert.strictEqual(r.compactions, 1)
})
