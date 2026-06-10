const { app, BrowserWindow, ipcMain, dialog, Notification, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn } = require('child_process')
const { createPty } = require('./pty')
const { listSessions, findSessionFileById } = require('./sessions')
const { parseSessionFile } = require('./parser')
const { LiveTracker } = require('./live')
const { listSkills, installBundledSkill } = require('./skills')
const { UsagePoller } = require('./usage')
const { listCommands } = require('./commands')
const { listSubagents, readSubagent } = require('./subagents')
const { search, getCacheDir } = require('./search')
const { PromptStore } = require('./prompts')
const { SettingsStore } = require('./settings')
const { SessionMonitor } = require('./monitor')
const { Notifier } = require('./notify')

let mainWindow = null
let ptyProc = null
let liveTracker = null
let usagePoller = null

// Prompt library — path is set in whenReady once app.getPath() is available.
let promptStore = null
let settingsStore = null
let sessionMonitor = null
let notifier = null
let openSessionId = null // which session the renderer currently has open (for not-suppression)

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

  // Taskbar overlay "needs attention" dot for notify.js badge mode (alongside
  // flashFrame). A small #f38ba8 circle baked in as a data URL — no asset file.
  mainWindow.__fluxDot = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAdklEQVR4nGP43L2CAQ0nfe5eseNz94q3n7tX/IfSO6Di6GoZkDkGn7tXnIRqwoVPQtVhGGCAZCMh/BbZEJgBhGzG5hK4AUkkaobhJJgBO8g0YAfMAGL9ji0swAaQoxmGqeMCisOA4ligOB1QJSVSnBeokhvJwgBc3NY+xPo8owAAAABJRU5ErkJggg=='
  )

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

function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

