const { test, describe, before } = require('node:test')
const assert = require('node:assert')

describe('intensity + terminalBg', () => {
  let intensityToAlpha, terminalBg
  before(async () => {
    ;({ intensityToAlpha } = await import('../src/renderer/src/lib/appearance.js'))
    ;({ terminalBg } = await import('../src/renderer/src/lib/themes.js'))
  })
  test('intensityToAlpha maps levels + default', () => {
    assert.strictEqual(intensityToAlpha('subtle'), 0.9)
    assert.strictEqual(intensityToAlpha('balanced'), 0.76)
    assert.strictEqual(intensityToAlpha('bold'), 0.62)
    assert.strictEqual(intensityToAlpha('???'), 0.76)
  })
  test('terminalBg returns rgba of the theme --bg at the given alpha', () => {
    assert.strictEqual(terminalBg('matrix', 1), 'rgba(5, 10, 5, 1)') // #050a05
    assert.strictEqual(terminalBg('aurora', 0.5), 'rgba(6, 17, 15, 0.5)') // #06110f
  })
})
