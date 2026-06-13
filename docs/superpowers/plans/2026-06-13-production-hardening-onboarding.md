# Production Hardening + Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flux safe to hand to all users — single-instance safety, crash/error capture, a guided first-run, the two foundation residuals (pty allowlist, multi-GB cold read), and the repo hygiene an OSS release needs.

**Architecture:** Mostly additive. New pure/testable main modules (`environment.js`, `crashlog.js`) plus a streamed line reader inside `parser.js`; a basename allowlist in `pty.js`; an `onboarding` section in the existing `SettingsStore`; two React boundaries and a first-run overlay in the renderer. Wiring lands in `index.js`/`preload`. New main modules MUST be added to `electron.vite.config.mjs` rollup inputs or the built app fails to boot.

**Tech Stack:** Electron 42, React 19, node:test (no JSX test runner — pure logic is unit-tested; UI is build- and manually-verified, matching the existing codebase).

**Spec:** `docs/superpowers/specs/2026-06-13-production-hardening-onboarding-design.md`

**Test command:** `npm test` runs `node --test "tests/**/*.test.js"`. Single file: `node --test tests/<name>.test.js`.

---

## File Structure

- New: `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`
- New: `src/main/crashlog.js` — crash/exception capture + rotating log (pure, injectable fs)
- New: `src/main/environment.js` — first-run "doctor" (CLI present/version, logged-in, session count)
- New: `src/renderer/src/components/ErrorBoundary.jsx` — reusable React boundary
- New: `src/renderer/src/components/WelcomeScreen.jsx` — first-run overlay
- Modify: `src/main/settings.js` — `onboarding` section, version 3
- Modify: `src/main/pty.js` — shell basename allowlist
- Modify: `src/main/parser.js` — `streamLinesSync` + streamed `parseSessionFile`
- Modify: `src/main/index.js` — single-instance lock, crashlog install, `env:doctor` + `app:rendererError` IPCs
- Modify: `src/preload/index.js` — `env.doctor`, `app.reportError`
- Modify: `src/renderer/src/main.jsx` — app-level boundary, onboarding fallback default
- Modify: `src/renderer/src/App.jsx` — content boundary, welcome overlay, CLI banner, `startNewChat(cwd)`
- Modify: `src/renderer/src/components/Sidebar.jsx` — zero-sessions empty state
- Modify: `src/renderer/src/index.css` — boundary/welcome/banner/empty styles
- Modify: `electron.vite.config.mjs` — rollup inputs for `environment`, `crashlog`
- Modify: `package.json` — `engines`
- Tests: `tests/settings-onboarding.test.js`, `tests/pty.test.js`, `tests/parser-stream.test.js`, `tests/crashlog.test.js`, `tests/environment.test.js`

---

## Task 1: Repo hygiene

**Files:**
- Create: `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`
- Modify: `package.json`

- [ ] **Step 1: Add the MIT LICENSE**

Create `LICENSE`:

```
MIT License

Copyright (c) 2026 James Collard

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Add `engines` to package.json**

In `package.json`, after `"license": "MIT",` (line 6) add:

```json
  "engines": {
    "node": ">=22"
  },
```

- [ ] **Step 3: Add CHANGELOG.md**

Create `CHANGELOG.md`:

```markdown
# Changelog

All notable changes to Flux Terminal are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [Unreleased]

### Added
- Single-instance lock (a second launch focuses the running window).
- Crash log (`userData/logs/main.log`) capturing uncaught exceptions, unhandled
  rejections, and renderer crashes; rotated, never uploaded.
- React error boundaries (app-level + per-view) with a reload fallback.
- Guided first-run welcome screen (claude CLI / login / sessions checks) and a
  persistent CLI-missing banner.

### Changed
- Session reads stream the transcript in bounded chunks, so multi-GB files no
  longer hit V8's string-size limit.

### Security
- `pty:spawn` validates the requested shell against an allowlist.

## [0.1.0] - 2026-06-11

Initial internal build: real ConPTY terminal (tabs + split), live/relived
Claude Code sessions with a defensive JSONL parser, themes & animated
backgrounds, live token/cost dashboards, session timeline + replay,
cross-session stats, live session tracking, interactive resume, skills,
plan-usage gauges, slash-command autocomplete, inline images, Mission Control,
watcher + notifications, FTS5 search, and an unsigned Windows NSIS build.
```

- [ ] **Step 4: Add CONTRIBUTING.md**

Create `CONTRIBUTING.md`:

```markdown
# Contributing to Flux Terminal

## Where the project lives

Clone to a normal path such as `C:\Users\you\Projects\Flux Terminal`.
**Do not put it under OneDrive** — OneDrive dereferences `node_modules`
junctions and corrupts Electron's ~140 MB binary extraction.

## Setup

```powershell
npm install     # postinstall repairs Electron's binary (see below)
npm run dev     # launch with hot reload
```

If you see "electron.exe missing", run `npm run fix-electron`. On this
toolchain (Node 24 + Electron 42) Electron's own `extract-zip` postinstall can
stall after the first zip entry; `scripts/ensure-electron.cjs` re-extracts it.

`node-pty` needs no native rebuild — v1.1+ ships N-API prebuilds. The packaging
config sets `npmRebuild: false` on purpose; a gyp rebuild fails because the repo
path contains a space ("Flux Terminal").

## Tests

```powershell
npm test                              # all tests
node --test tests/parser-stream.test.js   # one file
```

Tests use Node's built-in runner. The glob form (`"tests/**/*.test.js"`) is
required — `node --test tests/` fails on Windows Node 24.

