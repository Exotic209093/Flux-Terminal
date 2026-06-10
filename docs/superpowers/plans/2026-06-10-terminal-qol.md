# Terminal Quality-of-Life (Milestone E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flux's terminal half a daily driver — multiple tabs, a two-pane split, saved launch profiles, and per-pane scrollback search — without losing the tracked-`claude` live bar.

**Architecture:** Rework the single-PTY bridge into an id-keyed `PtyManager` (main, injectable/testable). The renderer gains a pure tab/pane reducer (`workspace.js`) driving a new `TerminalWorkspace` that hosts N `TerminalPane` instances (one xterm + one PTY each), with the existing `LivePanel` docked above. Profiles + tab layout persist in the existing `settings.js`. Scrollback search uses `@xterm/addon-search`.

**Tech Stack:** Electron 42 main/preload + React renderer (electron-vite), node-pty (ConPTY), `@xterm/xterm` + `@xterm/addon-fit` + new `@xterm/addon-search`, Node built-in test runner (`node --test`).

---

## As-landed facts the implementer must respect

- The PTY bridge is **single-PTY**: `src/main/index.js` holds one `ptyProc`; `pty:spawn` kills the previous; `pty:data`/`pty:exit` carry **no id**; `pty:write`/`pty:resize` act on the one proc. This is reworked in Phase 1.
- `window.flux.pty` (preload) today: `spawn(opts)`, `write(data)`, `resize(size)`, `onData(cb)`, `onExit(cb)`. After Phase 1 these become id-addressed: `spawn({id,…})`, `write(id,data)`, `resize(id,size)`, `kill(id)`, `onData(cb→{id,data})`, `onExit(cb→{id,code})`.
- Callers of `window.flux.pty.write` today: `TerminalPane.jsx` (`term.onData → write`), `LivePanel.jsx` (`claude --session-id …\r` launch), `ControlBar.jsx` (`/remote-control\r`). All three are updated to pass a pty id.
- `settings.js` currently has only `{ version, notify }` with `get()`/`setNotify()`. We extend it with `profiles` + `workspace` (Phase 5) — additively, same versioned schema.
- Renderer has **no component unit tests** (repo convention). Pure logic (`PtyManager`, `workspace.js` reducer, settings extension) gets `node --test`; components are verified by build + a dev smoke screenshot. The dev smoke MUST run against `npm run dev` (the `file://` production build renders blank in this app).
- Smoke command (PowerShell), used throughout: stop stray electron, then
  `Set-Location "C:\Users\james\Projects\Flux Terminal"; $env:FLUX_SMOKE_SHOT="C:\tmp\<name>.png"; npm run dev 2>&1 | Select-String "FLUX_SMOKE|App threw|Cannot"; Remove-Item Env:FLUX_SMOKE_SHOT`. Look at the PNG; a blank dark frame = failure.

---

## File Structure

**New (main):** `src/main/ptymanager.js` — `PtyManager` (Map<id,pty>, injectable spawn).
**New (renderer):**
- `src/renderer/src/lib/workspace.js` — pure reducer + `allPtyIds`/`deriveTitle` helpers.
- `src/renderer/src/components/TerminalWorkspace.jsx` — owns reducer state, tab bar, layout, docked LivePanel, persistence.
- `src/renderer/src/components/TabBar.jsx` — tab strip + profile-aware `+`.

**Modified:** `src/main/index.js` (PTY IPC → PtyManager, `pty:kill`, killAll), `src/main/settings.js` (profiles + workspace), `src/preload/index.js` (id-addressed pty + settings extras), `src/renderer/src/components/TerminalPane.jsx` (id-keyed + search), `src/renderer/src/components/LivePanel.jsx` (launch via callback), `src/renderer/src/components/ControlBar.jsx` (remote write via active pty id), `src/renderer/src/App.jsx` (swap slot to TerminalWorkspace; lift activePtyId), `src/renderer/src/index.css` (tab/split/search styles), `package.json` (`@xterm/addon-search`).

**New tests:** `tests/ptymanager.test.js`, `tests/workspace.test.js`, `tests/settings-profiles.test.js`.

**Shippable checkpoints:** end of Phase 3 = tabs work. End of Phase 6 = full Milestone E.

---

## Phase 1 — Id-keyed PTY bridge

### Task 1: `PtyManager`

**Files:** Create `src/main/ptymanager.js`; Test `tests/ptymanager.test.js`.

- [ ] **Step 1: Write the failing test**

```js
// tests/ptymanager.test.js
const test = require('node:test')
const assert = require('node:assert')
const { PtyManager } = require('../src/main/ptymanager')

function fakePty() {
  return {
    _data: null, _exit: null, writes: [], resized: null, killed: false,
    onData(cb) { this._data = cb },
    onExit(cb) { this._exit = cb },
    write(d) { this.writes.push(d) },
    resize(c, r) { this.resized = { c, r } },
    kill() { this.killed = true }
  }
}

function managerWith() {
  const created = []
  const data = []
  const exits = []
  const mgr = new PtyManager({
    spawn: (opts) => { const p = fakePty(); p.opts = opts; created.push(p); return p },
    onData: (id, d) => data.push({ id, d }),
    onExit: (id, code) => exits.push({ id, code })
  })
  return { mgr, created, data, exits }
}

test('spawn keys ptys by id and routes their data with the id', () => {
  const { mgr, created, data } = managerWith()
  mgr.spawn('a', { cols: 80, rows: 24 })
  mgr.spawn('b', { cols: 80, rows: 24 })
  assert.strictEqual(mgr.size, 2)
  created[0]._data('hello')
  created[1]._data('world')
  assert.deepStrictEqual(data, [{ id: 'a', d: 'hello' }, { id: 'b', d: 'world' }])
})

test('spawn is idempotent for an existing id', () => {
  const { mgr, created } = managerWith()
  mgr.spawn('a', {})
  mgr.spawn('a', {})
  assert.strictEqual(created.length, 1)
})

test('write/resize/kill address the right pty; kill removes it', () => {
  const { mgr, created } = managerWith()
  mgr.spawn('a', {})
  mgr.spawn('b', {})
  mgr.write('a', 'ls\r')
  mgr.resize('b', 100, 40)
  assert.deepStrictEqual(created[0].writes, ['ls\r'])
  assert.deepStrictEqual(created[1].resized, { c: 100, r: 40 })
  mgr.kill('a')
  assert.strictEqual(created[0].killed, true)
  assert.strictEqual(mgr.has('a'), false)
  assert.strictEqual(mgr.size, 1)
})

test('a pty exit routes the id+code and drops it from the map', () => {
  const { mgr, created, exits } = managerWith()
  mgr.spawn('a', {})
  created[0]._exit({ exitCode: 3 })
  assert.deepStrictEqual(exits, [{ id: 'a', code: 3 }])
  assert.strictEqual(mgr.has('a'), false)
})

test('write/resize/kill on an unknown id are no-ops (no throw)', () => {
  const { mgr } = managerWith()
  assert.doesNotThrow(() => { mgr.write('x', 'y'); mgr.resize('x', 1, 1); mgr.kill('x') })
})

test('killAll kills every pty and empties the map', () => {
  const { mgr, created } = managerWith()
  mgr.spawn('a', {}); mgr.spawn('b', {})
  mgr.killAll()
  assert.ok(created[0].killed && created[1].killed)
  assert.strictEqual(mgr.size, 0)
})
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/ptymanager.test.js` (module not found).

- [ ] **Step 3: Implement `src/main/ptymanager.js`**

```js
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
    const p = this._spawn(opts)
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
```

- [ ] **Step 4: Run to verify pass** — `node --test tests/ptymanager.test.js` (6 pass).

- [ ] **Step 5: Commit**

