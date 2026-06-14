// Parse flux:// deep links. Pure; the main process scans argv/open-url for these.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseDeepLink(url) {
  if (typeof url !== 'string' || !url.toLowerCase().startsWith('flux://')) return null
  let u
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = (u.host || u.hostname || '').toLowerCase()
  if (host === 'session') {
    const id = decodeURIComponent((u.pathname || '').replace(/^\/+/, ''))
    return UUID_RE.test(id) ? { route: 'session', sessionId: id } : null
  }
  if (host === 'mission') return { route: 'mission' }
  return null
}

function findDeepLink(argv) {
  for (const a of argv || []) {
    const r = parseDeepLink(a)
    if (r) return r
  }
  return null
}

module.exports = { parseDeepLink, findDeepLink }
