// tests/ptymanager.test.js
const test = require('node:test')
const assert = require('node:assert')
const { PtyManager } = require('../src/main/ptymanager')

function fakePty() {
  return {
    _data: null, _exit: null, writes: [], resized: null, killed: false,
    onData(cb) { this._data = cb },
    onExit(cb) { this._exit = cb },
    write(d) { this.writes.push(d) },
    resize(c, r) { this.resized = { c, r } },
    kill() { this.killed = true }
  }
}

function managerWith() {
  const created = []
  const data = []
  const exits = []
  const mgr = new PtyManager({
    spawn: (opts) => { const p = fakePty(); p.opts = opts; created.push(p); return p },
    onData: (id, d) => data.push({ id, d }),
    onExit: (id, code) => exits.push({ id, code })
  })
  return { mgr, created, data, exits }
}

test('spawn keys ptys by id and routes their data with the id', () => {
  const { mgr, created, data } = managerWith()
  mgr.spawn('a', { cols: 80, rows: 24 })
  mgr.spawn('b', { cols: 80, rows: 24 })
  assert.strictEqual(mgr.size, 2)
  created[0]._data('hello')
  created[1]._data('world')
  assert.deepStrictEqual(data, [{ id: 'a', d: 'hello' }, { id: 'b', d: 'world' }])
})

test('spawn is idempotent for an existing id', () => {
  const { mgr, created } = managerWith()
  mgr.spawn('a', {})
  mgr.spawn('a', {})
  assert.strictEqual(created.length, 1)
})

test('write/resize/kill address the right pty; kill removes it', () => {
  const { mgr, created } = managerWith()
  mgr.spawn('a', {})
  mgr.spawn('b', {})
  mgr.write('a', 'ls\r')
  mgr.resize('b', 100, 40)
  assert.deepStrictEqual(created[0].writes, ['ls\r'])
  assert.deepStrictEqual(created[1].resized, { c: 100, r: 40 })
  mgr.kill('a')
  assert.strictEqual(created[0].killed, true)
  assert.strictEqual(mgr.has('a'), false)
  assert.strictEqual(mgr.size, 1)
})

test('a pty exit routes the id+code and drops it from the map', () => {
  const { mgr, created, exits } = managerWith()
  mgr.spawn('a', {})
  created[0]._exit({ exitCode: 3 })
  assert.deepStrictEqual(exits, [{ id: 'a', code: 3 }])
  assert.strictEqual(mgr.has('a'), false)
})

test('write/resize/kill on an unknown id are no-ops (no throw)', () => {
  const { mgr } = managerWith()
  assert.doesNotThrow(() => { mgr.write('x', 'y'); mgr.resize('x', 1, 1); mgr.kill('x') })
})

test('killAll kills every pty and empties the map', () => {
  const { mgr, created } = managerWith()
  mgr.spawn('a', {}); mgr.spawn('b', {})
  mgr.killAll()
  assert.ok(created[0].killed && created[1].killed)
  assert.strictEqual(mgr.size, 0)
})

test('a throwing spawn impl returns null and leaves no entry (bad cwd must not reject the IPC)', () => {
  const mgr = new PtyManager({ spawn: () => { throw new Error('ENOENT: no such cwd') } })
  let result
  assert.doesNotThrow(() => { result = mgr.spawn('a', { cwd: 'C:\\gone' }) })
  assert.strictEqual(result, null)
  assert.match(mgr.lastSpawnError, /ENOENT/)
  assert.strictEqual(mgr.has('a'), false)
  assert.doesNotThrow(() => { mgr.write('a', 'x'); mgr.kill('a') })
})
