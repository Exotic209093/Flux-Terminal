// src/main/notify.js
// Maps attention events to OS signals per the settings store, with suppression
// (don't nag about the session you're already looking at) and per-session
// coalescing (no storms). All side-effecting deps are injected for testing.

const EVENT_SETTING = {
  'turn:finished': 'turnFinished',
  'turn:error': 'turnError',
  blocked: 'blocked',
  'usage:threshold': 'usageThreshold'
}
const COALESCE_MS = 10_000

function titleFor(notice) {
  const t = notice.title || 'Session'
  switch (notice.event.type) {
    case 'turn:finished':
      return { title: '✓ Turn finished', body: t }
    case 'turn:error':
      return { title: '⚠ Session error', body: t }
    case 'blocked':
      return { title: '⏳ Waiting on you', body: t }
    case 'usage:threshold':
      return { title: '📊 Usage limit near', body: `${notice.event.window} at ${notice.event.utilization}%` }
    default:
      return { title: 'Flux', body: t }
  }
}

class Notifier {
  constructor(opts = {}) {
    this.getWindow = opts.getWindow || (() => null)
    this.getSettings = opts.getSettings || (() => ({ notify: {} }))
    this.getOpenSessionId = opts.getOpenSessionId || (() => null)
    this.NotificationImpl = opts.NotificationImpl
    this.beep = opts.beep || (() => {})
    this.now = opts.now || Date.now
    this.lastDelivered = new Map() // sessionId -> ts
  }

  deliver(notice) {
    const setting = this.getSettings().notify || {}
    const mode = setting[EVENT_SETTING[notice.event.type]] || 'off'
    if (mode === 'off') return

    const win = this.getWindow()
    // Suppress if you're focused on exactly this session already.
    if (win && !win.isDestroyed() && win.isFocused() && this.getOpenSessionId() === notice.sessionId) return

    // Coalesce repeats per session.
    const now = this.now()
    const last = this.lastDelivered.get(notice.sessionId)
    if (last != null && now - last < COALESCE_MS) return
    this.lastDelivered.set(notice.sessionId, now)

    if (mode === 'toast') this._toast(notice)
    else if (mode === 'badge') this._badge()

    if (setting.sound) this.beep()
  }

  _toast(notice) {
    if (!this.NotificationImpl) return
    const { title, body } = titleFor(notice)
    const n = new this.NotificationImpl({ title, body })
    n.on('click', () => {
      const win = this.getWindow()
      if (win && !win.isDestroyed()) {
        if (win.isMinimized && win.isMinimized()) win.restore()
        win.focus()
        win.webContents.send('notify:open-session', { sessionId: notice.sessionId })
      }
    })
    n.show()
  }

  _badge() {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    try {
      win.flashFrame(true)
      win.setOverlayIcon(win.__fluxDot || null, 'needs attention')
    } catch {
      /* overlay unsupported on this platform — flashFrame already fired */
    }
  }

  /** Called when the window regains focus: clear badge/flash. */
  clear() {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    try {
      win.flashFrame(false)
      win.setOverlayIcon(null, '')
    } catch {
      /* ignore */
    }
  }
}

module.exports = { Notifier, titleFor, COALESCE_MS, EVENT_SETTING }
