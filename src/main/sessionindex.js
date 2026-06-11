// src/main/sessionindex.js
// The session-index substrate: one source of truth for "what sessions exist
// and what do they look like", kept fresh by fs events + a reconciliation
// sweep, updated incrementally (O(appended bytes)) via tailer.js, persisted
// so a warm boot parses nothing.
//
// Consumers:
//   sessions:list IPC       -> list(limit)         (summaries, no timelines)
//   SessionMonitor defaults -> recent(), summary() (summary carries a bounded
//                              ring timeline so monitor's snippet/lastRole
//                              helpers keep working unchanged)
//   open-session watch      -> subscribe()/unsubscribe() + delta events
//                              (Task 3)
const fs = require('fs')
const path = require('path')
const sessionsMod = require('./sessions')
const { freshModel, applyEvent, finalize } = require('./parser')
const { snippetOf, lastRoleOf } = require('./monitor')
const { createTail } = require('./tailer')

const RING_MAX = 12 // bounded recent-items ring per session (live.js precedent)
const SWEEP_MS = 15_000
const RECENT_WINDOW_MS = 24 * 3600 * 1000
const DEBOUNCE_MS = 300
const EMIT_DEBOUNCE_MS = 500
const SAVE_DEBOUNCE_MS = 2000

/** Snapshot an accumulator without disturbing it (finalize mutates its clone only). */
function snapshotModel(model) {
  return finalize({ ...model, __models: model.__models, __usageIds: model.__usageIds })
}

/** Map an accumulator + metadata + ring into the exact listSessions entry shape. */
function summarizeModel(meta, model, ring) {
  const snap = snapshotModel(model)
  return {
    sessionId: snap.sessionId || meta.sessionId,
    file: meta.file,
    projectDir: meta.projectDir,
    projectApprox: meta.projectApprox,
    size: meta.size,
    mtimeMs: meta.mtimeMs,
    cwd: snap.cwd || meta.projectApprox,
    title: snap.title || snap.lastUserPrompt || '(untitled session)',
    gitBranch: snap.gitBranch,
    models: snap.models,
    version: snap.version,
    counts: snap.counts,
    usage: snap.usage,
    tools: snap.tools,
    firstTimestamp: snap.firstTimestamp,
    lastTimestamp: snap.lastTimestamp,
    parseErrors: snap.parseErrors,
    errorCount: snap.errorCount,
    turnDurationCount: snap.turnDurationCount,
    lastTurnDurationMs: snap.lastTurnDurationMs,
    lastContextTokens: snap.lastContextTokens,
    lastRole: lastRoleOf({ timeline: ring }),
    lastSnippet: snippetOf({ timeline: ring })
  }
}

function defaultWatchFactory(dir, onEvent) {
  const w = fs.watch(dir, { recursive: true }, (_ev, fname) => {
    if (fname) onEvent(String(fname))
  })
  // Runtime watcher errors are non-fatal: the sweep reconciles regardless.
  w.on('error', () => {})
  return w
}

class SessionIndex {
  constructor(opts = {}) {
    this.fs = opts.fsImpl || fs
    this.now = opts.now || Date.now
    this.listFiles = opts.listFiles || sessionsMod.listSessionFiles
    this.makeTail = opts.makeTail || ((file) => createTail(file))
    this.watchFactory = opts.watchFactory || defaultWatchFactory
    this.projectsDir = opts.projectsDir || sessionsMod.projectsDir()
    this.cachePath = opts.cachePath || null
    this.sweepMs = opts.sweepMs || SWEEP_MS
    this.recentWindowMs = opts.recentWindowMs || RECENT_WINDOW_MS
    this.debounceMs = opts.debounceMs ?? DEBOUNCE_MS
    this.emitDebounceMs = opts.emitDebounceMs ?? EMIT_DEBOUNCE_MS
    this.saveDebounceMs = opts.saveDebounceMs ?? SAVE_DEBOUNCE_MS
    this.onSessions = opts.onSessions || (() => {})
    this.onWatchRefresh = opts.onWatchRefresh || (() => {})
    this.onWatchAppend = opts.onWatchAppend || (() => {})

    this.summaries = new Map() // file -> { meta, summary, ring }
    this.hot = new Map() // file -> { tail, model } (files changed since boot, inside the recent window)
    this.watchSlot = null // { file, tail, model, timeline } — the open session (Task 3)
    this.mode = 'starting' // 'watch' | 'sweep-only'
    this.watcher = null
    this.sweepTimer = null
    this.pending = new Map() // file -> debounce timer
    this.emitTimer = null
    this.saveTimer = null
  }

  start() {
    this._loadCache()
    try {
      this.watcher = this.watchFactory(this.projectsDir, (rel) => this._onFsEvent(rel))
      this.mode = 'watch'
    } catch {
      this.mode = 'sweep-only' // exotic filesystems: the sweep alone keeps us correct
    }
    this._sweep()
    this.sweepTimer = setInterval(() => this._sweep(), this.sweepMs)
    if (this.sweepTimer.unref) this.sweepTimer.unref()
  }

  dispose() {
    if (this.watcher) {
      try {
        this.watcher.close()
      } catch {
        /* ignore */
      }
    }
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    for (const t of this.pending.values()) clearTimeout(t)
    this.pending.clear()
    if (this.emitTimer) clearTimeout(this.emitTimer)
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this._saveNow()
  }

  // ---- public reads ---------------------------------------------------------

