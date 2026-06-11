// src/main/resume.js
// Runs `claude` child processes for interactive resume + new chats.
//
// Security contract (the renderer is untrusted input):
//   - sessionId must be a UUID, model a conservative charset, BEFORE either
//     reaches argv. With shell:true on Windows argv is flattened into a cmd.exe
//     line, so unvalidated values were command injection.
//   - The binary is resolved once via where/which; a real path spawns with
//     shell:false. Only the bare-name fallback and .cmd/.bat shims (which
//     Node cannot spawn directly) go through a shell — safe with validated args
//     and the prompt on stdin.
//
// Concurrency: every child lives in a Map keyed by sessionId, so overlapping
// sends can't clobber each other and interrupt targets the right child.
const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const { randomUUID } = require('crypto')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODEL_RE = /^[a-zA-Z0-9._:][a-zA-Z0-9._:-]{0,79}$/
const TIMEOUT_MS = 150_000
const LIVE_GUARD_MS = 10_000 // file written this recently => live elsewhere
const OWN_SEND_GRACE_MS = 30_000 // unless WE wrote it via a recent send

function isValidSessionId(id) {
  return typeof id === 'string' && UUID_RE.test(id)
}

function isValidModel(model) {
  return model == null || (typeof model === 'string' && MODEL_RE.test(model))
}

function needsShell(bin) {
  return bin === 'claude' || /\.(cmd|bat)$/i.test(bin)
}

/** Resolve the claude binary once at startup (also fixes PATH ambiguity when
 *  launched from the Start menu). Falls back to the bare name + shell. */
function resolveClaudeBin({ platform = process.platform, execFile = execFileSync } = {}) {
  try {
    const out = execFile(platform === 'win32' ? 'where.exe' : 'which', ['claude'], { encoding: 'utf-8' })
    const lines = String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    if (platform !== 'win32') return lines[0] || 'claude'
    // Windows: `where` can list an extensionless sh shim first (npm/fnm
    // installs) which CreateProcess can't run — prefer real executables.
    const exe = lines.find((l) => /\.exe$/i.test(l))
    if (exe) return exe
    const shim = lines.find((l) => /\.(cmd|bat)$/i.test(l))
    if (shim) return shim
  } catch {
    /* not on PATH — the ENOENT/exit path surfaces a friendly error */
  }
  return 'claude'
}

class ClaudeRunner {
  constructor({
    bin = 'claude',
    spawnImpl = spawn,
    onStatus = () => {},
    timeoutMs = TIMEOUT_MS,
    now = Date.now,
    fsImpl = fs,
    findFile = () => null
  } = {}) {
    this.bin = bin
    this._spawn = spawnImpl
    this.onStatus = onStatus // (sessionId, state, error)
    this.timeoutMs = timeoutMs
    this.now = now
    this.fs = fsImpl
    this.findFile = findFile
    this.children = new Map() // sessionId -> { child, interrupting }
    this.lastSentAt = new Map() // sessionId -> ts of our last send
  }

  running() {
    return this.children.size
  }

  /** Message an existing session: claude --resume <id> -p, prompt on stdin. */
  send({ sessionId, cwd, message, model } = {}) {
    if (!sessionId || !message) return { ok: false, error: 'missing sessionId or message' }
    if (!isValidSessionId(sessionId)) return { ok: false, error: 'invalid session id' }
    if (!isValidModel(model)) return { ok: false, error: 'invalid model name' }
    if (this.children.has(sessionId)) {
      return { ok: false, error: 'Already sending to this session — stop it first.' }
    }

    // Guard: can't resume a session that's currently live (being written by
    // another running claude). Recent mtime + we didn't just send here => active
    // elsewhere. Within OWN_SEND_GRACE_MS of our own send, skip the check so a
    // normal back-and-forth isn't false-flagged.
    const file = this.findFile(sessionId)
    if (file) {
      try {
        const st = this.fs.statSync(file)
        const sentAt = this.lastSentAt.get(sessionId) || 0
        if (this.now() - st.mtimeMs < LIVE_GUARD_MS && this.now() - sentAt > OWN_SEND_GRACE_MS) {
          return {
            ok: false,
            error:
              "This session is active right now (being written elsewhere). You can't message an in-progress session — open a past one to continue it."
          }
        }
      } catch {
        /* ignore stat errors */
      }
    }
    if (cwd && !this.fs.existsSync(cwd)) {
      return { ok: false, error: "This session's working folder no longer exists:\n" + cwd }
    }

    const args = ['--resume', sessionId, '-p']
    if (model) args.push('--model', model)
    return this._run(sessionId, args, cwd || os.homedir(), message)
  }

