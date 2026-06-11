// tests/resume.test.js
const test = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('node:events')
const { ClaudeRunner, isValidSessionId, isValidModel, needsShell, resolveClaudeBin } = require('../src/main/resume')

const UUID_A = '11111111-2222-3333-4444-555555555555'
const UUID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function fakeChild() {
  const c = new EventEmitter()
  c.stderr = new EventEmitter()
  c.stdin = { written: [], write(d) { this.written.push(d) }, end() { this.ended = true } }
  c.killed = false
  c.kill = () => { c.killed = true }
  return c
}

function runnerWith(overrides = {}) {
  const spawned = [] // { bin, args, opts, child }
  const statuses = [] // { sessionId, state, error }
  const runner = new ClaudeRunner({
    bin: 'C:\\tools\\claude.exe',
    spawnImpl: (bin, args, opts) => { const child = fakeChild(); spawned.push({ bin, args, opts, child }); return child },
    onStatus: (sessionId, state, error) => statuses.push({ sessionId, state, error }),
    now: () => 1_000_000,
    fsImpl: { existsSync: () => true, statSync: () => ({ mtimeMs: 0 }) },
    findFile: () => null,
    timeoutMs: 999_999,
    ...overrides
  })
  return { runner, spawned, statuses }
}

test('validators: UUID session ids, conservative model charset, cmd-shim shell detection', () => {
  assert.strictEqual(isValidSessionId(UUID_A), true)
  assert.strictEqual(isValidSessionId('x" & calc & "'), false)
  assert.strictEqual(isValidSessionId('../../etc'), false)
  assert.strictEqual(isValidModel('claude-opus-4-8'), true)
  assert.strictEqual(isValidModel(null), true) // optional
  assert.strictEqual(isValidModel('x" & calc'), false)
  assert.strictEqual(isValidModel('--dangerously-skip-permissions'), false)
  assert.strictEqual(needsShell('claude'), true)
  assert.strictEqual(needsShell('C:\\Users\\j\\AppData\\Roaming\\npm\\claude.cmd'), true)
  assert.strictEqual(needsShell('C:\\tools\\claude.exe'), false)
})

test('send rejects an invalid sessionId or model without spawning', () => {
  const { runner, spawned } = runnerWith()
  assert.strictEqual(runner.send({ sessionId: 'x" & calc & "', message: 'hi' }).ok, false)
  assert.strictEqual(runner.send({ sessionId: UUID_A, message: 'hi', model: 'bad model name!' }).ok, false)
  assert.strictEqual(spawned.length, 0)
})

test('send spawns claude --resume with the prompt on stdin and no shell for an exe', () => {
  const { runner, spawned, statuses } = runnerWith()
  const res = runner.send({ sessionId: UUID_A, cwd: 'C:\\proj', message: 'hello', model: 'claude-opus-4-8' })
  assert.strictEqual(res.ok, true)
  assert.strictEqual(spawned.length, 1)
  assert.deepStrictEqual(spawned[0].args, ['--resume', UUID_A, '-p', '--model', 'claude-opus-4-8'])
  assert.strictEqual(spawned[0].opts.shell, false)
  assert.deepStrictEqual(spawned[0].child.stdin.written, ['hello'])
  assert.strictEqual(spawned[0].child.stdin.ended, true)
  assert.deepStrictEqual(statuses[0], { sessionId: UUID_A, state: 'running', error: null })
})

test('concurrent sends are tracked independently; the first exit does not clobber the second', () => {
  const { runner, spawned, statuses } = runnerWith()
  runner.send({ sessionId: UUID_A, message: 'a' })
  runner.send({ sessionId: UUID_B, message: 'b' })
  assert.strictEqual(runner.running(), 2)
  spawned[0].child.emit('exit', 0)
  assert.strictEqual(runner.running(), 1)
  assert.ok(statuses.find((s) => s.sessionId === UUID_A && s.state === 'done'))
  // interrupt now targets the remaining (most recent) child
  assert.strictEqual(runner.interrupt().ok, true)
  assert.strictEqual(spawned[1].child.killed, true)
  spawned[1].child.emit('exit', 1)
  assert.ok(statuses.find((s) => s.sessionId === UUID_B && s.state === 'interrupted'))
})

test('interrupt with no running child reports nothing running', () => {
  const { runner } = runnerWith()
  assert.deepStrictEqual(runner.interrupt(), { ok: false, error: 'nothing running' })
})

