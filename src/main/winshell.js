// Windows taskbar surfaces (Jump List, progress, thumbnail toolbar). All calls
// guard win32 so they no-op elsewhere. Reuses existing interrupt/live plumbing.
const WIN = process.platform === 'win32'

// A small stop/interrupt glyph (pink square) as a tray-sized nativeImage source.
const INTERRUPT_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVR4nGNgGAWjYBSMglEwCkbBKBgFo4CWAAAH0AABz0p9pQAAAABJRU5ErkJggg=='

function progressForState(snapshot) {
  if (snapshot && snapshot.state === 'running') return { value: 2, mode: 'indeterminate' }
  return { value: -1, mode: 'none' }
}

function applyProgress(win, snapshot) {
  if (!WIN || !win || (win.isDestroyed && win.isDestroyed())) return
  const { value, mode } = progressForState(snapshot)
  try {
    win.setProgressBar(value, { mode })
  } catch {
    /* unsupported */
  }
}

function installJumpList(app, execPath) {
  if (!WIN) return
  try {
    app.setUserTasks([
      { program: execPath, arguments: 'flux://mission', title: 'Mission Control', description: 'Open Mission Control', iconPath: execPath, iconIndex: 0 },
      { program: execPath, arguments: 'flux://new', title: 'New chat', description: 'Start a new chat', iconPath: execPath, iconIndex: 0 }
    ])
  } catch {
    /* ignore */
  }
}

function installThumbar(win, { nativeImage, onInterrupt } = {}) {
  if (!WIN || !win || !nativeImage) return { update() {} }
  let btn
  try {
    btn = { tooltip: 'Interrupt claude', icon: nativeImage.createFromDataURL(INTERRUPT_ICON), click: () => onInterrupt && onInterrupt() }
  } catch {
    return { update() {} }
  }
  const update = (running) => {
    try {
      win.setThumbarButtons(running ? [btn] : [])
    } catch {
      /* ignore */
    }
  }
  update(false)
  return { update }
}

module.exports = { progressForState, applyProgress, installJumpList, installThumbar, INTERRUPT_ICON }