  /** Start a fresh session: claude -p --session-id <uuid>, prompt on stdin. */
  newChat({ message, cwd, model } = {}) {
    if (!message) return { ok: false, error: 'missing message' }
    if (!isValidModel(model)) return { ok: false, error: 'invalid model name' }
    const dir = cwd || os.homedir()
    if (!this.fs.existsSync(dir)) return { ok: false, error: 'Working folder does not exist:\n' + dir }
    const sessionId = randomUUID()
    const args = ['-p', '--session-id', sessionId]
    if (model) args.push('--model', model)
    const res = this._run(sessionId, args, dir, message)
    return res.ok ? { ok: true, sessionId, cwd: dir } : res
  }

  /** Stop a running child. Without an id, targets the most recently started. */
  interrupt(sessionId) {
    let id = sessionId
    if (!id) {
      const ids = [...this.children.keys()]
      id = ids[ids.length - 1]
    }
    const entry = id ? this.children.get(id) : null
    if (!entry) return { ok: false, error: 'nothing running' }
    entry.interrupting = true
    try {
      entry.child.kill()
    } catch {
      /* already gone */
    }
    return { ok: true }
  }

  killAll() {
    for (const entry of this.children.values()) {
      try {
        entry.child.kill()
      } catch {
        /* ignore */
      }
    }
    this.children.clear()
  }

  _run(sessionId, args, cwd, message) {
    let child
    try {
      const useShell = needsShell(this.bin)
      // Under a shell, cmd.exe re-parses the command line — a path with spaces
      // must be quoted or 'C:\Users\John' is what runs.
      const file = useShell && /\s/.test(this.bin) ? '"' + this.bin + '"' : this.bin
      child = this._spawn(file, args, { cwd, shell: useShell, windowsHide: true })
    } catch (err) {
      return { ok: false, error: err.message }
    }
    const entry = { child, interrupting: false }
    this.children.set(sessionId, entry)
    this.lastSentAt.set(sessionId, this.now())
    this.onStatus(sessionId, 'running', null)

    let stderr = ''
    let settled = false
    const finish = (state, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (entry.interrupting) {
        state = 'interrupted'
        error = null
      }
      if (this.children.get(sessionId) === entry) this.children.delete(sessionId)
      this.onStatus(sessionId, state, error || null)
    }
    const timer = setTimeout(() => {
      try {
        entry.child.kill()
      } catch {
        /* ignore */
      }
      finish('error', "claude didn't respond in time. The session may be open elsewhere, or its folder moved.")
    }, this.timeoutMs)
    if (timer.unref) timer.unref()

    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', (err) =>
      finish(
        'error',
        err && err.code === 'ENOENT' ? 'Claude Code CLI not found on PATH. Install it, then restart Flux.' : err.message
      )
    )
    child.on('exit', (code) =>
      finish(code === 0 ? 'done' : 'error', code === 0 ? null : stderr.slice(0, 400) || 'claude exited ' + code)
    )
    // If the child dies before/while we write the prompt, stdin emits EPIPE —
    // without a handler that's an uncaught exception in the main process.
    if (typeof child.stdin.on === 'function') child.stdin.on('error', () => {})
    child.stdin.write(message)
    child.stdin.end()
    return { ok: true }
  }
}

module.exports = { ClaudeRunner, resolveClaudeBin, isValidSessionId, isValidModel, needsShell }
