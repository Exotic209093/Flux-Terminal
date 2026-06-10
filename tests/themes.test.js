const test = require('node:test')
const assert = require('node:assert')

const REQUIRED_VARS = ['--bg', '--bg-panel', '--bg-elev', '--bg-hover', '--border',
  '--text', '--text-dim', '--text-faint', '--accent', '--accent-2', '--accent-glow']
const ANIMATED = ['aurora', 'nebula', 'synthwave', 'matrix']
const STATIC = ['midnight', 'nord', 'dracula']

test('every theme has a name and all required CSS vars', async () => {
  const { THEMES } = await import('../src/renderer/src/lib/themes.js')
  for (const key of [...STATIC, ...ANIMATED]) {
    const t = THEMES[key]
    assert.ok(t, `theme ${key} exists`)
    assert.strictEqual(typeof t.name, 'string')
    for (const v of REQUIRED_VARS) {
      assert.strictEqual(typeof t.vars[v], 'string', `${key} has ${v}`)
    }
  }
})

test('animated themes carry --glass-panel and the animated flag; static ones do not', async () => {
  const { THEMES, isAnimated } = await import('../src/renderer/src/lib/themes.js')
  for (const key of ANIMATED) {
    assert.strictEqual(isAnimated(key), true, `${key} animated`)
    assert.strictEqual(typeof THEMES[key].vars['--glass-panel'], 'string', `${key} glass var`)
  }
  for (const key of STATIC) {
    assert.strictEqual(isAnimated(key), false, `${key} not animated`)
  }
  assert.strictEqual(isAnimated('does-not-exist'), false)
})

test('shouldAnimate requires both an animated theme and motion enabled', async () => {
  const { shouldAnimate } = await import('../src/renderer/src/lib/themes.js')
  assert.strictEqual(shouldAnimate('aurora', true), true)
  assert.strictEqual(shouldAnimate('aurora', false), false)
  assert.strictEqual(shouldAnimate('midnight', true), false)
})

test('themeColors returns bg/fg/cursor for every theme', async () => {
  const { THEMES, themeColors } = await import('../src/renderer/src/lib/themes.js')
  for (const key of Object.keys(THEMES)) {
    const c = themeColors(key)
    assert.match(c.background, /^#|rgb/, `${key} bg`)
    assert.match(c.foreground, /^#|rgb/, `${key} fg`)
    assert.match(c.cursor, /^#|rgb/, `${key} cursor`)
  }
})