```bash
git add src/main/ptymanager.js tests/ptymanager.test.js
git commit -m "feat(pty): id-keyed PtyManager (injectable, TDD)"
```
End every commit body in this plan with the trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

### Task 2: rewire the PTY IPC + preload to id-addressed, single pane still works

**Files:** Modify `src/main/index.js`, `src/preload/index.js`, `src/renderer/src/components/TerminalPane.jsx`, `src/renderer/src/components/LivePanel.jsx`, `src/renderer/src/components/ControlBar.jsx`, `src/renderer/src/App.jsx`.

This task keeps the app a single terminal but on the new id-keyed bridge (foundation for tabs).

- [ ] **Step 1: index.js — replace the single-PTY block.**

Add the require near the other requires (after `const { Notifier } = require('./notify')`):
```js
const { PtyManager } = require('./ptymanager')
```
Replace the holder `let ptyProc = null` (around line 21) with:
```js
let ptyManager = null
```
Replace the entire `// ---- PTY bridge ----` block (the `ipcMain.handle('pty:spawn', …)`, `ipcMain.on('pty:write', …)`, `ipcMain.on('pty:resize', …)` — roughly lines 52-86) with:
```js
// ---- PTY bridge (id-keyed; one pane === one pty) --------------------------
ipcMain.handle('pty:spawn', (_e, { id, cols, rows, cwd, shell }) => {
  if (ptyManager) ptyManager.spawn(id, { cols, rows, cwd, shell })
  return { ok: true, id }
})
ipcMain.on('pty:write', (_e, { id, data }) => {
  if (ptyManager) ptyManager.write(id, data)
})
ipcMain.on('pty:resize', (_e, { id, cols, rows }) => {
  if (ptyManager) ptyManager.resize(id, cols, rows)
})
ipcMain.on('pty:kill', (_e, { id }) => {
  if (ptyManager) ptyManager.kill(id)
})
```
In `whenReady` (near where `liveTracker`/`usagePoller` are created), construct the manager:
```js
  ptyManager = new PtyManager({
    onData: (id, data) => emit('pty:data', { id, data }),
    onExit: (id, code) => emit('pty:exit', { id, code })
  })
```
In `app.on('window-all-closed', …)`, replace the `if (ptyProc) { try { ptyProc.kill() } … }` block with:
```js
  if (ptyManager) ptyManager.killAll()
```

- [ ] **Step 2: preload — id-addressed `pty`.** In `src/preload/index.js`, replace the `pty: { … }` block with:
```js
  pty: {
    spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts), // opts: { id, cols, rows, cwd, shell }
    write: (id, data) => ipcRenderer.send('pty:write', { id, data }),
    resize: (id, size) => ipcRenderer.send('pty:resize', { id, cols: size.cols, rows: size.rows }),
    kill: (id) => ipcRenderer.send('pty:kill', { id }),
    onData: (cb) => {
      const listener = (_e, payload) => cb(payload) // { id, data }
      ipcRenderer.on('pty:data', listener)
      return () => ipcRenderer.removeListener('pty:data', listener)
    },
    onExit: (cb) => {
      const listener = (_e, payload) => cb(payload) // { id, code }
      ipcRenderer.on('pty:exit', listener)
      return () => ipcRenderer.removeListener('pty:exit', listener)
    }
  },
```

- [ ] **Step 3: TerminalPane.jsx — take a `ptyId` prop and an optional `cwd`/`shell`.** Replace the file with:
```jsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { themeColors } from '../lib/themes'

// One xterm bound to one PTY id. The PTY is spawned on mount and killed on
// unmount. Data/exit events are filtered to this pane's id.
export default function TerminalPane({ ptyId, theme, cwd, shell, onFocus }) {
  const hostRef = useRef(null)

  useEffect(() => {
    const c = themeColors(theme)
    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: c.background,
        foreground: c.foreground,
        cursor: c.cursor,
        selectionBackground: 'rgba(137,180,250,0.25)'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    fit.fit()

    window.flux.pty.spawn({ id: ptyId, cols: term.cols, rows: term.rows, cwd, shell })
    const offData = window.flux.pty.onData(({ id, data }) => {
      if (id === ptyId) term.write(data)
    })
    const offExit = window.flux.pty.onExit(({ id }) => {
      if (id === ptyId) term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n')
    })
    const onInput = term.onData((data) => window.flux.pty.write(ptyId, data))

    const syncSize = () => {
      fit.fit()
      window.flux.pty.resize(ptyId, { cols: term.cols, rows: term.rows })
    }
    window.addEventListener('resize', syncSize)
    const ro = new ResizeObserver(() => syncSize())
    if (hostRef.current) ro.observe(hostRef.current)
    const t = setTimeout(syncSize, 60)

    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', syncSize)
      ro.disconnect()
      offData()
      offExit()
      onInput.dispose()
      term.dispose()
      window.flux.pty.kill(ptyId)
    }
  }, [ptyId])

  return <div className="terminal-host" ref={hostRef} onMouseDown={onFocus} />
}
```

- [ ] **Step 4: App.jsx — Phase-1 single pane on the new bridge.** App.jsx currently renders `<LivePanel /><TerminalPane theme={theme} />` in the terminal slot. For Phase 1, give the single terminal a stable pty id and thread it to the callers that write to it.

Add near the other `useState` hooks in `App()`:
```js
  const termPtyId = 'main-terminal' // Phase 1: one terminal; Phase 3 replaces this with TerminalWorkspace
```
Change the terminal slot render to pass the id:
```jsx
        <div className="pane-slot" style={{ display: view === 'terminal' ? 'flex' : 'none' }}>
          <LivePanel ptyId={termPtyId} />
          <TerminalPane ptyId={termPtyId} theme={theme} />
        </div>
```
Pass the id to ControlBar (for the remote write):
```jsx
          <ControlBar
            model={model}
            onModel={setModel}
            agents={live && live.tracking ? live.subagents : null}
            liveActive={!!(live && live.tracking && live.state === 'live')}
            onAgentsClick={() => setView('terminal')}
            ptyId={termPtyId}
          />
```

- [ ] **Step 5: LivePanel.jsx — write to the given pty id.** Change the component signature and the launch write:
```jsx
export default function LivePanel({ ptyId }) {
```
```js
  const launch = () => {
    const uuid = crypto.randomUUID()
    window.flux.pty.write(ptyId, `claude --session-id ${uuid}\r`)
    window.flux.live.track(uuid)
  }
```

- [ ] **Step 6: ControlBar.jsx — write to the given pty id.** Change signature to accept `ptyId` and update the remote write:
```jsx
export default function ControlBar({ model, onModel, agents, liveActive, onAgentsClick, ptyId }) {
```
```js
  const toggleRemote = () => {
    if (!liveActive) return
    window.flux.pty.write(ptyId, '/remote-control\r')
    setRemoteOn((v) => !v)
  }
```

- [ ] **Step 7: Verify** — `npm test` (existing suite + 6 new ptymanager tests, all green). `npm run build`. Dev smoke `C:\tmp\flux-e1.png`: the terminal still spawns a PowerShell, "Launch tracked claude" still works (type in it). Confirm the PNG shows a live PowerShell prompt.

- [ ] **Step 8: Commit**
```bash
git add src/main/index.js src/preload/index.js src/renderer/src/components/TerminalPane.jsx src/renderer/src/components/LivePanel.jsx src/renderer/src/components/ControlBar.jsx src/renderer/src/App.jsx
git commit -m "refactor(pty): route terminal through id-keyed PtyManager (single pane preserved)"
```

---

## Phase 2 — Pure tab/pane reducer

### Task 3: `workspace.js` reducer

**Files:** Create `src/renderer/src/lib/workspace.js`; Test `tests/workspace.test.js`.