test('non-zero exit surfaces trimmed stderr; ENOENT gets a friendly message', () => {
  const { runner, spawned, statuses } = runnerWith()
  runner.send({ sessionId: UUID_A, message: 'a' })
  spawned[0].child.stderr.emit('data', Buffer.from('boom'))
  spawned[0].child.emit('exit', 2)
  assert.ok(statuses.find((s) => s.state === 'error' && s.error === 'boom'))

  const second = runnerWith()
  second.runner.send({ sessionId: UUID_A, message: 'a' })
  const enoent = new Error('spawn claude ENOENT')
  enoent.code = 'ENOENT'
  second.spawned[0].child.emit('error', enoent)
  assert.ok(second.statuses.find((s) => s.state === 'error' && /Claude Code CLI not found/.test(s.error)))
})

test('newChat generates a session id and passes --session-id', () => {
  const { runner, spawned } = runnerWith()
  const res = runner.newChat({ message: 'start', cwd: 'C:\\proj', model: 'claude-opus-4-8' })
  assert.strictEqual(res.ok, true)
  assert.strictEqual(isValidSessionId(res.sessionId), true)
  assert.strictEqual(res.cwd, 'C:\\proj')
  assert.deepStrictEqual(spawned[0].args, ['-p', '--session-id', res.sessionId, '--model', 'claude-opus-4-8'])
})

test('live-session guard: a freshly-written file we did not just send to is refused', () => {
  const { runner, spawned } = runnerWith({
    findFile: () => 'C:\\fake\\s.jsonl',
    fsImpl: { existsSync: () => true, statSync: () => ({ mtimeMs: 995_000 }) } // 5s ago < 10s guard
  })
  const res = runner.send({ sessionId: UUID_A, message: 'hi' })
  assert.strictEqual(res.ok, false)
  assert.match(res.error, /active right now/)
  assert.strictEqual(spawned.length, 0)
})

test('timeout kills the child and reports an error', () => {
  const { runner, spawned, statuses } = runnerWith({ timeoutMs: 0 })
  runner.send({ sessionId: UUID_A, message: 'hi' })
  return new Promise((resolve) => setTimeout(() => {
    assert.strictEqual(spawned[0].child.killed, true)
    assert.ok(statuses.find((s) => s.state === 'error' && /didn't respond in time/.test(s.error)))
    resolve()
  }, 20))
})

test('resolveClaudeBin on win32 prefers .exe, then .cmd, ignoring extensionless sh shims', () => {
  const fnmShape = () => 'C:\\Users\\j\\.fnm-npm-global\\claude\r\nC:\\Users\\j\\.fnm-npm-global\\claude.cmd\r\n'
  assert.strictEqual(resolveClaudeBin({ platform: 'win32', execFile: fnmShape }), 'C:\\Users\\j\\.fnm-npm-global\\claude.cmd')
  const exeShape = () => 'C:\\x\\claude\r\nC:\\a\\claude.exe\r\nC:\\b\\claude.cmd\r\n'
  assert.strictEqual(resolveClaudeBin({ platform: 'win32', execFile: exeShape }), 'C:\\a\\claude.exe')
  assert.strictEqual(resolveClaudeBin({ platform: 'win32', execFile: () => 'C:\\only\\claude\r\n' }), 'claude')
  assert.strictEqual(resolveClaudeBin({ platform: 'linux', execFile: () => '/usr/local/bin/claude\n' }), '/usr/local/bin/claude')
  assert.strictEqual(resolveClaudeBin({ platform: 'win32', execFile: () => { throw new Error('not found') } }), 'claude')
})

test('a second send to the same session while one is running is refused (no orphaned child)', () => {
  const { runner, spawned } = runnerWith()
  assert.strictEqual(runner.send({ sessionId: UUID_A, message: 'one' }).ok, true)
  const res = runner.send({ sessionId: UUID_A, message: 'two' })
  assert.strictEqual(res.ok, false)
  assert.match(res.error, /Already sending/)
  assert.strictEqual(spawned.length, 1)
  spawned[0].child.emit('exit', 0)
  assert.strictEqual(runner.send({ sessionId: UUID_A, message: 'three' }).ok, true) // after exit it works again
})

test('a cmd-shim path with spaces is quoted for the shell', () => {
  const { runner, spawned } = runnerWith({ bin: 'C:\\Users\\John Smith\\npm\\claude.cmd' })
  runner.send({ sessionId: UUID_A, message: 'hi' })
  assert.strictEqual(spawned[0].bin, '"C:\\Users\\John Smith\\npm\\claude.cmd"')
  assert.strictEqual(spawned[0].opts.shell, true)
})
