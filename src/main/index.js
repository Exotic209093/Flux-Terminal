const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { createPty } = require('./pty')

let mainWindow = null
let ptyProc = null

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
      nodeIntegration: false
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

// ---- App lifecycle --------------------------------------------------------
app.whenReady().then(() => {
  createWindow()
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
  if (process.platform !== 'darwin') app.quit()
})
