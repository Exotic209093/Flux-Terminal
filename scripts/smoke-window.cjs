// Visual smoke test: launch the built renderer in a real Electron window,
// drive the PTY, and capture a screenshot so we can confirm the terminal
// actually renders a live shell.
//
//   npm run build && npx electron scripts/smoke-window.cjs
//
// Writes smoke-window.png and smoke-window.log in the project root.

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { createPty } = require('../src/main/pty')

const ROOT = path.join(__dirname, '..')
const LOG = path.join(ROOT, 'smoke-window.log')
fs.writeFileSync(LOG, '') // reset
const log = (m) => {
  const line = `[${process.uptime().toFixed(2)}s] ${m}\n`
  fs.appendFileSync(LOG, line)
  process.stdout.write(line)
}

let win = null
let ptyProc = null

// Watchdog: never let this hang the way capturePage() did.
const watchdog = setTimeout(() => {
  log('WATCHDOG fired — force exit')
  app.exit(2)
}, 15000)

ipcMain.handle('pty:spawn', (_e, opts) => {
  log('pty:spawn requested ' + JSON.stringify(opts))
  ptyProc = createPty(opts)
  ptyProc.onData((data) => {
    if (win && !win.isDestroyed()) win.webContents.send('pty:data', data)
  })
  ptyProc.onExit(({ exitCode }) => {
    if (win && !win.isDestroyed()) win.webContents.send('pty:exit', exitCode)
  })
  log('pty spawned pid=' + ptyProc.pid)
  return { pid: ptyProc.pid }
})
ipcMain.on('pty:write', (_e, d) => ptyProc && ptyProc.write(d))
ipcMain.on('pty:resize', (_e, { cols, rows }) => {
  if (ptyProc) {
    try {
      ptyProc.resize(cols, rows)
    } catch {
      /* ignore */
    }
  }
})

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  try {
    log('app ready; creating window')
    win = new BrowserWindow({
      width: 1000,
      height: 680,
      show: true,
      backgroundColor: '#0b0e14',
      webPreferences: {
        preload: path.join(ROOT, 'out', 'preload', 'index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    win.webContents.on('console-message', (_e, level, message) => {
      log('renderer console: ' + message)
    })
    win.webContents.on('render-process-gone', (_e, d) => log('RENDER GONE: ' + JSON.stringify(d)))

    log('loading renderer html')
    await win.loadFile(path.join(ROOT, 'out', 'renderer', 'index.html'))
    log('renderer loaded')
    win.show()
    win.focus()

    await wait(1800)
    if (ptyProc) {
      log('injecting command into pty')
      ptyProc.write('Write-Output "Flux Terminal is alive — milestone 0 ok"\r')
    } else {
      log('WARNING: ptyProc not created (renderer never called pty:spawn)')
    }
    await wait(2200)

    log('ensuring renderer is responsive before capture')
    await win.webContents.executeJavaScript('document.querySelector(".xterm") ? "xterm-mounted" : "no-xterm"').then(
      (r) => log('dom check: ' + r)
    )

    log('capturing page')
    const img = await win.webContents.capturePage()
    const out = path.join(ROOT, 'smoke-window.png')
    fs.writeFileSync(out, img.toPNG())
    log('FLUX_WINDOW_SHOT ' + out + ' (' + img.getSize().width + 'x' + img.getSize().height + ')')
  } catch (err) {
    log('ERROR: ' + (err && err.stack ? err.stack : err))
  } finally {
    clearTimeout(watchdog)
    log('quitting')
    app.exit(0)
  }
})