The reducer is pure: callers generate ids (`crypto.randomUUID()`) and pass them in action payloads, so transitions are deterministic in tests.

- [ ] **Step 1: Write the failing test**

```js
// tests/workspace.test.js
const test = require('node:test')
const assert = require('node:assert')
const { reducer, initialState, allPtyIds, deriveTitle } = require('../src/renderer/src/lib/workspace.js')

// Helper: a tab with one pane.
function seed() {
  return initialState({ tabId: 't1', paneId: 'p1', ptyId: 'pty1', profileId: 'pf', title: 'PS' })
}

test('initialState has one tab, one pane, both active', () => {
  const s = seed()
  assert.strictEqual(s.tabs.length, 1)
  assert.strictEqual(s.activeTabId, 't1')
  assert.strictEqual(s.tabs[0].activePaneId, 'p1')
  assert.strictEqual(s.tabs[0].panes[0].ptyId, 'pty1')
})

test('NEW_TAB appends and activates', () => {
  let s = seed()
  s = reducer(s, { type: 'NEW_TAB', tabId: 't2', paneId: 'p2', ptyId: 'pty2', profileId: 'pf', title: 'PS' })
  assert.strictEqual(s.tabs.length, 2)
  assert.strictEqual(s.activeTabId, 't2')
})

test('CLOSE_TAB removes and re-activates a neighbor', () => {
  let s = seed()
  s = reducer(s, { type: 'NEW_TAB', tabId: 't2', paneId: 'p2', ptyId: 'pty2', profileId: 'pf', title: 'PS' })
  s = reducer(s, { type: 'CLOSE_TAB', tabId: 't2' })
  assert.strictEqual(s.tabs.length, 1)
  assert.strictEqual(s.activeTabId, 't1')
})

test('CLOSE_TAB on the last tab leaves tabs empty (caller opens default)', () => {
  let s = seed()
  s = reducer(s, { type: 'CLOSE_TAB', tabId: 't1' })
  assert.strictEqual(s.tabs.length, 0)
  assert.strictEqual(s.activeTabId, null)
})

test('SPLIT adds a second pane and sets splitDir + active pane', () => {
  let s = seed()
  s = reducer(s, { type: 'SPLIT', tabId: 't1', paneId: 'p2', ptyId: 'pty2', profileId: 'pf', dir: 'v' })
  const tab = s.tabs[0]
  assert.strictEqual(tab.panes.length, 2)
  assert.strictEqual(tab.splitDir, 'v')
  assert.strictEqual(tab.activePaneId, 'p2')
})

test('SPLIT is a no-op on an already-split tab (max 2 panes)', () => {
  let s = seed()
  s = reducer(s, { type: 'SPLIT', tabId: 't1', paneId: 'p2', ptyId: 'pty2', profileId: 'pf', dir: 'v' })
  s = reducer(s, { type: 'SPLIT', tabId: 't1', paneId: 'p3', ptyId: 'pty3', profileId: 'pf', dir: 'h' })
  assert.strictEqual(s.tabs[0].panes.length, 2)
})

test('CLOSE_PANE of a split keeps the tab, drops splitDir, focuses the survivor', () => {
  let s = seed()
  s = reducer(s, { type: 'SPLIT', tabId: 't1', paneId: 'p2', ptyId: 'pty2', profileId: 'pf', dir: 'v' })
  s = reducer(s, { type: 'CLOSE_PANE', paneId: 'p2' })
  const tab = s.tabs[0]
  assert.strictEqual(tab.panes.length, 1)
  assert.strictEqual(tab.splitDir, null)
  assert.strictEqual(tab.activePaneId, 'p1')
})

test('CLOSE_PANE of the only pane closes the whole tab', () => {
  let s = seed()
  s = reducer(s, { type: 'CLOSE_PANE', paneId: 'p1' })
  assert.strictEqual(s.tabs.length, 0)
})

test('FOCUS_PANE activates the containing tab and the pane', () => {
  let s = seed()
  s = reducer(s, { type: 'NEW_TAB', tabId: 't2', paneId: 'p2', ptyId: 'pty2', profileId: 'pf', title: 'PS' })
  s = reducer(s, { type: 'SPLIT', tabId: 't2', paneId: 'p3', ptyId: 'pty3', profileId: 'pf', dir: 'h' })
  s = reducer(s, { type: 'FOCUS_PANE', paneId: 'p2' })
  assert.strictEqual(s.activeTabId, 't2')
  assert.strictEqual(s.tabs[1].activePaneId, 'p2')
})

test('NEXT_TAB cycles and wraps', () => {
  let s = seed()
  s = reducer(s, { type: 'NEW_TAB', tabId: 't2', paneId: 'p2', ptyId: 'pty2', profileId: 'pf', title: 'PS' })
  s = reducer(s, { type: 'FOCUS_TAB', tabId: 't1' })
  s = reducer(s, { type: 'NEXT_TAB' })
  assert.strictEqual(s.activeTabId, 't2')
  s = reducer(s, { type: 'NEXT_TAB' })
  assert.strictEqual(s.activeTabId, 't1') // wrap
})

test('SET_RATIO and RENAME_TAB update the tab', () => {
  let s = seed()
  s = reducer(s, { type: 'SET_RATIO', tabId: 't1', ratio: 0.3 })
  s = reducer(s, { type: 'RENAME_TAB', tabId: 't1', title: 'build' })
  assert.strictEqual(s.tabs[0].ratio, 0.3)
  assert.strictEqual(s.tabs[0].title, 'build')
})

test('allPtyIds lists every pane ptyId across tabs', () => {
  let s = seed()
  s = reducer(s, { type: 'SPLIT', tabId: 't1', paneId: 'p2', ptyId: 'pty2', profileId: 'pf', dir: 'v' })
  s = reducer(s, { type: 'NEW_TAB', tabId: 't2', paneId: 'p3', ptyId: 'pty3', profileId: 'pf', title: 'PS' })
  assert.deepStrictEqual(allPtyIds(s).sort(), ['pty1', 'pty2', 'pty3'])
})

test('deriveTitle prefers an explicit title, else profile name, else cwd basename', () => {
  assert.strictEqual(deriveTitle({ title: 'X', profileName: 'PS', cwd: 'C:\\a\\b' }), 'X')
  assert.strictEqual(deriveTitle({ profileName: 'PS', cwd: 'C:\\a\\b' }), 'PS')
  assert.strictEqual(deriveTitle({ cwd: 'C:\\a\\b' }), 'b')
  assert.strictEqual(deriveTitle({}), 'shell')
})
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/workspace.test.js` (module not found).

- [ ] **Step 3: Implement `src/renderer/src/lib/workspace.js`**