Pure logic (everything in `src/main/*.js` and `src/renderer/src/lib/*.js`) is
unit-tested. There is no JSX test runner; React components are verified by
`npm run build` and manual runs.

## Build & package

```powershell
npm run build      # bundle main + preload + renderer into out/
npm run dist       # unsigned Windows NSIS installer into dist/
```

Every new `src/main/*.js` module MUST be added to the `rollupOptions.input` map
in `electron.vite.config.mjs`, or the built app boots with "Cannot find
module './x'".
```

- [ ] **Step 5: Commit**

```bash
git add LICENSE CHANGELOG.md CONTRIBUTING.md package.json
git commit -m "chore: add LICENSE, CHANGELOG, CONTRIBUTING, engines field"
```

---

## Task 2: Settings `onboarding` section

**Files:**
- Modify: `src/main/settings.js`
- Test: `tests/settings-onboarding.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/settings-onboarding.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { SettingsStore } = require('../src/main/settings')

function tmpFile() {
  return path.join(os.tmpdir(), 'flux-set-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json')
}

test('onboarding defaults to not-dismissed', () => {
  const s = new SettingsStore(tmpFile())
  assert.deepStrictEqual(s.get().onboarding, { dismissed: false, version: 1 })
})

test('setByPath persists onboarding.dismissed and survives reload', () => {
  const f = tmpFile()
  const s = new SettingsStore(f)
  s.setByPath('onboarding.dismissed', true)
  assert.strictEqual(s.get().onboarding.dismissed, true)
  const reloaded = new SettingsStore(f)
  assert.strictEqual(reloaded.get().onboarding.dismissed, true)
})

test('a v2 file without onboarding loads with the default section', () => {
  const f = tmpFile()
  fs.writeFileSync(f, JSON.stringify({ version: 2, appearance: { theme: 'nord', animations: 'on', model: null } }))
  const s = new SettingsStore(f)
  assert.deepStrictEqual(s.get().onboarding, { dismissed: false, version: 1 })
  assert.strictEqual(s.get().appearance.theme, 'nord')
})

