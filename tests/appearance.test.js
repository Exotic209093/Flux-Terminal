const test = require('node:test')
const assert = require('node:assert')

test('resolveAnimations: explicit pref wins, else defaults to !reducedMotion', async () => {
  const { resolveAnimations } = await import('../src/renderer/src/lib/appearance.js')
  assert.strictEqual(resolveAnimations('1', true), true)   // user forced on
  assert.strictEqual(resolveAnimations('0', false), false) // user forced off
  assert.strictEqual(resolveAnimations(null, false), true) // no pref, motion ok
  assert.strictEqual(resolveAnimations(null, true), false) // no pref, reduced motion
  assert.strictEqual(resolveAnimations('', true), false)   // unknown -> default path
})