```js
// src/renderer/src/lib/workspace.js
// PURE tab/pane state. Callers generate ids (crypto.randomUUID) and pass them in
// action payloads so transitions are deterministic + unit-testable. Two panes
// max per tab (split-once). State:
//   { tabs: [ { id, title, splitDir: null|'h'|'v', ratio, activePaneId,
//               panes: [ { id, ptyId, profileId } ] } ],
//     activeTabId }

function tab({ tabId, paneId, ptyId, profileId, title }) {
  return {
    id: tabId,
    title: title || 'shell',
    splitDir: null,
    ratio: 0.5,
    activePaneId: paneId,
    panes: [{ id: paneId, ptyId, profileId }]
  }
}

function initialState(seed) {
  return { tabs: [tab(seed)], activeTabId: seed.tabId }
}

function mapTab(state, tabId, fn) {
  return { ...state, tabs: state.tabs.map((t) => (t.id === tabId ? fn(t) : t)) }
}

function findTabOfPane(state, paneId) {
  return state.tabs.find((t) => t.panes.some((p) => p.id === paneId)) || null
}

function reducer(state, action) {
  switch (action.type) {
    case 'NEW_TAB':
      return { ...state, tabs: [...state.tabs, tab(action)], activeTabId: action.tabId }

    case 'CLOSE_TAB': {
      const idx = state.tabs.findIndex((t) => t.id === action.tabId)
      if (idx === -1) return state
      const tabs = state.tabs.filter((t) => t.id !== action.tabId)
      let activeTabId = state.activeTabId
      if (state.activeTabId === action.tabId) {
        const neighbor = tabs[idx - 1] || tabs[idx] || tabs[0]
        activeTabId = neighbor ? neighbor.id : null
      }
      return { ...state, tabs, activeTabId }
    }

    case 'SPLIT':
      return mapTab(state, action.tabId, (t) => {
        if (t.panes.length >= 2) return t // max 2
        return {
          ...t,
          splitDir: action.dir,
          activePaneId: action.paneId,
          panes: [...t.panes, { id: action.paneId, ptyId: action.ptyId, profileId: action.profileId }]
        }
      })

    case 'CLOSE_PANE': {
      const owner = findTabOfPane(state, action.paneId)
      if (!owner) return state
      if (owner.panes.length === 1) return reducer(state, { type: 'CLOSE_TAB', tabId: owner.id })
      const panes = owner.panes.filter((p) => p.id !== action.paneId)
      return mapTab(state, owner.id, (t) => ({
        ...t,
        panes,
        splitDir: null,
        activePaneId: panes[0].id
      }))
    }

    case 'FOCUS_PANE': {
      const owner = findTabOfPane(state, action.paneId)
      if (!owner) return state
      return mapTab({ ...state, activeTabId: owner.id }, owner.id, (t) => ({
        ...t,
        activePaneId: action.paneId
      }))
    }

    case 'FOCUS_TAB':
      return state.tabs.some((t) => t.id === action.tabId) ? { ...state, activeTabId: action.tabId } : state

    case 'NEXT_TAB': {
      if (state.tabs.length < 2) return state
      const i = state.tabs.findIndex((t) => t.id === state.activeTabId)
      const next = state.tabs[(i + 1) % state.tabs.length]
      return { ...state, activeTabId: next.id }
    }

    case 'SET_RATIO':
      return mapTab(state, action.tabId, (t) => ({ ...t, ratio: action.ratio }))

    case 'RENAME_TAB':
      return mapTab(state, action.tabId, (t) => ({ ...t, title: action.title }))

    default:
      return state
  }
}

function allPtyIds(state) {
  return state.tabs.flatMap((t) => t.panes.map((p) => p.ptyId))
}

function deriveTitle({ title, profileName, cwd } = {}) {
  if (title) return title
  if (profileName) return profileName
  if (cwd) {
    const parts = String(cwd).split(/[\\/]/).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  return 'shell'
}

module.exports = { reducer, initialState, allPtyIds, deriveTitle }
```

> Note: this file is `require`d by a `node --test` test (CommonJS) AND imported by the renderer (ESM via Vite). Vite handles `module.exports` interop for the renderer import (`import { reducer } from '../lib/workspace.js'` works). This mirrors the existing `templates.js` dual-use in the repo. Do NOT convert it to ESM-only.

- [ ] **Step 4: Run to verify pass** — `node --test tests/workspace.test.js` (all pass).

- [ ] **Step 5: Commit**
```bash
git add src/renderer/src/lib/workspace.js tests/workspace.test.js
git commit -m "feat(workspace): pure tab/pane reducer (TDD)"
```

---

## Phase 3 — TerminalWorkspace (tabs)  → **shippable**

### Task 4: TabBar + TerminalWorkspace, wired into App

**Files:** Create `src/renderer/src/components/TabBar.jsx`, `src/renderer/src/components/TerminalWorkspace.jsx`; Modify `src/renderer/src/App.jsx`, `src/renderer/src/components/LivePanel.jsx`, `src/renderer/src/index.css`.

- [ ] **Step 1: Create `src/renderer/src/components/TabBar.jsx`**

```jsx
// src/renderer/src/components/TabBar.jsx
import { useState } from 'react'

export default function TabBar({ tabs, activeTabId, onSelect, onClose, onRename, onNew }) {
  const [editing, setEditing] = useState(null) // tabId being renamed

  return (
    <div className="tabbar">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={'tab-chip' + (t.id === activeTabId ? ' active' : '')}
          onClick={() => onSelect(t.id)}
          onDoubleClick={() => setEditing(t.id)}
          title={t.title}
        >
          {editing === t.id ? (
            <input
              className="tab-rename"
              autoFocus
              defaultValue={t.title}
              onBlur={(e) => { onRename(t.id, e.target.value.trim() || t.title); setEditing(null) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.target.blur()
                if (e.key === 'Escape') setEditing(null)
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="tab-label">{t.title}</span>
          )}
          <button
            className="tab-close"
            title="Close tab"
            onClick={(e) => { e.stopPropagation(); onClose(t.id) }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-new" title="New tab (Ctrl+T)" onClick={onNew}>
        +
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/renderer/src/components/TerminalWorkspace.jsx`** (tabs only; split layout added in Phase 4, profiles in Phase 5)

