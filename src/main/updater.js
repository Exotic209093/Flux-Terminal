// src/main/updater.js
// In-app auto-update via electron-updater. No-op unless the app is packaged
// (dev runs from source and has no update feed). electron-updater is
// lazy-required so this module — and unit tests / the dev process — never load
// it unless an update check actually runs.

function shouldAutoUpdate(app) {
  return !!(app && app.isPackaged)
}

function initAutoUpdate({ app, updater, logger = console, onEvent } = {}) {
  if (!shouldAutoUpdate(app)) return false
  const u = updater || require('electron-updater').autoUpdater
  try {
    u.autoDownload = true
    u.on('error', (e) => logger.error && logger.error('[updater] ' + (e && e.message)))
    u.on('update-available', (info) => {
      logger.log && logger.log('[updater] update-available ' + (info && info.version))
      onEvent && onEvent('available', info)
    })
    u.on('update-downloaded', (info) => {
      logger.log && logger.log('[updater] update-downloaded ' + (info && info.version))
      onEvent && onEvent('downloaded', info)
    })
    u.checkForUpdatesAndNotify()
    return true
  } catch (e) {
    logger.error && logger.error('[updater] init failed ' + (e && e.message))
    return false
  }
}

module.exports = { shouldAutoUpdate, initAutoUpdate }
