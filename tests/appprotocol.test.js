// tests/appprotocol.test.js
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { resolveRendererPath, MIME, headersFor, CSP } = require('../src/main/appprotocol')

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

test('html responses carry a restrictive Content-Security-Policy; assets do not', () => {
  const html = headersFor('.html')
  assert.strictEqual(html['content-type'], 'text/html')
  assert.strictEqual(html['content-security-policy'], CSP)
  assert.match(CSP, /default-src 'self'/)
  assert.match(CSP, /object-src 'none'/)
  assert.ok(!CSP.includes("unsafe-eval"))
  const js = headersFor('.js')
  assert.strictEqual(js['content-security-policy'], undefined)
  assert.strictEqual(headersFor('.nope')['content-type'], 'application/octet-stream')
})
