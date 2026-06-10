// tests/appprotocol.test.js
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { resolveRendererPath, MIME } = require('../src/main/appprotocol')

const DIR = path.join('C:', 'app', 'out', 'renderer')

test('maps root and empty path to index.html', () => {
  assert.strictEqual(resolveRendererPath('/', DIR), path.join(DIR, 'index.html'))
  assert.strictEqual(resolveRendererPath('', DIR), path.join(DIR, 'index.html'))
})

test('maps an asset path under the renderer dir', () => {
  assert.strictEqual(resolveRendererPath('/assets/index-abc.js', DIR), path.join(DIR, 'assets', 'index-abc.js'))
})

test('rejects path traversal (returns null)', () => {
  assert.strictEqual(resolveRendererPath('/../../secret.txt', DIR), null)
  assert.strictEqual(resolveRendererPath('/..%2f..%2fsecret', DIR), null)
})

test('MIME covers the renderer asset types', () => {
  assert.strictEqual(MIME['.js'], 'text/javascript')
  assert.strictEqual(MIME['.css'], 'text/css')
  assert.strictEqual(MIME['.html'], 'text/html')
})