```jsx
// src/renderer/src/components/TerminalWorkspace.jsx
import { useReducer, useEffect, useCallback } from 'react'
import TerminalPane from './TerminalPane'
import TabBar from './TabBar'
import LivePanel from './LivePanel'
import { reducer, initialState, allPtyIds, deriveTitle } from '../lib/workspace'

const uid = (p) => p + '-' + crypto.randomUUID().slice(0, 8)

function freshSeed() {
  return { tabId: uid('t'), paneId: uid('pane'), ptyId: uid('pty'), profileId: 'powershell', title: 'PowerShell' }
}

// Owns the tab/pane workspace. Phase 3: tabs (one pane each). Hosts the docked
// LivePanel; "launch tracked claude" opens a tab and writes into its PTY.
export default function TerminalWorkspace({ theme, onActivePty }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(freshSeed()))

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) || state.tabs[0]
  const activePane = activeTab && activeTab.panes.find((p) => p.id === activeTab.activePaneId)

  // Report the active pane's pty id up (App passes it to ControlBar's remote write).
  useEffect(() => {
    if (onActivePty) onActivePty(activePane ? activePane.ptyId : null)
  }, [activePane, onActivePty])

  // Always keep at least one tab open.
  useEffect(() => {
    if (state.tabs.length === 0) dispatch({ type: 'NEW_TAB', ...freshSeed() })
  }, [state.tabs.length])

  const newTab = useCallback(() => dispatch({ type: 'NEW_TAB', ...freshSeed() }), [])
  const closeTab = useCallback((tabId) => dispatch({ type: 'CLOSE_TAB', tabId }), [])
  const selectTab = useCallback((tabId) => dispatch({ type: 'FOCUS_TAB', tabId }), [])
  const renameTab = useCallback((tabId, title) => dispatch({ type: 'RENAME_TAB', tabId, title }), [])

  // Launch tracked claude: a new tab whose PTY runs `claude --session-id <uuid>`,
  // then start the single LiveTracker on that uuid (docked LivePanel follows it).
  const launchTracked = useCallback(() => {
    const seed = { tabId: uid('t'), paneId: uid('pane'), ptyId: uid('pty'), profileId: 'claude', title: 'claude ✦' }
    dispatch({ type: 'NEW_TAB', ...seed })
    const uuid = crypto.randomUUID()
    // The pane mounts on next paint and spawns its PTY; defer the write so the
    // PTY exists before we type into it.
    setTimeout(() => {
      window.flux.pty.write(seed.ptyId, `claude --session-id ${uuid}\r`)
      window.flux.live.track(uuid)
    }, 150)
  }, [])

  // Keyboard: Ctrl+T new, Ctrl+W close active, Ctrl+Tab next.
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey) return
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); newTab() }
      else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault()
        if (activeTab) {
          if (!window.confirm('Close this tab? Its shell will be terminated.')) return
          closeTab(activeTab.id)
        }
      } else if (e.key === 'Tab') { e.preventDefault(); dispatch({ type: 'NEXT_TAB' }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newTab, closeTab, activeTab])

  return (
    <div className="workspace">
      <LivePanel onLaunch={launchTracked} />
      <TabBar
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        onSelect={selectTab}
        onClose={closeTab}
        onRename={renameTab}
        onNew={newTab}
      />
      <div className="workspace-body">
        {state.tabs.map((t) => (
          <div
            key={t.id}
            className="tab-surface"
            style={{ display: t.id === state.activeTabId ? 'flex' : 'none' }}
          >
            {t.panes.map((p) => (
              <div key={p.id} className="pane-wrap">
                <TerminalPane
                  ptyId={p.ptyId}
                  theme={theme}
                  onFocus={() => dispatch({ type: 'FOCUS_PANE', paneId: p.id })}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: LivePanel.jsx — launch via the injected callback.** The launch button must call `onLaunch` (so the workspace opens a tab) instead of writing the PTY itself. Change the signature + button:
```jsx
export default function LivePanel({ onLaunch }) {
```
In the idle render, change the launch button:
```jsx
        <button className="live-launch" onClick={onLaunch}>
          ▶ Launch tracked claude
        </button>
```
Delete the now-unused `launch`/`ptyId` logic (the `const launch = …` function and the `ptyId` prop from Phase 1 Step 5). Keep `stop` (`window.flux.live.stop()`).

- [ ] **Step 4: App.jsx — swap the terminal slot.** Replace the Phase-1 terminal slot:
```jsx
        <div className="pane-slot" style={{ display: view === 'terminal' ? 'flex' : 'none' }}>
          <LivePanel ptyId={termPtyId} />
          <TerminalPane ptyId={termPtyId} theme={theme} />
        </div>
```
with:
```jsx
        <div className="pane-slot" style={{ display: view === 'terminal' ? 'flex' : 'none' }}>
          <TerminalWorkspace theme={theme} onActivePty={setActivePtyId} />
        </div>
```
Add the import at top: `import TerminalWorkspace from './components/TerminalWorkspace'` and remove the now-unused `LivePanel`/`TerminalPane` imports from App.jsx (they're used inside TerminalWorkspace now). Replace the Phase-1 `const termPtyId = 'main-terminal'` with:
```js
  const [activePtyId, setActivePtyId] = useState(null)
```
Pass `ptyId={activePtyId}` to `<ControlBar … ptyId={activePtyId} />` (replacing `termPtyId`).

- [ ] **Step 5: CSS — append to `src/renderer/src/index.css`**
```css
/* Terminal workspace: tabs */
.workspace { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.workspace-body { flex: 1; min-height: 0; position: relative; }
.tab-surface { position: absolute; inset: 0; display: flex; }
.pane-wrap { flex: 1; min-width: 0; min-height: 0; display: flex; }
.tabbar { display: flex; align-items: stretch; gap: 4px; padding: 4px 6px 0;
  background: var(--bg-panel); border-bottom: 1px solid var(--border); overflow-x: auto; }
.tab-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px;
  background: var(--bg-elev); border: 1px solid var(--border); border-bottom: none;
  border-radius: 7px 7px 0 0; color: var(--text-dim); font-size: 12px; cursor: pointer; max-width: 200px; }
.tab-chip.active { background: var(--bg); color: var(--text); }
.tab-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tab-rename { background: var(--bg); color: var(--text); border: 1px solid var(--accent);
  border-radius: 4px; font-size: 12px; width: 110px; }
.tab-close { background: none; border: none; color: var(--text-faint); cursor: pointer;
  font-size: 14px; line-height: 1; padding: 0 2px; }
.tab-close:hover { color: var(--alert); }
.tab-new { background: none; border: 1px solid var(--border); color: var(--text-dim);
  border-radius: 6px; padding: 0 9px; cursor: pointer; align-self: center; }
.tab-new:hover { color: var(--text); border-color: var(--accent); }
```

- [ ] **Step 6: Verify** — `npm test` (green). `npm run build`. Dev smoke `C:\tmp\flux-e3.png`: the tab bar shows above the terminal with one "PowerShell" tab. Then run `npm run dev` interactively and confirm Ctrl+T opens a second tab (its own shell), Ctrl+Tab cycles, the × closes (with confirm), double-click renames, and "Launch tracked claude" opens a `claude ✦` tab with the live bar tracking it. **Look at the screenshot.**

- [ ] **Step 7: Commit**
```bash
git add src/renderer/src/components/TabBar.jsx src/renderer/src/components/TerminalWorkspace.jsx src/renderer/src/components/LivePanel.jsx src/renderer/src/App.jsx src/renderer/src/index.css
git commit -m "feat(workspace): tabbed terminal workspace + docked live bar (tabs shippable)"
```

---

## Phase 4 — Split panes

### Task 5: split a tab into two panes

**Files:** Modify `src/renderer/src/components/TerminalWorkspace.jsx`, `src/renderer/src/index.css`.

- [ ] **Step 1: TerminalWorkspace — split actions, divider, focus-move, Alt+Arrow.** Add a split callback and a divider, and render the active tab's panes with the split layout. First add `Fragment` to the React import at the top of the file (it's used in the split render below): `import { useReducer, useEffect, useCallback, Fragment } from 'react'`.

Add inside the component, after `launchTracked`:
```js
  const splitActive = useCallback((dir) => {
    if (!activeTab || activeTab.panes.length >= 2) return
    dispatch({ type: 'SPLIT', tabId: activeTab.id, paneId: uid('pane'), ptyId: uid('pty'), profileId: 'powershell', dir })
  }, [activeTab])

  const closePane = useCallback((paneId) => dispatch({ type: 'CLOSE_PANE', paneId }), [])

  const onDividerDrag = useCallback((tabId, e) => {
    const body = e.currentTarget.parentElement
    const horizontal = body.classList.contains('split-v') // 'v' = side-by-side (vertical divider)
    const rect = body.getBoundingClientRect()
    const move = (ev) => {
      const ratio = horizontal
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height
      dispatch({ type: 'SET_RATIO', tabId, ratio: Math.min(0.85, Math.max(0.15, ratio)) })
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [])
```
Extend the Ctrl key handler to add split shortcuts (Ctrl+Shift+E = split vertical/side-by-side, Ctrl+Shift+O = split horizontal/stacked) and Alt+Arrow focus move. Replace the `onKey` body with:
```js
    const onKey = (e) => {
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (activeTab && activeTab.panes.length === 2) {
          e.preventDefault()
          const cur = activeTab.panes.findIndex((p) => p.id === activeTab.activePaneId)
          const other = activeTab.panes[cur === 0 ? 1 : 0]
          dispatch({ type: 'FOCUS_PANE', paneId: other.id })
        }
        return
      }
      if (!e.ctrlKey) return
      if (e.shiftKey && (e.key === 'E' || e.key === 'e')) { e.preventDefault(); splitActive('v') }
      else if (e.shiftKey && (e.key === 'O' || e.key === 'o')) { e.preventDefault(); splitActive('h') }
      else if (e.key === 't' || e.key === 'T') { e.preventDefault(); newTab() }
      else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault()
        if (activeTab) { if (window.confirm('Close this tab? Its shell will be terminated.')) closeTab(activeTab.id) }
      } else if (e.key === 'Tab') { e.preventDefault(); dispatch({ type: 'NEXT_TAB' }) }
    }
```
(Add `splitActive` to that effect's dependency array.)

Replace the tab-surface render (the `state.tabs.map(...)` block) with split-aware layout:
```jsx
        {state.tabs.map((t) => {
          const split = t.panes.length === 2
          const cls = 'tab-surface' + (split ? (t.splitDir === 'v' ? ' split-v' : ' split-h') : '')
          return (
            <div key={t.id} className={cls} style={{ display: t.id === state.activeTabId ? 'flex' : 'none' }}>
              {t.panes.map((p, i) => (
                <Fragment key={p.id}>
                  <div
                    className={'pane-wrap' + (split && p.id === t.activePaneId ? ' focused' : '')}
                    style={split ? { flex: i === 0 ? t.ratio : 1 - t.ratio } : { flex: 1 }}
                  >
                    <TerminalPane
                      ptyId={p.ptyId}
                      theme={theme}
                      onFocus={() => dispatch({ type: 'FOCUS_PANE', paneId: p.id })}
                    />
                    {split && (
                      <button className="pane-close" title="Close pane" onClick={() => closePane(p.id)}>×</button>
                    )}
                  </div>
                  {split && i === 0 && (
                    <div className="pane-divider" onMouseDown={(e) => onDividerDrag(t.id, e)} />
                  )}
                </Fragment>
              ))}
            </div>
          )
        })}
```
Add a split button to the tab bar area — pass `onSplit` to TabBar and render a ⊟ button. In `TabBar.jsx`, add a prop `onSplit` and, after the `+` button, add:
```jsx
      <button className="tab-split" title="Split active tab (Ctrl+Shift+E)" onClick={() => onSplit('v')}>⊟</button>
```
and in TerminalWorkspace pass `onSplit={splitActive}` to `<TabBar … />`.

- [ ] **Step 2: CSS — append**
```css
/* Split panes */
.tab-surface.split-v { flex-direction: row; }
.tab-surface.split-h { flex-direction: column; }
.pane-wrap { position: relative; }
.pane-wrap.focused { outline: 1px solid var(--accent); outline-offset: -1px; }
.pane-divider { flex: 0 0 6px; background: var(--border); cursor: col-resize; }
.tab-surface.split-h .pane-divider { cursor: row-resize; }
.pane-divider:hover { background: var(--accent); }
.pane-close { position: absolute; top: 4px; right: 6px; z-index: 5; background: var(--bg-elev);
  border: 1px solid var(--border); color: var(--text-faint); border-radius: 4px; cursor: pointer;
  font-size: 12px; line-height: 1; padding: 1px 5px; opacity: 0; transition: opacity .12s; }
.pane-wrap:hover .pane-close { opacity: 1; }
.tab-split { background: none; border: 1px solid var(--border); color: var(--text-dim);
  border-radius: 6px; padding: 0 8px; cursor: pointer; align-self: center; }
.tab-split:hover { color: var(--text); border-color: var(--accent); }
```

- [ ] **Step 3: Verify** — `npm test` green; `npm run build`; dev smoke `C:\tmp\flux-e4.png`. Interactively: ⊟ (or Ctrl+Shift+E) splits the active tab side-by-side into two live shells; drag the divider resizes (ratio persists within the session); Alt+Arrow moves the focus outline; the pane × closes one pane and the survivor fills the tab. **Look at the screenshot** — confirm two shells side by side.

- [ ] **Step 4: Commit**
```bash
git add src/renderer/src/components/TerminalWorkspace.jsx src/renderer/src/components/TabBar.jsx src/renderer/src/index.css
git commit -m "feat(workspace): split a tab into two panes (divider, focus-move)"
```

---

## Phase 5 — Profiles + persistence

### Task 6: extend `settings.js` with profiles + workspace layout

**Files:** Modify `src/main/settings.js`; Test `tests/settings-profiles.test.js`.

- [ ] **Step 1: Write the failing test**

```js
// tests/settings-profiles.test.js
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { SettingsStore, DEFAULT_PROFILES } = require('../src/main/settings')

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flux-prof-')), 'settings.json')
}

