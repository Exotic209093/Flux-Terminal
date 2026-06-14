const { test, describe, before } = require('node:test')
const assert = require('node:assert')

describe('filesTouched', () => {
  let diffStats, collectFilesTouched
  before(async () => {
    const mod = await import('../src/renderer/src/lib/filesTouched.js')
    ;({ diffStats, collectFilesTouched } = mod)
  })

  test('diffStats counts +/- lines, ignores context and truncated', () => {
    const patch = [{ lines: ['-a', '+b', ' c', '+d'] }]
    assert.deepStrictEqual(diffStats(patch), { adds: 2, dels: 1 })
    assert.deepStrictEqual(diffStats({ truncated: true }), { adds: 0, dels: 0 })
    assert.deepStrictEqual(diffStats(null), { adds: 0, dels: 0 })
  })

  test('collectFilesTouched groups tool_result items by filePath with totals', () => {
    const timeline = [
      { kind: 'user', text: 'hi' },
      { kind: 'tool_result', ts: 't1', result: { filePath: 'a.txt', structuredPatch: [{ lines: ['+x'] }] } },
      { kind: 'tool_result', ts: 't2', result: { filePath: 'a.txt', structuredPatch: [{ lines: ['-y', '+z'] }] } },
      { kind: 'tool_result', ts: 't3', result: { filePath: 'b.txt', structuredPatch: [{ lines: ['+1'] }] } },
      { kind: 'tool_result', ts: 't4', result: { stdout: 'no file here' } }
    ]
    const files = collectFilesTouched(timeline)
    assert.strictEqual(files.length, 2)
    const a = files.find((f) => f.filePath === 'a.txt')
    assert.strictEqual(a.edits.length, 2)
    assert.strictEqual(a.adds, 2)
    assert.strictEqual(a.dels, 1)
  })

  test('collectFilesTouched on an empty/no-file timeline returns []', () => {
    assert.deepStrictEqual(collectFilesTouched([]), [])
    assert.deepStrictEqual(collectFilesTouched(null), [])
  })
})
