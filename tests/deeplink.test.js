const { test } = require('node:test')
const assert = require('node:assert')
const { parseDeepLink, findDeepLink } = require('../src/main/deeplink')

const UUID = '11111111-2222-3333-4444-555555555555'

test('parses flux://session/<uuid>', () => {
  assert.deepStrictEqual(parseDeepLink('flux://session/' + UUID), { route: 'session', sessionId: UUID })
})
test('parses flux://mission', () => {
  assert.deepStrictEqual(parseDeepLink('flux://mission'), { route: 'mission' })
})
test('rejects bad scheme / bad uuid / garbage', () => {
  assert.strictEqual(parseDeepLink('http://session/' + UUID), null)
  assert.strictEqual(parseDeepLink('flux://session/not-a-uuid'), null)
  assert.strictEqual(parseDeepLink('flux://nope'), null)
  assert.strictEqual(parseDeepLink('garbage'), null)
  assert.strictEqual(parseDeepLink(null), null)
})
test('findDeepLink scans an argv array', () => {
  assert.deepStrictEqual(findDeepLink(['electron', '.', 'flux://mission']), { route: 'mission' })
  assert.strictEqual(findDeepLink(['electron', '.']), null)
})
test('parses flux://new', () => {
  assert.deepStrictEqual(parseDeepLink('flux://new'), { route: 'new' })
})
