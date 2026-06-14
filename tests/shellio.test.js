const { test } = require('node:test')
const assert = require('node:assert')
const { isAllowedExternalUrl, looksLikePath } = require('../src/main/shellio')

test('isAllowedExternalUrl allows http/https/mailto only', () => {
  assert.strictEqual(isAllowedExternalUrl('https://example.com'), true)
  assert.strictEqual(isAllowedExternalUrl('http://x.io/y'), true)
  assert.strictEqual(isAllowedExternalUrl('mailto:a@b.com'), true)
  assert.strictEqual(isAllowedExternalUrl('file:///c:/x'), false)
  assert.strictEqual(isAllowedExternalUrl('javascript:alert(1)'), false)
  assert.strictEqual(isAllowedExternalUrl('vbscript:x'), false)
  assert.strictEqual(isAllowedExternalUrl(''), false)
  assert.strictEqual(isAllowedExternalUrl(null), false)
})

test('looksLikePath matches windows + unix paths', () => {
  assert.strictEqual(looksLikePath('C:\\\\Users\\\\me\\\\file.txt'), true)
  assert.strictEqual(looksLikePath('/home/me/file'), true)
  assert.strictEqual(looksLikePath('./rel/path.js'), true)
  assert.strictEqual(looksLikePath('just text'), false)
})
