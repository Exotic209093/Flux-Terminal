// src/main/ptymanager.js
const { createPty } = require('./pty')

// Owns every live PTY keyed by a renderer-supplied id. One pane === one id.
// `spawn`/`onData`/`onExit` are injectable so the manager is unit-testable
// without node-pty (mirrors usage.js's injectable fetch pattern).
class PtyManager {
  constructor({ spawn = createPty, onData = () => {}, onExit = () => {} } = {}) {
    this._spawn = spawn
    this.onData = onData
    this.onExit = onExit
    this.ptys = new Map() // id -> pty
  }

  get size() {
    return this.ptys.size
  }

  has(id) {
    return this.ptys.has(id)
  }

  spawn(id, opts) {
    if (this.ptys.has(id)) return this.ptys.get(id) // idempotent
    let p
    try {
      p = this._spawn(opts)
    } catch {
      // node-pty throws on a nonexistent cwd; match the {ok:false} contract
      // every other channel has instead of rejecting the invoke promise.
      return null
    }
    p.onData((data) => this.onData(id, data))
    p.onExit(({ exitCode }) => {
      this.ptys.delete(id)
      this.onExit(id, exitCode)
    })
    this.ptys.set(id, p)
    return p
  }

  write(id, data) {
    const p = this.ptys.get(id)
    if (!p) return
    try {
      p.write(data)
    } catch {
      /* pty fd may have closed between the guard and the write (process-exit race) */
    }
  }

  resize(id, cols, rows) {
    const p = this.ptys.get(id)
    if (!p) return
    try {
      p.resize(cols, rows)
    } catch {
      /* transient resize race */
    }
  }

  kill(id) {
    const p = this.ptys.get(id)
    if (!p) return
    try {
      p.kill()
    } catch {
      /* already gone */
    }
    this.ptys.delete(id)
  }

  killAll() {
    for (const p of this.ptys.values()) {
      try {
        p.kill()
      } catch {
        /* ignore */
      }
    }
    this.ptys.clear()
  }
}

module.exports = { PtyManager }
