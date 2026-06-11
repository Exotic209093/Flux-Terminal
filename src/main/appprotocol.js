// src/main/appprotocol.js
const fs = require('fs')
const path = require('path')

// Serve the built renderer over a custom app:// scheme. Under file:// Electron
// blocks the renderer's ES-module <script> by CORS (blank window in production);
// a privileged standard+secure scheme loads modules normally.
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
}

// Transcript-derived content is untrusted (sessions fetch the web), so the
// renderer document gets a tight CSP. style-src 'unsafe-inline' is required:
// React style props and the inline theme vars on <html> are style attributes.
// img-src data: covers timeline images (base64 from transcripts).
// Dev (Vite server) is unaffected — this header is only served over app://.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

/** Response headers for a renderer asset by extension. Pure — unit-tested. */
function headersFor(ext) {
  const headers = { 'content-type': MIME[ext] || 'application/octet-stream' }
  if (ext === '.html') headers['content-security-policy'] = CSP
  return headers
}

/**
 * Map an app:// URL pathname to an absolute file under rendererDir, or null if
 * it escapes the dir (path-traversal guard). Pure — unit-tested.
 */
function resolveRendererPath(rel, rendererDir) {
  let p = rel || ''
  try {
    p = decodeURIComponent(p)
  } catch {
    /* malformed escapes — fall through with raw */
  }
  if (!p || p === '/') p = '/index.html'
  const resolved = path.normalize(path.join(rendererDir, p))
  const base = path.normalize(rendererDir)
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null
  return resolved
}

/** Call BEFORE app.whenReady(). Registers app:// as a privileged scheme. */
function registerAppScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

/** Call in whenReady(). Serves rendererDir over app://. */
function serveAppProtocol(protocol, rendererDir) {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    const filePath = resolveRendererPath(url.pathname, rendererDir)
    if (!filePath) return new Response('forbidden', { status: 403 })
    try {
      const data = await fs.promises.readFile(filePath)
      const ext = path.extname(filePath).toLowerCase()
      return new Response(data, { headers: headersFor(ext) })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

module.exports = { resolveRendererPath, registerAppScheme, serveAppProtocol, headersFor, CSP, MIME }
