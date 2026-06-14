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
const MAX_HISTORY = 50

function titleFor(notice) {
  const t = notice.title || 'Session'
  const proj = notice.project ? ` · ${notice.project}` : ''
  switch (notice.event.type) {
    case 'turn:finished': {
      const secs = Math.round((notice.event.durationMs || 0) / 1000)
      const dur = secs >= 60 ? `${Math.round(secs / 60)}m` : `${secs}s`
      return { title: `✓ Done in ${dur}`, body: t }
    }
    case 'turn:error':
      return { title: '⚠ Session error', body: t + proj }
    case 'blocked':
      return { title: '⏳ Waiting on you', body: t + proj }
    case 'usage:threshold':
      return { title: '📊 Usage limit near', body: `${notice.event.window} at ${notice.event.utilization}%` }
    default:
      return { title: 'Flux', body: t }
  }
}

function shouldPush(eventType, push) {
  if (!push || !push.enabled || !push.url) return false
  return eventType === 'turn:error' || eventType === 'blocked' || eventType === 'usage:threshold'
}

function buildPushMessage(notice) {
  const { title, body } = titleFor(notice)
  return { title, body }
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
    this.onHistory = opts.onHistory || (() => {})
    this.history = []
    this.snoozed = new Map() // sessionId -> deadline ms
    this.httpPost = opts.httpPost || (() => {})
  }

  snooze(sessionId, minutes) {
    if (!sessionId) return
    this.snoozed.set(sessionId, this.now() + (minutes || 30) * 60_000)
  }

  deliver(notice) {
    const setting = this.getSettings().notify || {}
    if (setting.muted) return // do-not-disturb
    const snoozeUntil = this.snoozed.get(notice.sessionId)
    if (snoozeUntil && this.now() < snoozeUntil) return
    const mode = setting[EVENT_SETTING[notice.event.type]] || 'off'
    if (mode === 'off') return

    const win = this.getWindow()
    if (win && !win.isDestroyed() && win.isFocused() && this.getOpenSessionId() === notice.sessionId) return

    const now = this.now()
    const last = this.lastDelivered.get(notice.sessionId)
    if (last != null && now - last < COALESCE_MS) return
    this.lastDelivered.set(notice.sessionId, now)

    if (mode === 'toast') this._toast(notice)
    else if (mode === 'badge') this._badge()
    if (setting.sound) this.beep()
    this._record(notice, mode)

    const push = this.getSettings().push
    if (shouldPush(notice.event.type, push)) {
      try { this.httpPost(push.url, buildPushMessage(notice)) } catch { /* best-effort */ }
    }
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

  _record(notice, mode) {
    const entry = { type: notice.event.type, sessionId: notice.sessionId, title: notice.title || 'Session', ts: this.now(), mode }
    this.history.unshift(entry)
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY
    this.onHistory(entry)
  }

  getHistory() {
    return this.history.slice()
  }

  /** Fire a sample notification through the real toast path (explicit user action). */
  test() {
    const notice = { sessionId: '__test__', title: 'Flux test notification', project: '', event: { type: 'turn:finished', durationMs: 90_000 } }
    this._toast(notice)
    if ((this.getSettings().notify || {}).sound) this.beep()
    this._record(notice, 'test')
  }
}

module.exports = { Notifier, titleFor, shouldPush, buildPushMessage, COALESCE_MS, EVENT_SETTING, MAX_HISTORY }
