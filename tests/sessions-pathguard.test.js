// tests/sessions-pathguard.test.js
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { isSessionPathAllowed } = require('../src/main/sessions')

const BASE = 'C:\\Users\\james\\.claude'
const opts = { baseDir: BASE, platform: 'win32' }

test('jsonl files under ~/.claude are allowed (any depth, case-insensitive on win32)', () => {
  assert.strictEqual(isSessionPathAllowed(path.join(BASE, 'projects', 'p', 's.jsonl'), opts), true)
  assert.strictEqual(isSessionPathAllowed(path.join(BASE, 'projects', 'p', 's', 'subagents', 'agent-1.jsonl'), opts), true)
  assert.strictEqual(isSessionPathAllowed('c:\\users\\JAMES\\.claude\\projects\\p\\s.jsonl', opts), true)
})

test('paths outside ~/.claude, traversals, and non-jsonl files are refused', () => {
  assert.strictEqual(isSessionPathAllowed('C:\\Windows\\system32\\config\\SAM', opts), false)
  assert.strictEqual(isSessionPathAllowed(path.join(BASE, '..', 'secrets.jsonl'), opts), false)
  assert.strictEqual(isSessionPathAllowed(path.join(BASE, 'projects', 'p', 'notes.txt'), opts), false)
  assert.strictEqual(isSessionPathAllowed(null, opts), false)
  assert.strictEqual(isSessionPathAllowed(42, opts), false)
})

test('posix platforms compare case-sensitively', () => {
  const popts = { baseDir: '/home/j/.claude', platform: 'linux' }
  assert.strictEqual(isSessionPathAllowed('/home/j/.claude/projects/p/s.jsonl', popts), true)
  assert.strictEqual(isSessionPathAllowed('/home/J/.claude/projects/p/s.jsonl', popts), false)
})
