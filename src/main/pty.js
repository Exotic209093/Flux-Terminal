const os = require('os')
const pty = require('node-pty')

/**
 * Pick a sensible default shell per platform. On Windows we prefer PowerShell
 * (where `claude` and the rest of the user's workflow live) and fall back to cmd.
 */
function defaultShell() {
  if (process.platform === 'win32') {
    return 'powershell.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

// Renderer-supplied shells flow into node-pty. node-pty uses no shell parsing
// (empty args array) so this isn't classic injection, but an XSS could
// otherwise launch an arbitrary exe — restrict to known shells by basename.
const ALLOWED_SHELLS = new Set([
  'powershell.exe', 'pwsh.exe', 'cmd.exe', 'bash.exe', 'wsl.exe', // Windows
  'bash', 'zsh', 'sh', 'fish', 'pwsh' // Unix
])

function isAllowedShell(shell) {
  if (shell == null) return true // null/undefined => platform default
  if (typeof shell !== 'string' || !shell) return false
  const base = shell.replace(/\\/g, '/').split('/').pop().toLowerCase()
  return ALLOWED_SHELLS.has(base)
}

/**
 * Spawn a real pseudo-terminal. On Windows this uses ConPTY under the hood,
 * which is what full-screen TUIs like `claude` need to render and resize cleanly.
 */
function createPty({ cols = 80, rows = 30, cwd, shell } = {}) {
  if (!isAllowedShell(shell)) throw new Error('shell not allowed: ' + shell)
  return pty.spawn(shell || defaultShell(), [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: cwd || os.homedir(),
    env: process.env
  })
}

module.exports = { createPty, defaultShell, isAllowedShell }
