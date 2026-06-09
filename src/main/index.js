const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { createPty } = require('./pty')
const { listSessions } = require('./sessions')
const { parseSessionFile } = require('./parser')
const { LiveTracker } = require('./live')

let mainWindow = null
let ptyProc = null
let liveTracker = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    title: 'Flux Terminal',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Keep the terminal rendering PTY output even when the window is unfocused.
      backgroundThrottling: false
    }
  })

  // electron-vite sets ELECTRON_RENDERER_URL in dev (Vite dev server w/ HMR);
  // in production we load the built HTML from disk.
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// ---- PTY bridge -----------------------------------------------------------
ipcMain.handle('pty:spawn', (_e, opts) => {
  if (ptyProc) {
    try {
      ptyProc.kill()
    } catch {
      /* ignore */
    }
  }
  ptyProc = createPty(opts)
  ptyProc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:data', data)
    }
  })
  ptyProc.onExit(({ exitCode }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:exit', exitCode)
    }
  })
  return { pid: ptyProc.pid }
})

ipcMain.on('pty:write', (_e, data) => {
  if (ptyProc) ptyProc.write(data)
})

ipcMain.on('pty:resize', (_e, { cols, rows }) => {
  if (ptyProc) {
    try {
      ptyProc.resize(cols, rows)
    } catch {
      /* ignore transient resize errors */
    }
  }
})

// ---- Sessions bridge ------------------------------------------------------
ipcMain.handle('sessions:list', (_e, opts) => {
  try {
    return { ok: true, sessions: listSessions(opts || {}) }
  } catch (err) {
    return { ok: false, error: err.message, sessions: [] }
  }
})

ipcMain.handle('session:read', (_e, file) => {
  try {
    return { ok: true, session: parseSessionFile(file, { timeline: true }) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ---- Live session tracking ------------------------------------------------
// The renderer launches `claude --session-id <uuid>` in the PTY and tells us the
// uuid; we tail exactly that file and stream snapshots back via 'live:update'.
ipcMain.on('live:track', (_e, sessionId) => {
  if (liveTracker && typeof sessionId === 'string') liveTracker.track(sessionId)
})
ipcMain.on('live:stop', () => {
  if (liveTracker) liveTracker.stop()
})

// ---- App lifecycle --------------------------------------------------------
app.whenReady().then(() => {
  createWindow()

  liveTracker = new LiveTracker((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('live:update', snapshot)
    }
  })

  // Debug screenshot of the REAL app (real window + real IPC handlers). Set:
  //   FLUX_SMOKE_SHOT=<path>     capture once after load, then quit (no-op if unset)
  //   FLUX_SMOKE_VIEW=stats|session   click into that view before capturing
  //   FLUX_SMOKE_THEME=<key>          switch theme before capturing
  if (process.env.FLUX_SMOKE_SHOT && mainWindow) {
    const shotPath = process.env.FLUX_SMOKE_SHOT
    const wc = mainWindow.webContents
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    wc.once('did-finish-load', async () => {
      try {
        await wait(2500)
        if (process.env.FLUX_SMOKE_VIEW === 'stats') {
          await wc.executeJavaScript("document.querySelector('.stats-btn')?.click()")
        } else if (process.env.FLUX_SMOKE_VIEW === 'session') {
          await wc.executeJavaScript("document.querySelector('.session-card')?.click()")
        }
        if (process.env.FLUX_SMOKE_THEME) {
          const t = JSON.stringify(process.env.FLUX_SMOKE_THEME)
          await wc.executeJavaScript(
            `(() => { const s = document.querySelector('.theme-select'); if (s) { s.value = ${t}; s.dispatchEvent(new Event('change', { bubbles: true })) } })()`
          )
        }
        await wait(1800)
        const img = await wc.capturePage()
        require('fs').writeFileSync(shotPath, img.toPNG())
        console.log('FLUX_SMOKE_SHOT_OK ' + shotPath)
      } catch (err) {
        console.error('FLUX_SMOKE_SHOT_ERR ' + err.message)
      }
      app.quit()
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (ptyProc) {
    try {
      ptyProc.kill()
    } catch {
      /* ignore */
    }
  }
  if (liveTracker) liveTracker.dispose()
  if (process.platform !== 'darwin') app.quit()
})