test('invalid onboarding value throws', () => {
  const s = new SettingsStore(tmpFile())
  assert.throws(() => s.setByPath('onboarding.dismissed', 'yes'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/settings-onboarding.test.js`
Expected: FAIL (`onboarding` is undefined / `setByPath` throws "unknown settings path").

- [ ] **Step 3: Implement in settings.js**

In `src/main/settings.js`, change the `DEFAULTS` object: set `version: 3` and add an `onboarding` key:

```js
const DEFAULTS = {
  version: 3,
  appearance: { theme: 'midnight', animations: 'auto', model: null },
  notify: {
    turnFinished: 'badge',
    turnError: 'toast',
    blocked: 'toast',
    usageThreshold: 'toast',
    sound: false,
    muted: false
  },
  profiles: DEFAULT_PROFILES,
  workspace: null,
  onboarding: { dismissed: false, version: 1 },
  appearanceMigrated: false
}
```

In `_load()`, after the `appearanceMigrated` merge line (currently the last `if` before the `catch`), add:

```js
      if (parsed.onboarding && typeof parsed.onboarding === 'object') {
        if (typeof parsed.onboarding.dismissed === 'boolean') this.data.onboarding.dismissed = parsed.onboarding.dismissed
        if (typeof parsed.onboarding.version === 'number') this.data.onboarding.version = parsed.onboarding.version
      }
```

Add a setter method (next to `setMigrated`):

```js
  setOnboarding(key, value) {
    if (key === 'dismissed') {
      if (typeof value !== 'boolean') throw new Error('onboarding.dismissed must be boolean')
      this.data.onboarding.dismissed = value
    } else if (key === 'version') {
      if (typeof value !== 'number') throw new Error('onboarding.version must be a number')
      this.data.onboarding.version = value
    } else {
      throw new Error('unknown onboarding key: ' + key)
    }
    this._save()
    return this.get()
  }
```

In `setByPath()`, add a route before the final `throw`:

```js
    if (section === 'onboarding') return this.setOnboarding(key, value)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/settings-onboarding.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/settings.js tests/settings-onboarding.test.js
git commit -m "feat(settings): onboarding section (first-run dismissal), bump to v3"
```

---

## Task 3: pty shell allowlist

**Files:**
- Modify: `src/main/pty.js`
- Test: `tests/pty.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/pty.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const { isAllowedShell, createPty } = require('../src/main/pty')

test('null shell is allowed (falls back to default)', () => {
  assert.strictEqual(isAllowedShell(null), true)
  assert.strictEqual(isAllowedShell(undefined), true)
})

test('known shells are allowed, by basename, case-insensitively', () => {
  assert.strictEqual(isAllowedShell('powershell.exe'), true)
  assert.strictEqual(isAllowedShell('PowerShell.exe'), true)
  assert.strictEqual(isAllowedShell('cmd.exe'), true)
  assert.strictEqual(isAllowedShell('C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe'), true)
  assert.strictEqual(isAllowedShell('/bin/bash'), true)
})

test('arbitrary executables are rejected', () => {
  assert.strictEqual(isAllowedShell('notepad.exe'), false)
  assert.strictEqual(isAllowedShell('evil.exe'), false)
  assert.strictEqual(isAllowedShell(''), false)
  assert.strictEqual(isAllowedShell(42), false)
})

test('createPty throws (before spawning) for a disallowed shell', () => {
  assert.throws(() => createPty({ shell: 'notepad.exe' }), /not allowed/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pty.test.js`
Expected: FAIL (`isAllowedShell` is not exported).

- [ ] **Step 3: Implement in pty.js**

In `src/main/pty.js`, add above `createPty`:

```js
// Renderer-supplied shells flow into node-pty. node-pty uses no shell parsing
// (empty args array) so this isn't classic injection, but an XSS could
// otherwise launch an arbitrary exe — restrict to known shells by basename.
const ALLOWED_SHELLS = new Set([
  'powershell.exe', 'pwsh.exe', 'cmd.exe', 'bash.exe', 'wsl.exe', // Windows
  'bash', 'zsh', 'sh', 'fish', 'pwsh' // Unix
])

function isAllowedShell(shell) {
  if (shell == null) return true // null/undefined => platform default
  if (typeof shell !== 'string' || !shell) return false
  const base = shell.replace(/\\/g, '/').split('/').pop().toLowerCase()
  return ALLOWED_SHELLS.has(base)
}
```

Change `createPty` to guard, and update the export:

```js
function createPty({ cols = 80, rows = 30, cwd, shell } = {}) {
  if (!isAllowedShell(shell)) throw new Error('shell not allowed: ' + shell)
  return pty.spawn(shell || defaultShell(), [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: cwd || os.homedir(),
    env: process.env
  })
}

module.exports = { createPty, defaultShell, isAllowedShell }
```

(`PtyManager.spawn` already try/catches `createPty` and surfaces the throw as
`{ ok: false, error: lastSpawnError }`, so no change is needed there.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/pty.test.js`
Expected: PASS (4 tests). The disallowed-shell test throws before `pty.spawn`, so no real terminal is launched.

- [ ] **Step 5: Commit**

```bash
git add src/main/pty.js tests/pty.test.js
git commit -m "feat(pty): allowlist renderer-supplied shells by basename"
```

---

## Task 4: Streamed cold read (multi-GB safe)

**Files:**
- Modify: `src/main/parser.js`
- Test: `tests/parser-stream.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/parser-stream.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { streamLinesSync, parseSessionFile } = require('../src/main/parser')

function tmp(content) {
  const f = path.join(os.tmpdir(), 'flux-jsonl-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.jsonl')
  fs.writeFileSync(f, content)
  return f
}

test('streamLinesSync reconstructs lines across tiny chunks incl. multibyte', () => {
  const f = tmp('héllo\nwörld\nok') // no trailing newline; é/ö are 2-byte UTF-8
  const seen = []
  streamLinesSync(f, (line, isLast) => seen.push([line, isLast]), { chunkSize: 3 })
  assert.deepStrictEqual(seen, [['héllo', false], ['wörld', false], ['ok', true]])
})

test('streamLinesSync: trailing newline => no isLast leftover', () => {
  const f = tmp('a\nb\n')
  const seen = []
  streamLinesSync(f, (line, isLast) => seen.push([line, isLast]), { chunkSize: 1 })
  assert.deepStrictEqual(seen, [['a', false], ['b', false]])
})

test('parseSessionFile (streamed) counts messages and tolerates a truncated final line', () => {
  const lines = [
    JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/p', timestamp: '2026-01-01T00:00:00Z', message: { content: 'hi there' } }),
    JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'claude-x', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: 'hello' }] } }),
    '{ this line is truncated and not valid json'
  ].join('\n')
  const f = tmp(lines) // no trailing newline -> last (bad) line is the expected truncation
  const r = parseSessionFile(f, { timeline: true })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.counts.user, 1)
  assert.strictEqual(r.counts.assistant, 1)
  assert.strictEqual(r.usage.output, 5)
  assert.strictEqual(r.parseErrors, 0) // truncated FINAL line is expected, not an error
  assert.ok(r.timeline.length >= 2)
})

test('parseSessionFile counts an invalid NON-final (newline-terminated) line as a parse error', () => {
  const f = tmp('not json\n' + JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n')
  const r = parseSessionFile(f)
  assert.strictEqual(r.parseErrors, 1)
})

test('parseSessionFile returns ok:false for a missing file', () => {
  const r = parseSessionFile(path.join(os.tmpdir(), 'flux-does-not-exist-' + Date.now() + '.jsonl'))
  assert.strictEqual(r.ok, false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/parser-stream.test.js`
Expected: FAIL (`streamLinesSync` is not exported).

- [ ] **Step 3: Implement in parser.js**

In `src/main/parser.js`, add after the `MAX_IMAGES` constant:

```js
const STREAM_CHUNK = 1 << 20 // 1 MiB read buffer for the cold/whole-file path
```

Add this function above `parseSessionFile`:

```js
/**
 * Read a file line-by-line in bounded chunks, never loading it whole — avoids
 * V8's ~512 MB string cap on multi-GB transcripts. Splitting happens on '\n'
 * byte boundaries; newline is single-byte ASCII so a partial multibyte
 * codepoint at a chunk boundary is preserved in `leftover` (a Buffer) and never
 * bisected. onLine(line, isLast): complete (newline-terminated) lines get
 * isLast=false; a trailing line with no final newline gets isLast=true. Throws
 * on open/read error (the caller decides what that means).
 */
function streamLinesSync(filePath, onLine, { fsImpl = fs, chunkSize = STREAM_CHUNK } = {}) {
  const fd = fsImpl.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(chunkSize)
    let leftover = Buffer.alloc(0)
    let bytes
    while ((bytes = fsImpl.readSync(fd, buf, 0, chunkSize, null)) > 0) {
      const data = leftover.length ? Buffer.concat([leftover, buf.subarray(0, bytes)]) : Buffer.from(buf.subarray(0, bytes))
      const lastNl = data.lastIndexOf(0x0a)
      if (lastNl === -1) {
        leftover = data
        continue
      }
      const complete = data.subarray(0, lastNl).toString('utf8') // up to, excluding, last '\n'
      leftover = Buffer.from(data.subarray(lastNl + 1))
      let start = 0
      for (let i = 0; i < complete.length; i++) {
        if (complete.charCodeAt(i) === 10) {
          onLine(complete.slice(start, i), false)
          start = i + 1
        }
      }
      onLine(complete.slice(start), false) // last complete line in this batch
    }
    if (leftover.length > 0) onLine(leftover.toString('utf8'), true)
  } finally {
    fsImpl.closeSync(fd)
  }
}
```

Replace the body of `parseSessionFile` (the whole function) with the streamed version:

```js
function parseSessionFile(filePath, opts = {}) {
  const collectTimeline = !!opts.timeline
  const timeline = collectTimeline ? [] : null
  const model = freshModel(filePath)
  try {
    streamLinesSync(filePath, (line, isLast) => {
      if (!line.trim()) return
      const o = parseLine(line)
      if (!o) {
        // A truncated/half-written final line is expected; only complete
        // (newline-terminated) bad lines are real parse errors.
        if (!isLast) model.parseErrors++
        return
      }
      applyEvent(o, model, timeline)
    })
  } catch (err) {
    return { ok: false, error: err.message, file: filePath }
  }
  if (timeline) model.timeline = timeline
  return finalize(model)
}
```

Update the export line to add `streamLinesSync`:

```js
module.exports = { parseSessionFile, streamLinesSync, parseLine, freshModel, applyEvent, finalize, isErrorRecord, isRealUserPrompt }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/parser-stream.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the existing parser tests for regressions**

Run: `node --test tests/parser-errors.test.js tests/parser-images.test.js tests/parser-turns.test.js tests/parser-usage.test.js`
Expected: PASS (all existing parser tests still green — the per-line behavior is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/main/parser.js tests/parser-stream.test.js
git commit -m "fix(parser): stream cold reads in bounded chunks (multi-GB safe)"
```

---

## Task 5: Crash log module

**Files:**
- Create: `src/main/crashlog.js`
- Test: `tests/crashlog.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/crashlog.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { appendLine, rotateIfNeeded } = require('../src/main/crashlog')

function tmpDir() {
  const d = path.join(os.tmpdir(), 'flux-crash-' + Date.now() + '-' + Math.random().toString(36).slice(2))
  fs.mkdirSync(d, { recursive: true })
  return d
}

test('appendLine writes a JSON line and creates the dir', () => {
  const file = path.join(tmpDir(), 'logs', 'main.log')
  appendLine(file, 'uncaughtException', 'boom', 'stack here')
  const body = fs.readFileSync(file, 'utf-8').trim()
  const obj = JSON.parse(body)
  assert.strictEqual(obj.kind, 'uncaughtException')
  assert.strictEqual(obj.message, 'boom')
  assert.strictEqual(obj.stack, 'stack here')
})

test('appendLine never throws even when the write fails', () => {
  const fsImpl = { mkdirSync() {}, statSync() { throw new Error('x') }, appendFileSync() { throw new Error('nope') } }
  assert.doesNotThrow(() => appendLine('/nope/main.log', 'k', 'm', 's', { fsImpl }))
})

test('rotateIfNeeded shifts files when over the threshold', () => {
  const file = path.join(tmpDir(), 'main.log')
  fs.writeFileSync(file, 'x'.repeat(50))
  rotateIfNeeded(file, { maxBytes: 10, keep: 3 })
  assert.ok(fs.existsSync(file.replace(/\.log$/, '.1.log')))
  assert.ok(!fs.existsSync(file)) // current was renamed away
})

test('rotateIfNeeded does nothing under the threshold', () => {
  const file = path.join(tmpDir(), 'main.log')
  fs.writeFileSync(file, 'tiny')
  rotateIfNeeded(file, { maxBytes: 1000 })
  assert.ok(fs.existsSync(file))
  assert.ok(!fs.existsSync(file.replace(/\.log$/, '.1.log')))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/crashlog.test.js`
Expected: FAIL (cannot find module `../src/main/crashlog`).

- [ ] **Step 3: Implement crashlog.js**

Create `src/main/crashlog.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/crashlog.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/crashlog.js tests/crashlog.test.js
git commit -m "feat(main): local crash log with rotation"
```

---

## Task 6: Environment doctor module

**Files:**
- Create: `src/main/environment.js`
- Test: `tests/environment.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/environment.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const { detectCli, detectLoggedIn, getEnvironment } = require('../src/main/environment')

test('detectCli reports found + version when --version succeeds', () => {
  const r = detectCli({ resolveBin: () => 'C:/bin/claude.exe', execFile: () => '2.1.170 (Claude Code)' })
  assert.strictEqual(r.found, true)
  assert.strictEqual(r.version, '2.1.170 (Claude Code)')
  assert.strictEqual(r.path, 'C:/bin/claude.exe')
})

test('detectCli reports not-found when the binary fails', () => {
  const r = detectCli({ resolveBin: () => 'claude', execFile: () => { throw new Error('ENOENT') } })
  assert.strictEqual(r.found, false)
  assert.strictEqual(r.version, null)
  assert.strictEqual(r.path, null) // bare fallback => unknown path
})

test('detectLoggedIn true when credentials carry an access token', () => {
  const fsImpl = { readFileSync: () => JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } }) }
  assert.strictEqual(detectLoggedIn({ fsImpl, home: '/home' }), true)
})

test('detectLoggedIn false when missing/malformed', () => {
  assert.strictEqual(detectLoggedIn({ fsImpl: { readFileSync: () => { throw new Error('no file') } }, home: '/home' }), false)
  assert.strictEqual(detectLoggedIn({ fsImpl: { readFileSync: () => '{}' }, home: '/home' }), false)
})

test('getEnvironment passes session count through and assembles the shape', () => {
  const env = getEnvironment({
    sessionCount: 7,
    resolveBin: () => 'claude',
    execFile: () => '9.9.9',
    fsImpl: { readFileSync: () => JSON.stringify({ claudeAiOauth: { accessToken: 't' } }) },
    home: '/h'
  })
  assert.strictEqual(env.sessionCount, 7)
  assert.strictEqual(env.cli.found, true)
  assert.strictEqual(env.loggedIn, true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/environment.test.js`
Expected: FAIL (cannot find module `../src/main/environment`).

- [ ] **Step 3: Implement environment.js**

Create `src/main/environment.js`:

```js
// src/main/environment.js
// First-run "doctor": is the claude CLI present (+ version), is the user logged
// in, and how many sessions exist. Pure + injectable so it unit-tests without
// touching the real PATH or filesystem.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { resolveClaudeBin, needsShell } = require('./resume')

function detectCli({ execFile = execFileSync, resolveBin = resolveClaudeBin } = {}) {
  const bin = resolveBin()
  try {
    const useShell = needsShell(bin)
    const file = useShell && /\s/.test(bin) ? '"' + bin + '"' : bin
    const out = execFile(file, ['--version'], { encoding: 'utf-8', timeout: 5000, windowsHide: true, shell: useShell })
    return { found: true, version: String(out).trim(), path: bin }
  } catch {
    return { found: false, version: null, path: bin === 'claude' ? null : bin }
  }
}

function detectLoggedIn({ fsImpl = fs, home = os.homedir() } = {}) {
  try {
    const raw = fsImpl.readFileSync(path.join(home, '.claude', '.credentials.json'), 'utf-8')
    const j = JSON.parse(raw)
    return !!(j && j.claudeAiOauth && j.claudeAiOauth.accessToken)
  } catch {
    return false
  }
}

function getEnvironment({ sessionCount = 0, execFile, resolveBin, fsImpl, home } = {}) {
  return {
    cli: detectCli({ execFile, resolveBin }),
    loggedIn: detectLoggedIn({ fsImpl, home }),
    sessionCount
  }
}

module.exports = { getEnvironment, detectCli, detectLoggedIn }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/environment.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/environment.js tests/environment.test.js
git commit -m "feat(main): environment doctor (CLI/login/session checks)"
```

---

## Task 7: Wire main process + preload + rollup

**Files:**
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`
- Modify: `electron.vite.config.mjs`

- [ ] **Step 1: Register the new main modules in the build**

In `electron.vite.config.mjs`, inside `rollupOptions.input`, after the `searchindex` line add:

```js
          searchindex: resolve('src/main/searchindex.js'),
          environment: resolve('src/main/environment.js'),
          crashlog: resolve('src/main/crashlog.js')
```

(Replace the existing `searchindex` line — which has no trailing comma — with the comma'd version shown, then the two new lines.)

- [ ] **Step 2: Require the new modules in index.js**

In `src/main/index.js`, after the `SearchIndex` require (line 22) add:

```js
const { getEnvironment } = require('./environment')
const { install: installCrashLog } = require('./crashlog')
```

- [ ] **Step 3: Add the single-instance lock**

In `src/main/index.js`, immediately after `registerAppScheme(protocol)` (line 41) add:

```js
// Only one Flux may run: a second launch focuses the existing window instead of
// opening another that fights over the same ~/.claude watch + GPU cache.
// (Sub-project #8 will route a flux:// URL out of `argv` here.)
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})
```

- [ ] **Step 4: Add the env:doctor IPC handler**

In `src/main/index.js`, after the `app:version` handler (line 257) add:

```js
ipcMain.handle('env:doctor', () => {
  try {
    const sessionCount = sessionIndex ? sessionIndex.list(1).length : 0
    return { ok: true, env: getEnvironment({ sessionCount }) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
```

- [ ] **Step 5: Install crashlog + renderer-error IPC inside whenReady**

In `src/main/index.js`, replace the opening of the `app.whenReady().then(() => {` callback so the first lines become:

```js
app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return // a second instance is quitting; do nothing
  const crashLog = installCrashLog({ app, dialog })
  ipcMain.on('app:rendererError', (_e, payload) => crashLog.logRendererError(payload))
  serveAppProtocol(protocol, path.join(__dirname, '../renderer'))
```

(The remaining body of `whenReady` is unchanged.)

- [ ] **Step 6: Expose env + reportError in preload**

In `src/preload/index.js`, replace the `app:` block (lines 110-112) with:

```js
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    reportError: (payload) => ipcRenderer.send('app:rendererError', payload)
  },
  env: {
    doctor: () => ipcRenderer.invoke('env:doctor')
  },
```

- [ ] **Step 7: Build to verify wiring**

Run: `npm run build`
Expected: build succeeds; `out/main/environment.js` and `out/main/crashlog.js` are emitted.

Verify the two files exist:
Run (PowerShell): `Test-Path out/main/environment.js, out/main/crashlog.js`
Expected: `True` then `True`.

- [ ] **Step 8: Commit**

```bash
git add src/main/index.js src/preload/index.js electron.vite.config.mjs
git commit -m "feat(main): single-instance lock, crashlog install, env:doctor + rendererError IPC"
```

---

## Task 8: React error boundaries (two tiers)

**Files:**
- Create: `src/renderer/src/components/ErrorBoundary.jsx`
- Modify: `src/renderer/src/main.jsx`
- Modify: `src/renderer/src/App.jsx`
- Modify: `src/renderer/src/index.css`

There is no JSX test runner in this project; verify by build + a manual throw (Step 5).

- [ ] **Step 1: Create the ErrorBoundary component**

Create `src/renderer/src/components/ErrorBoundary.jsx`:

```jsx
import { Component } from 'react'

// Reusable boundary. App-level (full fallback) and per-view (inline fallback).
// Forwards caught errors to the main-process crash log via window.flux.app.reportError.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    try {
      window.flux?.app?.reportError?.({
        message: (error && error.message) || String(error),
        stack: (error && error.stack) || '',
        componentStack: (info && info.componentStack) || ''
      })
    } catch {
      /* never let logging break the fallback */
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className={'error-boundary' + (this.props.inline ? ' inline' : '')}>
        <h2>{this.props.title || 'Flux hit a problem'}</h2>
        <p>{this.props.inline ? 'This view failed to render.' : 'The app ran into an unexpected error.'}</p>
        <button onClick={() => location.reload()}>Reload</button>
        <details>
          <summary>Details</summary>
          <pre>{String((this.state.error && this.state.error.stack) || this.state.error)}</pre>
        </details>
      </div>
    )
  }
}
```

- [ ] **Step 2: Wrap the app in the app-level boundary**

In `src/renderer/src/main.jsx`, add the import after the `App` import (line 2):

```jsx
import ErrorBoundary from './components/ErrorBoundary'
```

Change the fallback default object (line 10) to include `onboarding`:

```jsx
const initial = window.flux.settings.initial || { appearance: { theme: 'midnight', animations: 'auto', model: null }, appearanceMigrated: true, onboarding: { dismissed: false, version: 1 } }
```

Replace the `render(...)` call (lines 34-40) with:

```jsx
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <SettingsProvider initial={seeded}>
      <SessionsProvider>
        <App />
      </SessionsProvider>
    </SettingsProvider>
  </ErrorBoundary>
)
```

- [ ] **Step 3: Wrap the view panes in a per-view boundary**

In `src/renderer/src/App.jsx`, add the import after the `NotificationBell` import (line 12):

```jsx
import ErrorBoundary from './components/ErrorBoundary'
```

Wrap the five conditional view blocks (the `{view === 'session' && ...}` through `{view === 'settings' && ...}` blocks, lines 300-336) in a keyed boundary, leaving the always-mounted terminal `pane-slot` (lines 297-299) OUTSIDE it:

```jsx
        {/* Terminal stays mounted; just hidden when not active. */}
        <div className="pane-slot" style={{ display: view === 'terminal' ? 'flex' : 'none' }}>
          <TerminalWorkspace theme={theme} onActivePty={setActivePtyId} />
        </div>
        <ErrorBoundary key={view} inline title="This view failed to render">
          {view === 'session' && (
            <div className="pane-slot">
              {/* ...unchanged SessionView... */}
            </div>
          )}
          {view === 'stats' && (
            <div className="pane-slot">
              <StatsView sessions={sessions} loading={sessionsLoading} />
            </div>
          )}
          {view === 'skills' && (
            <div className="pane-slot">
              <SkillsView />
            </div>
          )}
          {view === 'mission' && (
            <div className="pane-slot">
              <MissionControl onOpenCard={openCard} />
            </div>
          )}
          {view === 'settings' && (
            <div className="pane-slot">
              <SettingsPage />
            </div>
          )}
        </ErrorBoundary>
```

(Keep the `SessionView` block's existing props exactly as they are; only the wrapping `<ErrorBoundary key={view} ...>` … `</ErrorBoundary>` is added around the five blocks. `key={view}` resets the boundary when you navigate away, so a broken view recovers on switch.)

- [ ] **Step 4: Add boundary styles**

In `src/renderer/src/index.css`, append:

```css
.error-boundary { padding: 32px; max-width: 720px; margin: 40px auto; color: var(--text); }
.error-boundary.inline { margin: 16px; }
.error-boundary h2 { margin: 0 0 8px; }
.error-boundary button { margin: 8px 0; padding: 6px 14px; cursor: pointer; }
.error-boundary pre { white-space: pre-wrap; font-size: 11px; color: var(--text-faint); max-height: 240px; overflow: auto; }
```

- [ ] **Step 5: Build + manual verification**

Run: `npm run build`
Expected: build succeeds.

Manual: in `src/renderer/src/components/StatsView.jsx`, temporarily add `throw new Error('boundary test')` at the top of the component body, run `npm run dev`, click Stats → the inline fallback ("This view failed to render") appears and the rest of the app (terminal, sidebar) stays alive. Switch to Terminal and back → recovered. **Remove the throw.** Confirm the crash log received a `renderer` line at `%APPDATA%/flux-terminal/logs/main.log`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ErrorBoundary.jsx src/renderer/src/main.jsx src/renderer/src/App.jsx src/renderer/src/index.css
git commit -m "feat(renderer): app-level + per-view error boundaries, forward to crash log"
```

---

## Task 9: Guided first-run welcome screen

**Files:**
- Create: `src/renderer/src/components/WelcomeScreen.jsx`
- Modify: `src/renderer/src/App.jsx`
- Modify: `src/renderer/src/index.css`

- [ ] **Step 1: Create the WelcomeScreen component**

Create `src/renderer/src/components/WelcomeScreen.jsx`:

```jsx
import { useState, useEffect } from 'react'

function Row({ ok, label, detail }) {
  return (
    <div className={'welcome-row ' + (ok ? 'ok' : 'warn')}>
      <span className="welcome-check">{ok ? '✓' : '!'}</span>
      <span>
        {label}
        {detail ? ' — ' + detail : ''}
      </span>
    </div>
  )
}

export default function WelcomeScreen({ onDismiss, onLaunch, onBrowse }) {
  const [env, setEnv] = useState(null)
  useEffect(() => {
    let live = true
    window.flux.env.doctor().then((r) => {
      if (live) setEnv(r && r.ok ? r.env : null)
    })
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="welcome-overlay">
      <div className="welcome-card">
        <h1>Welcome to Flux</h1>
        {!env && <div className="welcome-row">Checking your environment…</div>}
        {env && (
          <>
            <Row ok={env.cli.found} label="claude CLI" detail={env.cli.found ? env.cli.version : 'not found on PATH'} />
            <Row ok={env.loggedIn} label="Logged in" detail={env.loggedIn ? null : 'run claude once to sign in'} />
            <Row ok={env.sessionCount > 0} label="Sessions found" detail={String(env.sessionCount)} />
            {!env.cli.found && (
              <div className="welcome-install">
                Install: <code>npm install -g @anthropic-ai/claude-code</code>
              </div>
            )}
          </>
        )}
        <div className="welcome-actions">
          <button className="welcome-primary" onClick={onLaunch}>
            Launch your first claude session
          </button>
          <button onClick={onBrowse}>Browse a folder to start in</button>
          <button className="welcome-skip" onClick={onDismiss}>
            Get started
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into App.jsx**

In `src/renderer/src/App.jsx`, add the import after the new `ErrorBoundary` import:

```jsx
import WelcomeScreen from './components/WelcomeScreen'
```

Make `startNewChat` accept an optional cwd (it's also used as Sidebar's `onNewChat`, which passes a click event — guard the type). Replace the `startNewChat` definition (lines 141-148):

```jsx
  const startNewChat = useCallback((cwd) => {
    const dir = typeof cwd === 'string' ? cwd : ''
    setSelected(null)
    setDetail(null)
    setSendState(null)
    setSendError(null)
    setNewChat({ cwd: dir }) // '' => main defaults to home; user can pick a folder
    setView('session')
  }, [])
```

After the `model`/`setModel` derivations (around line 41), add the welcome handlers:

```jsx
  const showWelcome = !settings.onboarding?.dismissed
  const dismissWelcome = useCallback(() => update('onboarding.dismissed', true), [update])
  const welcomeLaunch = useCallback(() => {
    dismissWelcome()
    startNewChat()
  }, [dismissWelcome, startNewChat])
  const welcomeBrowse = useCallback(async () => {
    const r = await window.flux.dialog.pickFolder()
    if (r && r.ok) {
      dismissWelcome()
      startNewChat(r.path)
    }
  }, [dismissWelcome, startNewChat])
```

(`startNewChat` is defined below these lines; `useCallback` closures capture it fine since they only run on click. If your linter complains about use-before-define, move the `startNewChat` definition above these handlers.)

Render the overlay as the last child inside `app-shell`, after the `searchOpen` block (before the closing `</div>` at line 346):

```jsx
      {showWelcome && (
        <WelcomeScreen onDismiss={dismissWelcome} onLaunch={welcomeLaunch} onBrowse={welcomeBrowse} />
      )}
```

- [ ] **Step 3: Add welcome styles**

In `src/renderer/src/index.css`, append:

```css
.welcome-overlay { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; background: rgba(5, 7, 12, 0.78); backdrop-filter: blur(4px); }
.welcome-card { background: var(--panel, #11151c); border: 1px solid var(--border, #232a36); border-radius: 12px; padding: 28px 32px; width: 440px; max-width: 90vw; color: var(--text); box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
.welcome-card h1 { margin: 0 0 16px; font-size: 22px; }
.welcome-row { display: flex; gap: 10px; align-items: center; padding: 6px 0; }
.welcome-row.ok .welcome-check { color: #a6e3a1; }
.welcome-row.warn .welcome-check { color: #f9e2af; }
.welcome-check { width: 16px; text-align: center; font-weight: 700; }
.welcome-install { margin: 8px 0; font-size: 13px; color: var(--text-faint); }
.welcome-install code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; }
.welcome-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 20px; }
.welcome-actions button { padding: 9px 14px; cursor: pointer; border-radius: 8px; border: 1px solid var(--border, #232a36); background: transparent; color: var(--text); }
.welcome-primary { background: var(--accent, #89b4fa) !important; color: #0b0e14 !important; border: none !important; font-weight: 600; }
.welcome-skip { opacity: 0.7; }
```

- [ ] **Step 4: Build + manual verification**

Run: `npm run build`
Expected: build succeeds.

Manual: with the app NOT dismissed (delete `%APPDATA%/flux-terminal/settings.json` or set its `onboarding.dismissed` to `false`), run `npm run dev` → the welcome overlay appears with the three checks; "Get started" dismisses it and it does not reappear on relaunch (persisted via settings).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/WelcomeScreen.jsx src/renderer/src/App.jsx src/renderer/src/index.css
git commit -m "feat(renderer): guided first-run welcome overlay (env doctor)"
```

---

## Task 10: CLI-missing banner + zero-sessions empty state

**Files:**
- Modify: `src/renderer/src/App.jsx`
- Modify: `src/renderer/src/components/Sidebar.jsx`
- Modify: `src/renderer/src/index.css`

- [ ] **Step 1: Fetch the doctor result once in App and render a banner**

In `src/renderer/src/App.jsx`, add state + effect near the other top-level state (after the `live` state/effect, around line 48):

```jsx
  const [doctor, setDoctor] = useState(null)
  useEffect(() => {
    window.flux.env.doctor().then((r) => setDoctor(r && r.ok ? r.env : null))
  }, [])
```

Render the banner as the first child inside `<main className="main-pane">` (before the `<div className="topbar">`, line 248):

```jsx
        {doctor && !doctor.cli.found && (
          <div className="cli-banner">
            claude CLI not found on PATH. Install: <code>npm install -g @anthropic-ai/claude-code</code>, then restart Flux.
          </div>
        )}
```

- [ ] **Step 2: Zero-sessions empty state in the Sidebar**

In `src/renderer/src/components/Sidebar.jsx`, replace the empty-state block (lines 71-73):

```jsx
        {!loading && !error && filtered.length === 0 && (
          q ? (
            <div className="hint">No sessions match “{query}”.</div>
          ) : (
            <div className="empty-sessions">
              <div>No sessions yet.</div>
              <button className="new-chat-btn" onClick={onNewChat}>+ Launch a claude session</button>
            </div>
          )
        )}
```

- [ ] **Step 3: Styles**

In `src/renderer/src/index.css`, append:

```css
.cli-banner { background: #f9e2af; color: #1a1a1a; padding: 8px 14px; font-size: 13px; }
.cli-banner code { background: rgba(0,0,0,0.12); padding: 1px 5px; border-radius: 4px; }
.empty-sessions { padding: 24px 8px; text-align: center; color: var(--text-faint); display: flex; flex-direction: column; gap: 12px; align-items: center; }
```

- [ ] **Step 4: Build + manual verification**

Run: `npm run build`
Expected: build succeeds. Manual (optional): rename `claude` off PATH to see the banner; the zero-sessions state shows when `~/.claude/projects` has no transcripts.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.jsx src/renderer/src/components/Sidebar.jsx src/renderer/src/index.css
git commit -m "feat(renderer): CLI-missing banner + zero-sessions empty state"
```

---

## Task 11: Full verification + roadmap note

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the 5 new files (settings-onboarding, pty, parser-stream, crashlog, environment). Note the new total count.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: succeeds with no missing-module warnings.

- [ ] **Step 3: Add a roadmap entry to README**

In `README.md`, after the "FTS search" roadmap bullet (the last `- [x]` item, around line 168), add:

```markdown
- [x] **Production hardening + onboarding:** single-instance lock (a second
      launch focuses the running window), a rotating local crash log, app-level
      + per-view React error boundaries, a guided first-run welcome screen
      (claude-CLI / login / sessions checks) with a persistent CLI-missing
      banner, a `pty:spawn` shell allowlist, and streamed cold reads so
      multi-GB transcripts no longer hit V8's string limit. LICENSE / CHANGELOG
      / CONTRIBUTING added.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: roadmap entry for production hardening + onboarding"
```

---

## Self-Review

**Spec coverage:**
- Single-instance lock + second-instance focus → Task 7 (steps 3, 5).
- Crash log (uncaught/unhandled/render-gone, rotation, log+dialog+keep-running) → Task 5 + Task 7 step 5.
- Two-tier React error boundary + `app:rendererError` forward → Task 8 (+ IPC in Task 7 step 5, preload Task 7 step 6).
- `environment.js` + `env:doctor` (CLI/version, loggedIn, sessionCount) → Task 6 + Task 7 step 4.
- WelcomeScreen overlay, first-run-only via settings → Task 9.
- `onboarding` settings section, version 3 → Task 2.
- CLI-missing banner + zero-sessions empty state → Task 10.
- pty:spawn allowlist → Task 3.
- Cold-read V8 fix (chunked streamed reader) → Task 4.
- LICENSE / engines / CHANGELOG / CONTRIBUTING → Task 1.
- Rollup inputs for new main modules → Task 7 step 1.

**Placeholder scan:** none — every code/edit step shows full content; UI tasks state build+manual verification explicitly (no JSX runner exists, matching the codebase).

**Type/name consistency:** `streamLinesSync(file, onLine, opts)` and `parseSessionFile` exports match Task 4 usage; `getEnvironment`/`detectCli`/`detectLoggedIn` signatures match Task 6 tests and the Task 7 handler; `installCrashLog`/`crashLog.logRendererError` match Task 5's `install`/return shape; `isAllowedShell` matches Task 3 export; `onboarding.dismissed` path is consistent across settings.js (Task 2), the App handler (Task 9), and settings-context's generic `applyPath`.

**Notes for the executor:** Tasks 1-6 are independent and can run in any order; Task 7 depends on 5+6; Tasks 8-10 depend on 7 (preload `env`/`reportError`); Task 11 is last. Commit after every task.
```
