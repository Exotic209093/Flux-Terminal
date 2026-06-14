// Pure guards for the shell/clipboard IPC. The renderer is untrusted, so a URL
// must be a safe external scheme before it reaches shell.openExternal.
function isAllowedExternalUrl(url) {
  if (typeof url !== 'string' || !url) return false
  return /^(https?:|mailto:)/i.test(url.trim())
}

// Heuristic: does this token look like a filesystem path worth linkifying?
function looksLikePath(s) {
  if (typeof s !== 'string' || !s) return false
  if (/^[a-zA-Z]:[\\/]/.test(s)) return true // C:\... or C:/...
  if (/^\.{0,2}\//.test(s)) return true // /abs, ./rel, ../rel
  return false
}

module.exports = { isAllowedExternalUrl, looksLikePath }
