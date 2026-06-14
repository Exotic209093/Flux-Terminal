const { test } = require('node:test')
const assert = require('node:assert')
const { progressForState } = require('../src/main/winshell')

test('progressForState: active tracked turn -> indeterminate; else cleared', () => {
  // LiveTracker emits 'starting'/'live' (never 'running') for an active turn.
  assert.deepStrictEqual(progressForState({ tracking: true, state: 'live' }), { value: 2, mode: 'indeterminate' })
  assert.deepStrictEqual(progressForState({ tracking: true, state: 'starting' }), { value: 2, mode: 'indeterminate' })
  assert.deepStrictEqual(progressForState({ tracking: false }), { value: -1, mode: 'none' })
  assert.deepStrictEqual(progressForState({ state: 'idle' }), { value: -1, mode: 'none' })
  assert.deepStrictEqual(progressForState(null), { value: -1, mode: 'none' })
})
