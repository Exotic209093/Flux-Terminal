const { test, describe, before } = require('node:test')
const assert = require('node:assert')

describe('scene helpers', () => {
  let aurora, nebula
  before(async () => {
    aurora = await import('../src/renderer/src/lib/scenes/aurora.js')
    nebula = await import('../src/renderer/src/lib/scenes/nebula.js')
  })
  test('makeMotes / makeStars produce the requested count within bounds', () => {
    const motes = aurora.makeMotes(10, { w: 100, h: 100 })
    assert.strictEqual(motes.length, 10)
    assert.ok(motes.every((m) => m.x >= 0 && m.x <= 100 && m.y >= 0 && m.y <= 100))
    const stars = nebula.makeStars(15, { w: 200, h: 200 })
    assert.strictEqual(stars.length, 15)
    assert.ok(stars.every((s) => s.z >= 0.3 && s.z <= 1))
  })
})
