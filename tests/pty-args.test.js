const { test } = require('node:test')
const assert = require('node:assert')
const { validArgs } = require('../src/main/pty')

test('validArgs accepts a string array, rejects non-strings, caps length', () => {
  assert.deepStrictEqual(validArgs(['-l', '--color']), ['-l', '--color'])
  assert.deepStrictEqual(validArgs(undefined), [])
  assert.deepStrictEqual(validArgs(null), [])
  assert.deepStrictEqual(validArgs('not array'), [])
  assert.deepStrictEqual(validArgs([1, 'ok', {}]), ['ok']) // drops non-strings
  assert.strictEqual(validArgs(Array.from({ length: 100 }, () => 'x')).length, 32) // capped
})
