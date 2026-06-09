const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { listSubagents, readSubagent, subagentsDirFor } = require('../src/main/subagents')

function makeSession() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-sa-'))
  const sessionId = 'sess-123'
  const file = path.join(proj, sessionId + '.jsonl')
  fs.writeFileSync(file, JSON.stringify({ type: 'user', sessionId, message: { content: 'hi' } }) + '\n')
  const sub = path.join(proj, sessionId, 'subagents')
  fs.mkdirSync(sub, { recursive: true })
  return { file, sub }
}

function writeAgent(sub, id, meta, lines) {
  fs.writeFileSync(path.join(sub, `agent-${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  if (meta) fs.writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify(meta))
}

test('subagentsDirFor maps a session file to its subagents dir', () => {
  const d = subagentsDirFor('/x/y/sess-123.jsonl')
  assert.strictEqual(d, path.join('/x/y/sess-123', 'subagents'))
})

test('listSubagents returns label from meta + aggregated counts; missing dir -> []', () => {
  const { file, sub } = makeSession()
  writeAgent(sub, 'aaa', { agentType: 'Explore', description: 'Find the bug', name: 'scout' }, [
    { type: 'user', message: { content: 'go' } },
    { type: 'assistant', message: { model: 'claude-opus-4-8', usage: { output_tokens: 5 }, content: [{ type: 'text', text: 'done' }] } }
  ])
  const list = listSubagents(file, { liveFresh: false })
  assert.strictEqual(list.length, 1)
  assert.strictEqual(list[0].agentId, 'aaa')
  assert.strictEqual(list[0].label, 'Find the bug')
  assert.strictEqual(list[0].agentType, 'Explore')
  assert.strictEqual(list[0].status, 'done')
  assert.ok(list[0].counts.total >= 1)

  assert.deepStrictEqual(listSubagents('/no/such/sess.jsonl'), [])
})

test('label falls back to first user line when meta is absent', () => {
  const { file, sub } = makeSession()
  writeAgent(sub, 'bbb', null, [{ type: 'user', message: { content: 'You are implementing Task 8: do the thing.' } }])
  const list = listSubagents(file, { liveFresh: false })
  const b = list.find((a) => a.agentId === 'bbb')
  assert.match(b.label, /implementing Task 8/)
})

test('status is running only when live + file mtime is fresh', () => {
  const { file, sub } = makeSession()
  writeAgent(sub, 'ccc', { description: 'Busy agent' }, [{ type: 'user', message: { content: 'go' } }])
  const live = listSubagents(file, { live: true, now: Date.now(), freshMs: 60000 })
  assert.strictEqual(live.find((a) => a.agentId === 'ccc').status, 'running')
  const old = listSubagents(file, { live: true, now: Date.now() + 10 * 60000, freshMs: 60000 })
  assert.strictEqual(old.find((a) => a.agentId === 'ccc').status, 'done')
})

test('readSubagent returns a parsed timeline', () => {
  const { file, sub } = makeSession()
  writeAgent(sub, 'ddd', { description: 'x' }, [
    { type: 'user', message: { content: 'go' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }
  ])
  const detail = readSubagent(file, 'ddd')
  assert.ok(detail.ok !== false)
  assert.ok(Array.isArray(detail.timeline))
  assert.ok(detail.timeline.some((t) => t.kind === 'text' && /hello/.test(t.text)))
})

const { summarizeSubagents } = require('../src/main/subagents')

test('summarizeSubagents counts running vs total', () => {
  const s = summarizeSubagents([{ status: 'running' }, { status: 'done' }, { status: 'running' }])
  assert.deepStrictEqual(s, { running: 2, total: 3 })
  assert.deepStrictEqual(summarizeSubagents([]), { running: 0, total: 0 })
})