test('defaults seed PowerShell + claude profiles', () => {
  const s = new SettingsStore(tmpFile())
  const names = s.getProfiles().map((p) => p.name)
  assert.deepStrictEqual(names, DEFAULT_PROFILES.map((p) => p.name))
  assert.ok(s.getProfiles().every((p) => p.id))
})

test('saveProfile adds then updates by id; deleteProfile removes', () => {
  const file = tmpFile()
  const s = new SettingsStore(file)
  const p = s.saveProfile({ name: 'bash', shell: 'bash', args: [], cwd: null })
  assert.ok(p.id)
  const reloaded = new SettingsStore(file)
  assert.ok(reloaded.getProfiles().some((x) => x.id === p.id && x.name === 'bash'))
  reloaded.saveProfile({ ...p, name: 'bash2' })
  assert.ok(new SettingsStore(file).getProfiles().find((x) => x.id === p.id).name === 'bash2')
  reloaded.deleteProfile(p.id)
  assert.ok(!new SettingsStore(file).getProfiles().some((x) => x.id === p.id))
})

test('workspace layout round-trips and tolerates missing/corrupt', () => {
  const file = tmpFile()
  const s = new SettingsStore(file)
  assert.strictEqual(s.getWorkspace(), null) // none yet
  s.setWorkspace({ tabs: [{ profileId: 'powershell', cwd: 'C:\\x' }] })
  assert.deepStrictEqual(new SettingsStore(file).getWorkspace().tabs[0].cwd, 'C:\\x')
})

test('notify settings still work alongside the new keys', () => {
  const file = tmpFile()
  const s = new SettingsStore(file)
  s.setNotify('turnFinished', 'toast')
  s.saveProfile({ name: 'x', shell: 'x' })
  const r = new SettingsStore(file)
  assert.strictEqual(r.get().notify.turnFinished, 'toast')
  assert.ok(r.getProfiles().some((p) => p.name === 'x'))
})
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/settings-profiles.test.js`.

- [ ] **Step 3: Extend `src/main/settings.js`.** Add the profile defaults and methods without disturbing the notify logic.

Add after the existing `DEFAULTS` constant:
```js
const DEFAULT_PROFILES = [
  { id: 'powershell', name: 'PowerShell (here)', shell: null, args: [], cwd: null },
  { id: 'claude', name: 'claude (tracked)', shell: null, args: [], cwd: null, tracked: true }
]
```
Extend `DEFAULTS` to include the new keys (so a fresh store has them):
```js
const DEFAULTS = {
  version: 1,
  notify: {
    turnFinished: 'badge',
    turnError: 'toast',
    blocked: 'toast',
    usageThreshold: 'toast',
    sound: false
  },
  profiles: DEFAULT_PROFILES,
  workspace: null
}
```
In `_load()`, after the notify merge, also merge profiles + workspace (inside the same `try`, after the `notify` handling):
```js
      if (Array.isArray(parsed.profiles)) this.data.profiles = parsed.profiles
      if (parsed.workspace && typeof parsed.workspace === 'object') this.data.workspace = parsed.workspace
```
Add methods to the class (after `setNotify`):
```js
  getProfiles() {
    return clone(this.data.profiles)
  }

  saveProfile(profile) {
    const list = this.data.profiles
    const id = profile.id || 'pf-' + Math.random().toString(36).slice(2, 9)
    const next = { ...profile, id }
    const idx = list.findIndex((p) => p.id === id)
    if (idx === -1) list.push(next)
    else list[idx] = next
    this._save()
    return clone(next)
  }

  deleteProfile(id) {
    this.data.profiles = this.data.profiles.filter((p) => p.id !== id)
    this._save()
  }

  getWorkspace() {
    return this.data.workspace ? clone(this.data.workspace) : null
  }

  setWorkspace(layout) {
    this.data.workspace = layout
    this._save()
  }
