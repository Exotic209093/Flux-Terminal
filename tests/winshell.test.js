const { test } = require('node:test')
const assert = require('node:assert')
const { progressForState } = require('../src/main/winshell')

test('progressForState: running turn -> indeterminate; else cleared', () => {
  assert.deepStrictEqual(progressForState({ state: 'running' }), { value: 2, mode: 'indeterminate' })
  assert.deepStrictEqual(progressForState({ state: 'idle' }), { value: -1, mode: 'none' })
  assert.deepStrictEqual(progressForState(null), { value: -1, mode: 'none' })
})
