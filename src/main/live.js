const fs = require('fs')
const { parseLine, freshModel, applyEvent, finalize } = require('./parser')
const { findSessionFileById } = require('./sessions')

// LiveTracker tails a Claude Code session JSONL as it is being written and emits
// periodic snapshots (token usage, cost inputs, tools, recent events).
//
// Correlation is EXACT: we track a specific sessionId (the UUID Flux passes to
// `claude --session-id <uuid>`), not "the newest file" — so a second Claude Code
// session writing to the same project dir can't hijack the panel.
//
// The tail is incremental: each tick reads only the bytes appended since the last
// offset, processes up to the final newline, and re-reads the partial trailing
// line next tick. Scales to large, actively-growing files.

const TICK_MS = 1500
const MAX_RECENT = 12

class LiveTracker {
  constructor(onUpdate) {
    this.onUpdate = onUpdate
    this.timer = null
    this._reset()
  }

  _reset() {
    this.sessionId = null
    this.file = null
    this.offset = 0
    this.model = null
    this.timeline = null // bounded ring of recent items
  }

  /** Begin tracking a specific session id (file may not exist yet). */
  track(sessionId) {
    this._reset()
    this.sessionId = sessionId
    this.model = freshModel(null)
    this.timeline = []
    if (!this.timer) this.timer = setInterval(() => this._tick(), TICK_MS)
    // Emit an immediate "starting" snapshot so the UI flips state right away.
    this._emit('starting')
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    const wasTracking = !!this.sessionId
    this._reset()
    if (wasTracking) this.onUpdate({ tracking: false })
  }

  dispose() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  _tick() {
    if (!this.sessionId) return
    try {
      if (!this.file) {
        this.file = findSessionFileById(this.sessionId)
        if (!this.file) {
          this._emit('starting')
          return
        }
      }
      const stat = fs.statSync(this.file)
      if (stat.size < this.offset) {
        // file truncated/rotated — restart accumulation
        this.offset = 0
        this.model = freshModel(null)
        this.timeline = []
      }
      if (stat.size > this.offset) {
        const len = stat.size - this.offset
        const buf = Buffer.alloc(len)
        const fd = fs.openSync(this.file, 'r')
        try {
          fs.readSync(fd, buf, 0, len, this.offset)
        } finally {
          fs.closeSync(fd)
        }
        const chunk = buf.toString('utf8')
        const lastNl = chunk.lastIndexOf('\n')
        if (lastNl !== -1) {
          const complete = chunk.slice(0, lastNl)
          this.offset += Buffer.byteLength(chunk.slice(0, lastNl + 1), 'utf8')
          for (const line of complete.split('\n')) {
            if (!line.trim()) continue
            const o = parseLine(line)
            if (o) applyEvent(o, this.model, this.timeline)
          }
          if (this.timeline.length > MAX_RECENT) {
            this.timeline = this.timeline.slice(-MAX_RECENT)
          }
        }
      }
      this._emit('live', stat.mtimeMs)
    } catch (err) {
      // File vanished or transient read error — report but keep trying.
      this._emit('starting')
    }
  }

  _emit(state, mtimeMs) {
    // finalize() mutates (strips the Set), so snapshot a shallow clone.
    const snap = finalize({ ...this.model, __models: this.model.__models })
    this.onUpdate({
      tracking: true,
      state, // 'starting' | 'live'
      sessionId: this.sessionId,
      file: this.file,
      mtimeMs: mtimeMs || null,
      title: snap.title,
      cwd: snap.cwd,
      models: snap.models,
      counts: snap.counts,
      usage: snap.usage,
      tools: snap.tools,
      lastTool: snap.lastTool,
      recent: this.timeline ? this.timeline.slice(-MAX_RECENT) : []
    })
  }
}

module.exports = { LiveTracker }
