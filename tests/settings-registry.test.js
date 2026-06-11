const test = require('node:test')
const assert = require('node:assert')

test('filterSettings: empty query returns all categories in order', async () => {
  const { filterSettings, CATEGORY_META } = await import('../src/renderer/src/components/settings/registry-data.js')
  assert.deepStrictEqual(filterSettings(''), CATEGORY_META.map((c) => c.id))
  assert.deepStrictEqual(filterSettings('   '), CATEGORY_META.map((c) => c.id))
})

test('filterSettings: matches category label and keywords', async () => {
  const { filterSettings } = await import('../src/renderer/src/components/settings/registry-data.js')
  assert.deepStrictEqual(filterSettings('theme'), ['appearance'])
  assert.deepStrictEqual(filterSettings('sound'), ['notifications'])
  assert.deepStrictEqual(filterSettings('model'), ['models'])
  assert.deepStrictEqual(filterSettings('zzzz'), [])
})