  /** Sorted summaries, newest first. No timelines (IPC payload discipline). */
  list(limit = 200) {
    return [...this.summaries.values()]
      .filter((e) => e.summary)
      .map((e) => e.summary)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit)
  }

  /** Metadata for files active inside the window — monitor's listFiles shape. */
  recent(windowMs = this.recentWindowMs) {
    const now = this.now()
    return [...this.summaries.values()]
      .filter((e) => now - e.meta.mtimeMs <= windowMs)
      .map((e) => ({ ...e.meta }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
  }

  /** Monitor's parse replacement: summary + the bounded ring as `timeline`. */
  summary(file) {
    const e = this.summaries.get(file)
    if (!e || !e.summary) return { ok: false, error: 'unknown session' }
    return { ...e.summary, ok: true, timeline: (e.ring || []).slice() }
  }

  // ---- update path ----------------------------------------------------------

  _metaFor(file) {
    const projectDir = path.basename(path.dirname(file))
    return {
      sessionId: path.basename(file).replace(/\.jsonl$/i, ''),
      file,
      projectDir,
      projectApprox: sessionsMod.approxDecodeProject(projectDir),
      mtimeMs: 0,
      size: 0
    }
  }

  /** Bring one file up to date (incremental; first touch reads from 0). */
  _update(file) {
    let entry = this.summaries.get(file)
    let hot = this.hot.get(file)
    if (!hot) {
      hot = { tail: this.makeTail(file), model: freshModel(file) }
      this.hot.set(file, hot)
      const ring = []
      if (!entry) {
        entry = { meta: this._metaFor(file), summary: null, ring }
        this.summaries.set(file, entry)
      } else {
        // cold entry going hot: the fresh from-zero read rebuilds the ring
        entry.ring = ring
      }
    }
    let delta
    try {
      delta = hot.tail.readDelta()
    } catch {
      this._evict(file)
      return
    }
    if (delta.reset) {
      hot.model = freshModel(file)
      entry.ring.length = 0
      try {
        delta = hot.tail.readDelta()
      } catch {
        this._evict(file)
        return
      }
    }
    for (const o of delta.objects) applyEvent(o, hot.model, entry.ring)
    if (entry.ring.length > RING_MAX) entry.ring.splice(0, entry.ring.length - RING_MAX)
    // Image items carry base64 — keep the ring light (live.js does the same).
    for (let i = 0; i < entry.ring.length; i++) {
      const it = entry.ring[i]
      if (it.kind === 'image' && it.data) entry.ring[i] = { ...it, data: undefined, truncated: true }
    }
    entry.meta.mtimeMs = delta.mtimeMs
    entry.meta.size = delta.size
    entry.summary = summarizeModel(entry.meta, hot.model, entry.ring)
    this._scheduleEmit()
    this._scheduleSave()
  }

  _evict(file) {
    if (this.summaries.delete(file) | this.hot.delete(file)) {
      this._scheduleEmit()
      this._scheduleSave()
    }
  }

  _sweep() {
    let files
    try {
      files = this.listFiles()
    } catch {
      return
    }
    const seen = new Set()
    for (const meta of files) {
      seen.add(meta.file)
      const entry = this.summaries.get(meta.file)
      if (!entry || !entry.summary || entry.meta.mtimeMs !== meta.mtimeMs || entry.meta.size !== meta.size) {
        this._update(meta.file)
        if (this.watchSlot && this.watchSlot.file === meta.file) this._updateSlot()
      }
    }
    for (const file of [...this.summaries.keys()]) {
      if (!seen.has(file)) this._evict(file)
    }
    // Hot accumulators for files idle past the recent window go cold
    // (summary + ring survive; a later change re-seeds from zero).
    const now = this.now()
    for (const file of [...this.hot.keys()]) {
      const entry = this.summaries.get(file)
      if (entry && now - entry.meta.mtimeMs > this.recentWindowMs) this.hot.delete(file)
    }
  }

  // ---- fs events + slot (completed in Task 3) -------------------------------

  _onFsEvent(rel) {
    const parts = String(rel).split(/[\\/]/)
    if (parts.length !== 2 || !parts[1].toLowerCase().endsWith('.jsonl')) return
    const file = path.join(this.projectsDir, parts[0], parts[1])
    const existing = this.pending.get(file)
    if (existing) clearTimeout(existing)
    this.pending.set(
      file,
      setTimeout(() => {
        this.pending.delete(file)
        this._update(file)
        if (this.watchSlot && this.watchSlot.file === file) this._updateSlot()
      }, this.debounceMs)
    )
  }

  _updateSlot() {
    /* implemented in Task 3 */
  }

  // ---- debounced outputs ----------------------------------------------------

  _scheduleEmit() {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.onSessions(this.list(500))
    }, this.emitDebounceMs)
  }

  _scheduleSave() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this._saveNow()
    }, this.saveDebounceMs)
  }

  _loadCache() {
    if (!this.cachePath) return
    try {
      const raw = JSON.parse(this.fs.readFileSync(this.cachePath, 'utf-8'))
      if (!raw || raw.v !== 1 || !Array.isArray(raw.entries)) return
      for (const e of raw.entries) {
        if (e && e.meta && e.meta.file && e.summary) {
          this.summaries.set(e.meta.file, { meta: e.meta, summary: e.summary, ring: Array.isArray(e.ring) ? e.ring : [] })
        }
      }
    } catch {
      /* corrupt/missing cache → cold boot; the sweep rebuilds everything */
    }
  }

  _saveNow() {
    if (!this.cachePath) return
    try {
      const entries = [...this.summaries.values()]
        .filter((e) => e.summary)
        .map((e) => ({ meta: e.meta, summary: e.summary, ring: e.ring || [] }))
      this.fs.writeFileSync(this.cachePath, JSON.stringify({ v: 1, entries }))
    } catch {
      /* a failed save costs a slower next boot, never correctness */
    }
  }
}

module.exports = { SessionIndex, summarizeModel, snapshotModel, RING_MAX }
