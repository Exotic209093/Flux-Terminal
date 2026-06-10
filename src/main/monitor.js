// src/main/monitor.js
const sessionsMod = require('./sessions')
const parserMod = require('./parser')
const subagentsMod = require('./subagents')
const { createAttentionState, observe } = require('./attention')
const { composeCards, cardsChanged } = require('./missioncontrol')

const TICK_MS = 3000
const ACTIVE_WINDOW_MS = 60_000 // file written this recently => "active" (drive attention)
const RECENT_WINDOW_MS = 24 * 3600 * 1000 // shown in Mission Control
const MAX_CARDS = 40
const FINISHED_HOLD_MS = 5 * 60_000 // how long an error stays "unacked" without a new turn

function isRecentlyActive(mtimeMs, now, windowMs) {
  return now - mtimeMs <= windowMs
}

/** Last assistant-text snippet from a parsed timeline (1–2 lines). */
function snippetOf(parsed) {
  const tl = parsed && parsed.timeline
  if (!Array.isArray(tl)) return ''
  for (let i = tl.length - 1; i >= 0; i--) {
    const it = tl[i]
    if (it && it.kind === 'text' && it.text) return it.text.split('\n').slice(0, 2).join(' ').slice(0, 160)
  }
  return ''
}

function lastRoleOf(parsed) {
  const tl = parsed && parsed.timeline
  if (!Array.isArray(tl) || !tl.length) return null
  const last = tl[tl.length - 1]
  return last.kind === 'user' ? 'user' : 'assistant'
}

class SessionMonitor {
  constructor(opts = {}) {
    this.now = opts.now || Date.now
    this.tickMs = opts.tickMs || TICK_MS
    this.activeWindowMs = opts.activeWindowMs || ACTIVE_WINDOW_MS
    this.recentWindowMs = opts.recentWindowMs || RECENT_WINDOW_MS
    this.listFiles = opts.listFiles || sessionsMod.listSessionFiles
    this.parseFile = opts.parseFile || ((file) => parserMod.parseSessionFile(file, { timeline: true }))
    this.countSub = opts.countSub || ((file) => subagentsMod.countSubagents(file, { live: true }))
    this.getOpenSessionId = opts.getOpenSessionId || (() => null)
    this.onAttention = opts.onAttention || (() => {})
    this.onCards = opts.onCards || (() => {})
    this.records = new Map() // sessionId -> record
    this.lastCards = null
    this.timer = null
  }

  start() {
    if (this.timer) return
    this._tick()
    this.timer = setInterval(() => this._tick(), this.tickMs)
    if (this.timer.unref) this.timer.unref()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  _ensure(meta) {
    let rec = this.records.get(meta.sessionId)
    if (!rec) {
      rec = {
        sessionId: meta.sessionId,
        file: meta.file,
        project: meta.projectApprox,
        cwd: meta.projectApprox,
        title: meta.sessionId.slice(0, 8),
        model: null,
        costUsd: 0,
        subagents: { running: 0, total: 0 },
        lastSnippet: '',
        lastActivityMs: meta.mtimeMs,
        lastRole: null,
        hasError: false,
        blocked: false,
        turnOpen: false,
        origin: 'auto',
        _mtime: -1,
        _attn: createAttentionState()
      }
      this.records.set(meta.sessionId, rec)
    }
    return rec
  }

  _tick() {
    const now = this.now()
    const files = this.listFiles().filter((f) => isRecentlyActive(f.mtimeMs, now, this.recentWindowMs))
    const recent = files.slice(0, MAX_CARDS)
    const seen = new Set()

    for (const meta of recent) {
      seen.add(meta.sessionId)
      const rec = this._ensure(meta)
      const active = isRecentlyActive(meta.mtimeMs, now, this.activeWindowMs)
      // Re-parse only when the file grew/changed, or first time.
      if (meta.mtimeMs !== rec._mtime) {
        rec._mtime = meta.mtimeMs
        const parsed = this.parseFile(meta.file)
        if (parsed && parsed.ok !== false) {
          rec.title = parsed.title || rec.title
          rec.cwd = parsed.cwd || rec.cwd
          rec.model = (parsed.models && parsed.models[0]) || rec.model
          rec.costUsd = estimateCostUsd(parsed.usage, rec.model)
          rec.lastSnippet = snippetOf(parsed)
          rec.lastRole = lastRoleOf(parsed)
          rec.lastActivityMs = meta.mtimeMs
          rec._parsedCounts = { user: parsed.counts.user, assistant: parsed.counts.assistant }
          rec._errorCount = parsed.errorCount || 0
        }
        rec.subagents = safe(() => this.countSub(meta.file), { running: 0, total: 0 })
      }

      // Drive attention for active sessions, AND for any session with an open turn
      // even after it goes quiet — otherwise a stall longer than activeWindowMs
      // would drop out of the active set before BLOCKED_MS and never fire 'blocked'.
      if ((active || rec._attn.turnOpen) && rec._parsedCounts) {
        const events = observe(rec._attn, {
          ts: now,
          mtimeMs: meta.mtimeMs,
          userCount: rec._parsedCounts.user,
          assistantCount: rec._parsedCounts.assistant,
          errorCount: rec._errorCount || 0
        })
        for (const event of events) {
          if (event.type === 'turn:error') { rec.hasError = true; rec._errorAt = now }
          this.onAttention({ sessionId: rec.sessionId, project: rec.project, title: rec.title, event })
        }
        // standing status derived from the live attention state
        rec.turnOpen = rec._attn.turnOpen
        rec.blocked = rec._attn.turnOpen && rec._attn.blockedEmitted
        if (rec._attn.turnOpen && rec.hasError) rec.hasError = false // a new turn clears the alert
      }
      if (rec.hasError && rec._errorAt && now - rec._errorAt > FINISHED_HOLD_MS) rec.hasError = false
    }

    // Prune records that dropped out of the recent window.
    for (const id of [...this.records.keys()]) if (!seen.has(id)) this.records.delete(id)

    const cards = composeCards([...this.records.values()], now)
    if (cardsChanged(this.lastCards, cards)) {
      this.lastCards = cards
      this.onCards(cards)
    }
  }

  /** Current cards on demand (for the missioncontrol:list IPC). */
  cards() {
    return composeCards([...this.records.values()], this.now())
  }
}

function safe(fn, fallback) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

// Cost from usage. Keep a tiny self-contained estimate here so the monitor stays
// main-only and testable. Coarse — the card shows "~$x"; exact cost lives in the
// live panel.
const APPROX_PER_MTOK = { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 }
function estimateCostUsd(usage, _model) {
  if (!usage) return 0
  const u = usage
  const c =
    ((u.input || 0) * APPROX_PER_MTOK.input +
      (u.output || 0) * APPROX_PER_MTOK.output +
      (u.cacheRead || 0) * APPROX_PER_MTOK.cacheRead +
      (u.cacheCreation || 0) * APPROX_PER_MTOK.cacheCreation) /
    1_000_000
  return Math.round(c * 100) / 100
}

module.exports = { SessionMonitor, isRecentlyActive, snippetOf, lastRoleOf, estimateCostUsd }