```
Update the exports line:
```js
module.exports = { SettingsStore, DEFAULTS, MODES, EVENT_KEYS, DEFAULT_PROFILES }
```

> The `saveProfile` id uses `Math.random()` — that's fine in the MAIN process (the `Math.random` ban applies only to workflow scripts, not app code).

- [ ] **Step 4: Run to verify pass** — `node --test tests/settings-profiles.test.js tests/settings.test.js` (new + original both green).

- [ ] **Step 5: Commit**
```bash
git add src/main/settings.js tests/settings-profiles.test.js
git commit -m "feat(settings): profiles + persisted workspace layout (TDD)"
```

### Task 7: preload + IPC + workspace persistence/restore + profile dropdown

**Files:** Modify `src/main/index.js`, `src/preload/index.js`, `src/renderer/src/components/TerminalWorkspace.jsx`, `src/renderer/src/components/TabBar.jsx`.

- [ ] **Step 1: index.js IPC** — add handlers next to the existing settings handlers:
```js
ipcMain.handle('settings:profiles', () => (settingsStore ? settingsStore.getProfiles() : []))
ipcMain.handle('settings:saveProfile', (_e, p) => {
  try { return { ok: true, profile: settingsStore.saveProfile(p) } } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('settings:deleteProfile', (_e, id) => {
  try { settingsStore.deleteProfile(id); return { ok: true } } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('settings:getWorkspace', () => (settingsStore ? settingsStore.getWorkspace() : null))
ipcMain.on('settings:setWorkspace', (_e, layout) => { if (settingsStore) settingsStore.setWorkspace(layout) })
```

- [ ] **Step 2: preload** — extend the `settings` bridge:
```js
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setNotify: (key, value) => ipcRenderer.invoke('settings:setNotify', { key, value }),
    profiles: () => ipcRenderer.invoke('settings:profiles'),
    saveProfile: (p) => ipcRenderer.invoke('settings:saveProfile', p),
    deleteProfile: (id) => ipcRenderer.invoke('settings:deleteProfile', id),
    getWorkspace: () => ipcRenderer.invoke('settings:getWorkspace'),
    setWorkspace: (layout) => ipcRenderer.send('settings:setWorkspace', layout)
  },
```

- [ ] **Step 3: TerminalWorkspace — load profiles, restore layout, persist, profile-aware new-tab.** Add state + effects.

Add near the top of the component:
```js
  const [profiles, setProfiles] = useState([])
  useEffect(() => { window.flux.settings.profiles().then(setProfiles) }, [])
```
(Add `import { useState } from 'react'` to the existing React import.)

Replace `freshSeed()` usage in the initial reducer with a restore-aware initializer. Replace the `useReducer` line with:
```js
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(freshSeed()))
  // Restore saved tabs (as fresh shells) once, on mount.
  useEffect(() => {
    window.flux.settings.getWorkspace().then((saved) => {
      if (!saved || !Array.isArray(saved.tabs) || saved.tabs.length === 0) return
      // Rebuild: first saved tab replaces the default, the rest are added.
      saved.tabs.forEach((t, i) => {
        const seed = { tabId: uid('t'), paneId: uid('pane'), ptyId: uid('pty'), profileId: t.profileId || 'powershell', title: t.title || 'PowerShell' }
        if (i === 0) dispatch({ type: 'CLOSE_TAB', tabId: stateRef.current.activeTabId })
        dispatch({ type: 'NEW_TAB', ...seed })
      })
    })
  }, [])
```
This needs a ref to the latest state for the close-then-add. Add:
```js
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])
```
(Add `useRef` to the React import.)

Persist on layout change (debounced via a short timeout):
```js
  useEffect(() => {
    const id = setTimeout(() => {
      window.flux.settings.setWorkspace({
        tabs: state.tabs.map((t) => ({ profileId: t.panes[0].profileId, title: t.title }))
      })
    }, 400)
    return () => clearTimeout(id)
  }, [state.tabs])
```

Make new-tab profile-aware. Replace `newTab` and add a profile launcher:
```js
  const profileById = useCallback((id) => profiles.find((p) => p.id === id) || profiles[0] || { id: 'powershell', name: 'PowerShell' }, [profiles])

  const openProfile = useCallback((profileId) => {
    const prof = profileById(profileId)
    if (prof && prof.tracked) { launchTracked(); return }
    const seed = { tabId: uid('t'), paneId: uid('pane'), ptyId: uid('pty'), profileId: prof.id, title: prof.name }
    dispatch({ type: 'NEW_TAB', ...seed })
    // spawn with the profile's shell/cwd by letting TerminalPane read them — pass via a pending map.
    pendingSpawn.current[seed.ptyId] = { cwd: prof.cwd || null, shell: prof.shell || null }
  }, [profileById, launchTracked])

  const newTab = useCallback(() => openProfile((profiles[0] && profiles[0].id) || 'powershell'), [openProfile, profiles])
```
Add a `pendingSpawn` ref and thread cwd/shell into TerminalPane. Add near the top:
```js
  const pendingSpawn = useRef({})
```
And pass to TerminalPane in the render (both Phase 3 and Phase 4 render sites):
```jsx
                <TerminalPane
                  ptyId={p.ptyId}
                  theme={theme}
                  cwd={(pendingSpawn.current[p.ptyId] || {}).cwd}
                  shell={(pendingSpawn.current[p.ptyId] || {}).shell}
                  onFocus={() => dispatch({ type: 'FOCUS_PANE', paneId: p.id })}
                />
```

- [ ] **Step 4: TabBar — profile dropdown on the +.** Accept a `profiles` prop and an `onNewProfile(id)` callback. Replace the `+` button with a split button + dropdown:
```jsx
      <div className="tab-new-wrap">
        <button className="tab-new" title="New tab (Ctrl+T)" onClick={onNew}>+</button>
        {profiles && profiles.length > 1 && (
          <select
            className="tab-profile-select"
            value=""
            onChange={(e) => { if (e.target.value) onNewProfile(e.target.value) }}
            title="New tab from profile"
          >
            <option value="">▾</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>
```
Pass `profiles={profiles}` and `onNewProfile={openProfile}` from TerminalWorkspace to `<TabBar … />`.

- [ ] **Step 5: CSS — append**
```css
.tab-new-wrap { display: inline-flex; align-items: center; gap: 2px; align-self: center; }
.tab-profile-select { background: var(--bg-elev); color: var(--text-dim); border: 1px solid var(--border);
  border-radius: 6px; font-size: 11px; padding: 1px 2px; cursor: pointer; }
```

- [ ] **Step 6: Verify** — `npm test` green; `npm run build`; dev smoke `C:\tmp\flux-e5.png`. Interactively: the + dropdown lists "PowerShell (here)" and "claude (tracked)"; picking claude opens a tracked tab; close the app and reopen (`npm run dev`) — your tabs reopen as fresh shells. **Look at the screenshot.**

- [ ] **Step 7: Commit**
```bash
git add src/main/index.js src/preload/index.js src/renderer/src/components/TerminalWorkspace.jsx src/renderer/src/components/TabBar.jsx src/renderer/src/index.css
git commit -m "feat(workspace): launch profiles + persist/restore tab layout"
```

---

## Phase 6 — Scrollback search

### Task 8: per-pane Ctrl+F search

**Files:** Modify `package.json` (dep), `src/renderer/src/components/TerminalPane.jsx`, `src/renderer/src/index.css`.

- [ ] **Step 1: Add the dependency**

Run: `npm install @xterm/addon-search`
Expected: it resolves a version compatible with `@xterm/xterm@^6` and adds it to `package.json` dependencies. Verify it imports in the next step's build.

- [ ] **Step 2: TerminalPane — load SearchAddon + a Ctrl+F overlay.** Modify `TerminalPane.jsx`: import the addon, keep a ref to it and to the term, add overlay state, and render a small search box.

Add imports:
```jsx
import { useEffect, useRef, useState } from 'react'
import { SearchAddon } from '@xterm/addon-search'
```
Inside the component, add refs/state and capture the term + addon:
```js
  const termRef = useRef(null)
  const searchRef = useRef(null)
  const [search, setSearch] = useState(null) // null = closed; '' or string = open with query
```
In the effect, after `term.loadAddon(fit)`, also:
```js
    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)
    termRef.current = term
    searchRef.current = searchAddon
```
And in cleanup, clear the refs (before `term.dispose()`):
```js
      termRef.current = null
      searchRef.current = null
```
Add a Ctrl+F handler (only when this pane is the focused/active one — keep it simple: the overlay opens on Ctrl+F while the mouse/keyboard is in this pane's host). Add a second effect:
```js
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onKey = (e) => {
      if (e.ctrlKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        e.stopPropagation()
        setSearch((s) => (s === null ? '' : null))
      }
    }
    host.addEventListener('keydown', onKey)
    return () => host.removeEventListener('keydown', onKey)
  }, [])
