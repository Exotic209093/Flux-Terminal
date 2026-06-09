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

/**
 * Spawn a real pseudo-terminal. On Windows this uses ConPTY under the hood,
 * which is what full-screen TUIs like `claude` need to render and resize cleanly.
 */
function createPty({ cols = 80, rows = 30, cwd, shell } = {}) {
  return pty.spawn(shell || defaultShell(), [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: cwd || os.homedir(),
    env: process.env
  })
}

module.exports = { createPty, defaultShell }
