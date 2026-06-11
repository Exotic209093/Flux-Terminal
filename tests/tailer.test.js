// tests/tailer.test.js
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createTail } = require('../src/main/tailer')

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-tail-'))
  return path.join(dir, 's.jsonl')
}

test('readDelta returns appended objects across calls, only consuming complete lines', () => {
  const file = tmpFile()
  fs.writeFileSync(file, '{"a":1}\n{"a":2}\n')
  const tail = createTail(file)
  const d1 = tail.readDelta()
  assert.strictEqual(d1.reset, false)
  assert.deepStrictEqual(d1.objects.map((o) => o.a), [1, 2])

  fs.appendFileSync(file, '{"a":3}\n{"a":4')
  const d2 = tail.readDelta()
  assert.deepStrictEqual(d2.objects.map((o) => o.a), [3]) // partial line 4 left for next call

  fs.appendFileSync(file, '}\n')
  const d3 = tail.readDelta()
  assert.deepStrictEqual(d3.objects.map((o) => o.a), [4]) // completed now

  const d4 = tail.readDelta()
  assert.deepStrictEqual(d4.objects, []) // nothing new
})

test('a shrunk file signals reset and restarts from offset 0', () => {
  const file = tmpFile()
  fs.writeFileSync(file, '{"a":1}\n{"a":2}\n{"a":3}\n')
  const tail = createTail(file)
  tail.readDelta()
  fs.writeFileSync(file, '{"b":1}\n') // truncation/rotation
  const r = tail.readDelta()
  assert.strictEqual(r.reset, true)
  assert.deepStrictEqual(r.objects, [])
  const again = tail.readDelta() // caller re-reads from 0 after rebuilding its accumulator
  assert.deepStrictEqual(again.objects.map((o) => o.b), [1])
})

test('readDelta reports size and mtimeMs from the stat it took', () => {
  const file = tmpFile()
  fs.writeFileSync(file, '{"a":1}\n')
  const tail = createTail(file)
  const d = tail.readDelta()
  const st = fs.statSync(file)
  assert.strictEqual(d.size, st.size)
  assert.strictEqual(typeof d.mtimeMs, 'number')
})

test('invalid JSON lines are skipped, multi-byte UTF-8 offsets stay correct', () => {
  const file = tmpFile()
  fs.writeFileSync(file, '{"t":"héllo — ünïcode"}\nnot json\n')
  const tail = createTail(file)
  const d1 = tail.readDelta()
  assert.strictEqual(d1.objects.length, 1)
  fs.appendFileSync(file, '{"t":"next"}\n')
  const d2 = tail.readDelta()
  assert.strictEqual(d2.objects.length, 1)
  assert.strictEqual(d2.objects[0].t, 'next')
})

test('a missing file throws from readDelta (caller decides policy)', () => {
  const tail = createTail(path.join(os.tmpdir(), 'flux-tail-missing', 'nope.jsonl'))
  assert.throws(() => tail.readDelta())
})