```
Render the overlay alongside the host (replace the single `return`):
```jsx
  return (
    <div className="terminal-host-wrap">
      {search !== null && (
        <div className="pane-search">
          <input
            autoFocus
            className="pane-search-input"
            placeholder="search scrollback…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); searchRef.current && searchRef.current.findNext(e.target.value, { incremental: true }) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') searchRef.current && (e.shiftKey ? searchRef.current.findPrevious(search) : searchRef.current.findNext(search))
              if (e.key === 'Escape') { setSearch(null); termRef.current && termRef.current.focus() }
            }}
          />
          <button className="pane-search-btn" onClick={() => searchRef.current && searchRef.current.findPrevious(search)} title="Previous (Shift+Enter)">↑</button>
          <button className="pane-search-btn" onClick={() => searchRef.current && searchRef.current.findNext(search)} title="Next (Enter)">↓</button>
          <button className="pane-search-btn" onClick={() => { setSearch(null); termRef.current && termRef.current.focus() }} title="Close (Esc)">×</button>
        </div>
      )}
      <div className="terminal-host" ref={hostRef} onMouseDown={onFocus} />
    </div>
  )
```

- [ ] **Step 3: CSS — append**
```css
.terminal-host-wrap { position: relative; flex: 1; min-width: 0; min-height: 0; display: flex; }
.pane-search { position: absolute; top: 6px; right: 6px; z-index: 8; display: flex; gap: 4px;
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: 8px; padding: 4px 6px;
  box-shadow: 0 6px 20px rgba(0,0,0,.4); }
.pane-search-input { background: var(--bg); color: var(--text); border: 1px solid var(--border);
  border-radius: 5px; font-size: 12px; padding: 2px 6px; width: 180px; }
.pane-search-btn { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 13px; padding: 0 4px; }
.pane-search-btn:hover { color: var(--text); }
```

> Note: `TerminalPane` now renders `.terminal-host-wrap` (not the bare `.terminal-host`). The `.pane-wrap` in TerminalWorkspace already provides flex sizing; `.terminal-host-wrap` fills it. Confirm the terminal still fits (the fit addon observes `.terminal-host`, unchanged).

- [ ] **Step 4: Verify** — `npm test` (green); `npm run build`; dev smoke `C:\tmp\flux-e6.png`. Interactively: focus a pane, run a command that prints a lot, press Ctrl+F, type a term → matches highlight, Enter/Shift+Enter cycle, Esc closes and refocuses the terminal. Confirm Ctrl+Shift+F still opens the cross-session search (not the pane search). **Look at the screenshot.**

- [ ] **Step 5: Commit**
```bash
git add package.json package-lock.json src/renderer/src/components/TerminalPane.jsx src/renderer/src/index.css
git commit -m "feat(workspace): per-pane scrollback search (@xterm/addon-search, Ctrl+F)"
```

---

## Phase 7 — Verification & docs

### Task 9: smoke harness branch, full verification, docs

**Files:** Modify `src/main/index.js` (smoke branch — optional), `docs/superpowers/specs/2026-06-10-terminal-qol-design.md`, `README.md`.

- [ ] **Step 1: Full suite** — `npm test`. Confirm green and report counts (existing + ptymanager + workspace + settings-profiles). If anything fails, STOP and report.

- [ ] **Step 2: `npm run smoke`** — confirm node-pty still works under plain Node (`npm run smoke` prints a PTY round-trip OK). The id-keyed rework must not have broken the native bridge.

- [ ] **Step 3: Full interactive pass** (PowerShell, `npm run dev`): open 3 tabs, split one, run `claude (tracked)` in a tab and confirm the docked live bar tracks it, drag a divider, Ctrl+F in a pane, close tabs/panes (confirm no orphan `conhost.exe` via Task Manager after closing), quit and relaunch (tabs restored as fresh shells). Capture a final screenshot `C:\tmp\flux-e-final.png` and look at it.

- [ ] **Step 4: Update spec status + README.** In `docs/superpowers/specs/2026-06-10-terminal-qol-design.md` change the `**Status:**` line to `implemented 2026-06-10 (see docs/superpowers/plans/2026-06-10-terminal-qol.md)`. In `README.md`, add a roadmap bullet:
```md
- [x] **Terminal QoL (Milestone E):** tabbed terminal with a two-pane split, saved
      launch profiles (+ restore on relaunch), and per-pane scrollback search (Ctrl+F);
      the tracked-`claude` live bar stays docked above the tabs.
```
And remove "Tabs / split / profiles" style entries from "Possible next steps" if present.

- [ ] **Step 5: Commit**
```bash
git add docs/superpowers/specs/2026-06-10-terminal-qol-design.md README.md src/main/index.js
git commit -m "docs: mark Milestone E implemented; README roadmap"
```

---

## Self-review notes (author)

- **Spec coverage:** Tabs (Task 4) ✓; Split-once with focus + divider (Task 5) ✓; Profiles incl. seeded PowerShell + claude-tracked, + dropdown, persistence/restore (Tasks 6-7) ✓; Scrollback search via `@xterm/addon-search` (Task 8) ✓; PTY lifecycle/no-orphans (Task 1 kill/killAll + Task 9 manual check) ✓; pure reducer tested for every transition incl. closing the focused pane of a split (Task 3) ✓.
- **As-landed adaptation:** the single→multi PTY rework (Tasks 1-2) is the prerequisite the spec mis-stated; the docked live bar (Task 4 `launchTracked`) and restore-as-fresh-shells (Task 7) match James's decisions.
- **Placeholders:** none — every code step has full code.
- **Type/name consistency:** preload `pty` API (`write(id,data)`, `resize(id,size)`, `kill(id)`, `onData→{id,data}`) is used identically in TerminalPane/LivePanel/ControlBar; reducer action shapes in Task 3 match the dispatches in Tasks 4-7 (`NEW_TAB`/`CLOSE_TAB`/`SPLIT`/`CLOSE_PANE`/`FOCUS_PANE`/`FOCUS_TAB`/`NEXT_TAB`/`SET_RATIO`/`RENAME_TAB`); settings methods (`getProfiles`/`saveProfile`/`deleteProfile`/`getWorkspace`/`setWorkspace`) match preload + IPC + callers.
- **Known caveats:** (1) The split render uses `<Fragment key={p.id}>` (Task 5 imports `Fragment`) so the keyed-list rule is satisfied. (2) `pendingSpawn` cwd/shell is read at pane mount; since the profile's cwd is fixed at open time this is sufficient (no reactivity needed). (3) restore replays NEW_TAB actions; the close-default-then-add keeps it simple over a dedicated REPLACE action.
