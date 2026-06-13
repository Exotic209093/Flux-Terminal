// src/main/crashlog.js
// Local-only crash/exception capture. No network, no Sentry (per the roadmap
// audit). Writes structured JSON lines to userData/logs/main.log with simple
// size-based rotation. Logging must NEVER throw.
const fs = require('fs')
const path = require('path')

const MAX_BYTES = 1_000_000
const KEEP = 3

function rotateIfNeeded(file, { fsImpl = fs, maxBytes = MAX_BYTES, keep = KEEP } = {}) {
  let size = 0
  try {
    size = fsImpl.statSync(file).size
  } catch {
    return // no file yet
  }
  if (size < maxBytes) return
  // main.(keep-1).log -> main.keep.log, ..., main.log -> main.1.log
  for (let i = keep; i >= 1; i--) {
    const src = i === 1 ? file : file.replace(/\.log$/, '.' + (i - 1) + '.log')
    const dst = file.replace(/\.log$/, '.' + i + '.log')
    try {
      if (fsImpl.existsSync(src)) fsImpl.renameSync(src, dst)
    } catch {
      /* best-effort */
    }
  }
}

function appendLine(file, kind, message, stack, { fsImpl = fs, now = () => new Date().toISOString() } = {}) {
  try {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true })
    rotateIfNeeded(file, { fsImpl })
    const line =
      JSON.stringify({ ts: now(), kind, message: String(message == null ? '' : message), stack: stack ? String(stack) : undefined }) + '\n'
    fsImpl.appendFileSync(file, line)
  } catch {
    /* logging must never throw */
  }
}

// Installs process/app handlers. `app` and `dialog` are the electron modules
// (injectable for tests). Policy: log, show an error dialog, keep running —
// killing the app would lose the user's live terminals.
function install({ app, dialog, logFile, showDialog = true } = {}) {
  const file = logFile || (app ? path.join(app.getPath('userData'), 'logs', 'main.log') : path.join(process.cwd(), 'main.log'))
  process.on('uncaughtException', (err) => {
    appendLine(file, 'uncaughtException', err && err.message, err && err.stack)
    if (showDialog && dialog) {
      try {
        dialog.showErrorBox('Flux hit an unexpected error', String((err && err.message) || err))
      } catch {
        /* ignore */
      }
    }
  })
  process.on('unhandledRejection', (reason) => {
    const e = reason instanceof Error ? reason : new Error(String(reason))
    appendLine(file, 'unhandledRejection', e.message, e.stack)
  })
  if (app && typeof app.on === 'function') {
    app.on('render-process-gone', (_e, _wc, details) => appendLine(file, 'render-process-gone', (details && details.reason) || 'unknown'))
    app.on('child-process-gone', (_e, details) => appendLine(file, 'child-process-gone', (details && details.reason) || 'unknown'))
  }
  return { file, logRendererError: (p) => appendLine(file, 'renderer', p && p.message, p && (p.stack || p.componentStack)) }
}

module.exports = { install, appendLine, rotateIfNeeded }
