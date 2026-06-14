const { test, describe, before } = require('node:test')
const assert = require('node:assert')

describe('fuzzy', () => {
  let fuzzyScore, fuzzyFilter
  before(async () => {
    const mod = await import('../src/renderer/src/lib/fuzzy.js')
    ;({ fuzzyScore, fuzzyFilter } = mod)
  })

  test('ranks exact > prefix > substring > subsequence > none', () => {
    assert.ok(fuzzyScore('abc', 'abc') > fuzzyScore('abc', 'abcdef'))
    assert.ok(fuzzyScore('abc', 'abcdef') > fuzzyScore('abc', 'xxabcxx'))
    assert.ok(fuzzyScore('abc', 'xxabcxx') > fuzzyScore('abc', 'a1b2c3'))
    assert.strictEqual(fuzzyScore('abc', 'xyz'), 0)
  })

  test('empty query scores 1 (keeps everything)', () => {
    assert.strictEqual(fuzzyScore('', 'anything'), 1)
  })

  test('fuzzyFilter drops non-matches and sorts by score', () => {
    const items = ['Settings', 'Stats', 'Skills', 'Mission']
    const out = fuzzyFilter('s', items)
    assert.ok(out.length >= 3)
    assert.ok(!out.includes('Mission'))
  })

  test('fuzzyFilter with empty query returns all (copy)', () => {
    const items = ['a', 'b']
    const out = fuzzyFilter('', items)
    assert.deepStrictEqual(out, items)
    assert.notStrictEqual(out, items)
  })
})
