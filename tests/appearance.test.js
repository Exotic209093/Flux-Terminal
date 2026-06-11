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

test('resolveMotion: on/off explicit, auto follows reducedMotion', async () => {
  const { resolveMotion } = await import('../src/renderer/src/lib/appearance.js')
  assert.strictEqual(resolveMotion('on', true), true)
  assert.strictEqual(resolveMotion('off', false), false)
  assert.strictEqual(resolveMotion('auto', false), true)
  assert.strictEqual(resolveMotion('auto', true), false)
})

test('mergeLegacyAppearance: legacy localStorage wins where valid', async () => {
  const { mergeLegacyAppearance } = await import('../src/renderer/src/lib/appearance.js')
  const current = { theme: 'midnight', animations: 'auto', model: null }
  assert.deepStrictEqual(
    mergeLegacyAppearance(current, { theme: 'dracula', animations: '0', model: 'claude-opus-4-8' }),
    { theme: 'dracula', animations: 'off', model: 'claude-opus-4-8' }
  )
  assert.deepStrictEqual(
    mergeLegacyAppearance(current, { theme: null, animations: '1', model: null }),
    { theme: 'midnight', animations: 'on', model: null }
  )
  assert.deepStrictEqual(mergeLegacyAppearance(current, { theme: null, animations: null, model: null }), current)
})
