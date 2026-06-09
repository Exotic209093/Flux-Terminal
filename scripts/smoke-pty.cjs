// Smoke test for node-pty.
//
//   Run under Electron's ABI (the one that matters):
//     npx electron scripts/smoke-pty.cjs
//
//   Run under plain Node (sanity only):
//     node scripts/smoke-pty.cjs
//
// It spawns the platform shell, asks it to echo a unique marker, and verifies
// the marker comes back through the PTY. Prints FLUX_PTY_OK / FLUX_PTY_FAIL.

const os = require('os')

function done(ok, msg) {
  console.log(ok ? `FLUX_PTY_OK ${msg || ''}` : `FLUX_PTY_FAIL ${msg || ''}`)
  // Electron keeps an event loop alive; force exit either way.
  process.exit(ok ? 0 : 1)
}

let pty
try {
  pty = require('node-pty')
} catch (err) {
  done(false, `require(node-pty) threw: ${err.message}`)
}

const isWin = process.platform === 'win32'
const shell = isWin ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
const marker = 'FLUXMARK_' + process.pid

let proc
try {
  proc = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: os.homedir(),
    env: process.env
  })
} catch (err) {
  done(false, `spawn threw: ${err.message}`)
}

let buf = ''
let finished = false
proc.onData((d) => {
  buf += d
  if (!finished && buf.includes(marker) && buf.indexOf(marker) !== buf.lastIndexOf(marker)) {
    // Marker appears twice: once as the echoed command, once as output.
    finished = true
    try {
      proc.kill()
    } catch {
      /* ignore */
    }
    done(true, `loaded ${pty.version ? 'v' + pty.version + ' ' : ''}pid=${proc.pid}`)
  }
})

proc.onExit(({ exitCode }) => {
  if (!finished) done(false, `shell exited early (code ${exitCode})`)
})

// Ask the shell to print the marker.
const cmd = isWin ? `Write-Output "${marker}"\r` : `echo ${marker}\n`
setTimeout(() => proc.write(cmd), 400)

// Safety timeout.
setTimeout(() => {
  if (!finished) {
    try {
      proc.kill()
    } catch {
      /* ignore */
    }
    done(false, `timeout; captured ${buf.length} bytes`)
  }
}, 8000)
