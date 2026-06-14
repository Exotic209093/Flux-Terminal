// System tray with Show/Quit. Icon resolution falls back to a generated
// nativeImage so packaged builds (which don't ship build/) always have one.
const fs = require('fs')

// 16x16 pink dot — same data URL used for the taskbar overlay badge.
const FALLBACK_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAdklEQVR4nGP43L2CAQ0nfe5eseNz94q3n7tX/IfSO6Di6GoZkDkGn7tXnIRqwoVPQtVhGGCAZCMh/BbZEJgBhGzG5hK4AUkkaobhJJgBO8g0YAfMAGL9ji0swAaQoxmGqeMCisOA4ligOB1QJSVSnBeokhvJwgBc3NY+xPo8owAAAABJRU5ErkJggg=='

function resolveTrayImage(nativeImage, iconPath) {
  try {
    if (iconPath && fs.existsSync(iconPath)) return iconPath
  } catch {
    /* fall through */
  }
  return nativeImage.createFromDataURL(FALLBACK_ICON)
}

function createTray({ Tray, Menu, nativeImage, getWindow, onQuit, iconPath }) {
  const tray = new Tray(resolveTrayImage(nativeImage, iconPath))
  tray.setToolTip('Flux Terminal')
  const show = () => {
    const w = getWindow()
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Flux', click: show },
      { type: 'separator' },
      { label: 'Quit', click: () => onQuit() }
    ])
  )
  tray.on('click', show)
  return tray
}

module.exports = { createTray, resolveTrayImage }