// ---- Skills ---------------------------------------------------------------
ipcMain.handle('skills:list', () => {
  try {
    return { ok: true, skills: listSkills(app.getAppPath()) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
ipcMain.handle('skills:install', (_e, name) => {
  try {
    return installBundledSkill(app.getAppPath(), name)
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ---- Subagents ------------------------------------------------------------
ipcMain.handle('subagents:list', (_e, { file, live }) => {
  try {
    return { ok: true, subagents: listSubagents(file, { live: !!live }) }
  } catch (err) {
    return { ok: false, error: err.message, subagents: [] }
  }
})
ipcMain.handle('subagent:read', (_e, { file, agentId }) => {
  try {
    return { ok: true, detail: readSubagent(file, agentId) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ---- Cross-session search ---------------------------------------------------
ipcMain.handle('search:query', (_e, { query }) => {
  try {
    const { listSessionFiles } = require('./sessions')
    const sessions = listSessionFiles()
    const hits = search(query, sessions, {
      onProgress: (p) => emit('search:progress', p)
    })
    return { ok: true, hits }
  } catch (err) {
    return { ok: false, error: err.message, hits: [] }
  }
})

// ---- Plan usage (5h + weekly windows) ---------------------------------------
ipcMain.handle('usage:get', () =>
  usagePoller ? usagePoller.snapshot() : { ok: false, code: 'INIT', error: 'starting', windows: null }
)
ipcMain.handle('usage:refresh', () =>
  // force=true: a deliberate user click bypasses the rate-limit backoff
  usagePoller ? usagePoller.refresh(true) : { ok: false, code: 'INIT', error: 'starting', windows: null }
)

// ---- Slash commands (composer autocomplete) ---------------------------------
ipcMain.handle('commands:list', (_e, cwd) => {
  try {
    return { ok: true, commands: listCommands(cwd) }
  } catch (err) {
    return { ok: false, error: err.message, commands: [] }
  }
})

// ---- Prompt library ---------------------------------------------------------
ipcMain.handle('prompts:list', () => {
  try {
    return { ok: true, prompts: promptStore ? promptStore.list() : [] }
  } catch (err) {
    return { ok: false, error: err.message, prompts: [] }
  }
})
ipcMain.handle('prompts:save', (_e, data) => {
  try {
    if (!promptStore) return { ok: false, error: 'not ready' }
    return { ok: true, prompt: promptStore.save(data) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
ipcMain.handle('prompts:delete', (_e, id) => {
  try {
    if (promptStore) promptStore.delete(id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
ipcMain.handle('prompts:used', (_e, id) => {
  try {
    if (promptStore) promptStore.used(id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ---- Notification settings --------------------------------------------------
ipcMain.handle('settings:get', () => (settingsStore ? settingsStore.get() : null))
ipcMain.handle('settings:setNotify', (_e, { key, value }) => {
  try {
    if (!settingsStore) return { ok: false, error: 'not ready' }
    return { ok: true, settings: settingsStore.setNotify(key, value) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// Renderer tells main which session is open so we don't toast about it while it's focused.
ipcMain.on('notify:setOpenSession', (_e, sessionId) => {
  openSessionId = sessionId || null
})

// ---- Mission Control --------------------------------------------------------
ipcMain.handle('missioncontrol:list', () => {
  try {
    return { ok: true, cards: sessionMonitor ? sessionMonitor.cards() : [] }
  } catch (err) {
    return { ok: false, error: err.message, cards: [] }
  }
})

// ---- Outgoing image stash ---------------------------------------------------
// A pasted/attached image is written to a temp file; the composer references
// its path in the prompt so the resumed claude can Read it. Best-effort
// cleanup on quit.
const stashedImages = []
const MAX_STASH_B64 = 20_000_000 // ~15 MB decoded — pastes bigger than this are rejected, not written
ipcMain.handle('image:stash', async (_e, args) => {
  try {
    const { data, mediaType } = args || {}
    if (typeof data !== 'string' || !data) return { ok: false, error: 'no image data' }
    if (data.length > MAX_STASH_B64) return { ok: false, error: 'image too large to attach (>15 MB)' }
    const m = /^image\/(png|jpe?g|gif|webp)$/.exec(mediaType || '')
    const ext = m ? m[1].replace('jpeg', 'jpg') : 'png'
    const file = path.join(
      os.tmpdir(),
      'flux-img-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.' + ext
    )
    await fs.promises.writeFile(file, Buffer.from(data, 'base64'))
    stashedImages.push(file)
    return { ok: true, file }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ---- Session watch (re-parse on change) -----------------------------------
let watchFile = null
let watchTimer = null
let watchMtime = 0

ipcMain.on('session:watch', (_e, file) => {
  watchFile = file
  try {
    watchMtime = fs.statSync(file).mtimeMs
  } catch {
    watchMtime = 0
  }
  if (!watchTimer) {
    watchTimer = setInterval(() => {
      if (!watchFile) return
      try {
        const st = fs.statSync(watchFile)
        if (st.mtimeMs !== watchMtime) {
          watchMtime = st.mtimeMs
          emit('session:refresh', {
            file: watchFile,
            session: parseSessionFile(watchFile, { timeline: true })
          })
        }
      } catch {
        /* file may be mid-write; retry next tick */
      }
    }, 1000)
  }
})
ipcMain.on('session:unwatch', () => {
  watchFile = null
})

// ---- Interactive resume ---------------------------------------------------
// Send a message to an existing session: `claude --resume <id> -p` reads the
// prompt from stdin (so the message never touches the shell command line). The
// reply is appended to the session's JSONL — the watcher above surfaces it.
let sendChild = null
let lastSentAt = 0
let interrupting = false
ipcMain.handle('session:send', (_e, { sessionId, cwd, message, model }) => {
  if (!sessionId || !message) return { ok: false, error: 'missing sessionId or message' }

  // Guard: can't resume a session that's currently live (being written by another
  // running claude) — it hangs/fails. Recent mtime + we didn't just send here =>
  // it's active elsewhere. (Within 30s of our own send we skip this so a normal
  // back-and-forth isn't false-flagged.)
  const file = findSessionFileById(sessionId)
  if (file) {
    try {
      const st = fs.statSync(file)
      if (Date.now() - st.mtimeMs < 10000 && Date.now() - lastSentAt > 30000) {
        return {
          ok: false,
          error:
            "This session is active right now (being written elsewhere). You can't message an in-progress session — open a past one to continue it."
        }
      }
    } catch {
      /* ignore stat errors */
    }
  }
  if (cwd && !fs.existsSync(cwd)) {
    return { ok: false, error: "This session's working folder no longer exists:\n" + cwd }
  }

  try {
    const args = ['--resume', sessionId, '-p']
    if (model) args.push('--model', model)
    const child = spawn('claude', args, {
      cwd: cwd || os.homedir(),
      shell: true,
      windowsHide: true
    })
    sendChild = child
    lastSentAt = Date.now()
    emit('session:sendstatus', { sessionId, state: 'running' })

    let stderr = ''
    let settled = false
    const finish = (state, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (interrupting) {
        state = 'interrupted'
        error = null
        interrupting = false
      }
      emit('session:sendstatus', { sessionId, state, error: error || null })
      sendChild = null
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish('error', "claude didn't respond in time. The session may be open elsewhere, or its folder moved.")
    }, 150000)

    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', (err) => finish('error', err.message))
    child.on('exit', (code) =>
      finish(code === 0 ? 'done' : 'error', code === 0 ? null : stderr.slice(0, 400) || 'claude exited ' + code)
    )
    child.stdin.write(message)
    child.stdin.end()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ---- New chat -------------------------------------------------------------
// Start a fresh session in the rich UI: generate a uuid, run
// `claude -p --session-id <uuid> --model <m>` from the chosen cwd, prompt on
// stdin. Afterwards <uuid>.jsonl exists and is a normal resumable session.
const { randomUUID } = require('crypto')
ipcMain.handle('session:new', (_e, { message, cwd, model }) => {
  if (!message) return { ok: false, error: 'missing message' }
  const dir = cwd || os.homedir()
  if (!fs.existsSync(dir)) return { ok: false, error: 'Working folder does not exist:\n' + dir }
  const sessionId = randomUUID()
  try {
    const args = ['-p', '--session-id', sessionId]
    if (model) args.push('--model', model)
    const child = spawn('claude', args, { cwd: dir, shell: true, windowsHide: true })
    sendChild = child
    lastSentAt = Date.now()
    emit('session:sendstatus', { sessionId, state: 'running' })

    let stderr = ''
    let settled = false
    const finish = (state, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (interrupting) {
        state = 'interrupted'
        error = null
        interrupting = false
      }
      emit('session:sendstatus', { sessionId, state, error: error || null })
      sendChild = null
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish('error', "claude didn't respond in time.")
    }, 150000)
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', (err) => finish('error', err.message))
    child.on('exit', (code) =>
      finish(code === 0 ? 'done' : 'error', code === 0 ? null : stderr.slice(0, 400) || 'claude exited ' + code)
    )
    child.stdin.write(message)
    child.stdin.end()
    return { ok: true, sessionId, cwd: dir }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ---- Interrupt ------------------------------------------------------------
ipcMain.handle('session:interrupt', () => {
  if (!sendChild) return { ok: false, error: 'nothing running' }
  interrupting = true
  try {
    sendChild.kill()
  } catch {
    /* already gone */
  }
  return { ok: true }
})

// ---- Folder picker (new-chat working dir) ---------------------------------
ipcMain.handle('dialog:pickFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  if (res.canceled || !res.filePaths[0]) return { ok: false }
  return { ok: true, path: res.filePaths[0] }
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
  promptStore = new PromptStore(path.join(app.getPath('userData'), 'prompts.json'))
  promptStore.seed()

  settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'))

  notifier = new Notifier({
    getWindow: () => mainWindow,
    getSettings: () => settingsStore.get(),
    getOpenSessionId: () => openSessionId,
    NotificationImpl: Notification,
    beep: () => require('electron').shell.beep()
  })

  sessionMonitor = new SessionMonitor({
    getOpenSessionId: () => openSessionId,
    onAttention: (notice) => notifier.deliver(notice),
    onCards: (cards) => emit('missioncontrol:update', cards)
  })
  sessionMonitor.start()

  // Clear badge/flash when the user comes back to the window.
  mainWindow.on('focus', () => notifier && notifier.clear())

  liveTracker = new LiveTracker((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('live:update', snapshot)
    }
  })

  const { createUsageState, observeUsage } = require('./attention')
  const usageAttn = createUsageState()
  usagePoller = new UsagePoller((snap) => {
    emit('usage:update', snap)
    if (snap && snap.windows && notifier) {
      for (const event of observeUsage(usageAttn, snap.windows, Date.now())) {
        notifier.deliver({ sessionId: 'usage', project: '', title: 'Plan usage', event })
      }
    }
  })
  usagePoller.start()

  // Debug screenshot of the REAL app (real window + real IPC handlers). Set:
  //   FLUX_SMOKE_SHOT=<path>     capture once after load, then quit (no-op if unset)
  //   FLUX_SMOKE_VIEW=stats|session   click into that view before capturing
  //   FLUX_SMOKE_THEME=<key>          switch theme before capturing
  if (process.env.FLUX_SMOKE_SHOT && mainWindow) {
    const shotPath = process.env.FLUX_SMOKE_SHOT
    const wc = mainWindow.webContents
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    // The sidebar appears only after every session file is parsed, which grows
    // with transcript size — poll for the selector instead of guessing a delay.
    const waitFor = async (selector, ms) => {
      const deadline = Date.now() + ms
      while (Date.now() < deadline) {
        const found = await wc.executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`)
        if (found) return true
        await wait(250)
      }
      return false
    }
    wc.once('did-finish-load', async () => {
      try {
        await wait(2500)
        if (process.env.FLUX_SMOKE_VIEW === 'stats') {
          await wc.executeJavaScript("document.querySelector('.stats-btn')?.click()")
        } else if (process.env.FLUX_SMOKE_VIEW === 'session') {
          await waitFor('.session-card', 20000)
          await wc.executeJavaScript("document.querySelector('.session-card')?.click()")
        } else if (process.env.FLUX_SMOKE_VIEW === 'skills') {
          await wc.executeJavaScript(
            "[...document.querySelectorAll('.tab')].find((b) => /Skills/.test(b.textContent))?.click()"
          )
        } else if (process.env.FLUX_SMOKE_VIEW === 'mission') {
          await wc.executeJavaScript(
            "[...document.querySelectorAll('.tab')].find((b) => /Mission/.test(b.textContent))?.click()"
          )
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

app.on('will-quit', () => {
  for (const f of stashedImages) {
    try {
      fs.unlinkSync(f)
    } catch {
      /* already gone */
    }
  }
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
  if (usagePoller) usagePoller.stop()
  if (sessionMonitor) sessionMonitor.stop()
  if (watchTimer) clearInterval(watchTimer)
  if (sendChild) {
    try {
      sendChild.kill()
    } catch {
      /* ignore */
    }
  }
  if (process.platform !== 'darwin') app.quit()
})
