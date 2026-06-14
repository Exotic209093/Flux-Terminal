# Windows Shell Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Jump List, taskbar progress (running turn), and a thumbnail-toolbar Interrupt — Windows-only, reusing existing IPC.

**Architecture:** New `src/main/winshell.js` (pure `progressForState` + guarded Electron-API installers); a `flux://new` deep-link route; wiring in `index.js`/`App.jsx`.

**Tech Stack:** Electron Windows taskbar APIs, node:test.

**Spec:** `docs/superpowers/specs/2026-06-14-windows-shell-design.md`

**Test command:** `npm test`. Build: `npm run build`. `winshell.js`/`deeplink.js` are CommonJS (require() in tests). New main module → rollup input. All taskbar calls guard `process.platform === 'win32'`.

---

## Task 1: winshell.js + flux://new route

**Files:**
- Create: `src/main/winshell.js`, `tests/winshell.test.js`
- Modify: `src/main/deeplink.js`, `tests/deeplink.test.js`, `electron.vite.config.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/winshell.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const { progressForState } = require('../src/main/winshell')

test('progressForState: running turn -> indeterminate; else cleared', () => {
  assert.deepStrictEqual(progressForState({ state: 'running' }), { value: 2, mode: 'indeterminate' })
  assert.deepStrictEqual(progressForState({ state: 'idle' }), { value: -1, mode: 'none' })
  assert.deepStrictEqual(progressForState(null), { value: -1, mode: 'none' })
})
```

Add to `tests/deeplink.test.js`:

```js
test('parses flux://new', () => {
  assert.deepStrictEqual(parseDeepLink('flux://new'), { route: 'new' })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/winshell.test.js tests/deeplink.test.js`
Expected: winshell FAIL (module not found); deeplink FAIL (flux://new → null).

- [ ] **Step 3: deeplink.js — add the `new` route**

In `src/main/deeplink.js` `parseDeepLink`, before the final `return null`, add: `if (host === 'new') return { route: 'new' }`.

- [ ] **Step 4: Implement winshell.js**

Create `src/main/winshell.js`:

```js
// Windows taskbar surfaces (Jump List, progress, thumbnail toolbar). All calls
// guard win32 so they no-op elsewhere. Reuses existing interrupt/live plumbing.
const WIN = process.platform === 'win32'

// A small stop/interrupt glyph (pink square) as a tray-sized nativeImage source.
const INTERRUPT_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVR4nGNgGAWjYBSMglEwCkbBKBgFo4CWAAAH0AABz0p9pQAAAABJRU5ErkJggg=='

function progressForState(snapshot) {
  if (snapshot && snapshot.state === 'running') return { value: 2, mode: 'indeterminate' }
  return { value: -1, mode: 'none' }
}

function applyProgress(win, snapshot) {
  if (!WIN || !win || (win.isDestroyed && win.isDestroyed())) return
  const { value, mode } = progressForState(snapshot)
  try {
    win.setProgressBar(value, { mode })
  } catch {
    /* unsupported */
  }
}

function installJumpList(app, execPath) {
  if (!WIN) return
  try {
    app.setUserTasks([
      { program: execPath, arguments: 'flux://mission', title: 'Mission Control', description: 'Open Mission Control', iconPath: execPath, iconIndex: 0 },
      { program: execPath, arguments: 'flux://new', title: 'New chat', description: 'Start a new chat', iconPath: execPath, iconIndex: 0 }
    ])
  } catch {
    /* ignore */
  }
}

function installThumbar(win, { nativeImage, onInterrupt } = {}) {
  if (!WIN || !win || !nativeImage) return { update() {} }
  let btn
  try {
    btn = { tooltip: 'Interrupt claude', icon: nativeImage.createFromDataURL(INTERRUPT_ICON), click: () => onInterrupt && onInterrupt() }
  } catch {
    return { update() {} }
  }
  const update = (running) => {
    try {
      win.setThumbarButtons(running ? [btn] : [])
    } catch {
      /* ignore */
    }
  }
  update(false)
  return { update }
}

module.exports = { progressForState, applyProgress, installJumpList, installThumbar, INTERRUPT_ICON }
```

- [ ] **Step 5: Rollup input**

In `electron.vite.config.mjs`, add to `rollupOptions.input` (after `shellio`):

```js
          winshell: resolve('src/main/winshell.js'),
```

- [ ] **Step 6: Run tests + commit**

Run: `node --test tests/winshell.test.js tests/deeplink.test.js`
Expected: PASS.

```bash
git add src/main/winshell.js tests/winshell.test.js src/main/deeplink.js tests/deeplink.test.js electron.vite.config.mjs
git commit -m "feat(winshell): jump list / progress / thumbar helpers + flux://new route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Wire into the app

**Files:**
- Modify: `src/main/index.js`, `src/renderer/src/App.jsx`

- [ ] **Step 1: index.js — install + drive from live**

In `src/main/index.js`:
- Require: `const { installJumpList, installThumbar, applyProgress } = require('./winshell')`.
- Add a module-level `let thumbar = null`.
- In `whenReady`, after the tray is created:

```js
  installJumpList(app, process.execPath)
  thumbar = installThumbar(mainWindow, { nativeImage, onInterrupt: () => { if (claudeRunner) claudeRunner.interrupt() } })
```

- In the `LiveTracker` callback (the `new LiveTracker((snapshot) => { ... })`), after sending `live:update`, add:

```js
      applyProgress(mainWindow, snapshot)
      if (thumbar) thumbar.update(!!(snapshot && snapshot.state === 'running'))
```

- [ ] **Step 2: App.jsx — handle the `new` route**

In `src/renderer/src/App.jsx`, in the deep-link `onOpen` handler (added in #8), add a branch: `else if (route.route === 'new') startNewChat()`.

- [ ] **Step 3: Build + full suite + commit**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3 && npm test 2>&1 | tail -5`
Expected: build succeeds (out/main/winshell.js emitted); all tests pass (324 prior + 1 winshell + 1 deeplink-new = 326).

```bash
git add src/main/index.js src/renderer/src/App.jsx
git commit -m "feat(winshell): jump list + taskbar progress + thumbar Interrupt wired to live

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** winshell helpers + jump list + thumbar + progress → Task 1; `flux://new` route → Task 1; wiring + live-driven progress/thumbar + App route → Task 2. Recent-sessions jump list + macOS dock deferred (out of scope per spec).

**Placeholder scan:** winshell.js + tests have full code; index.js/App edits are exact with anchors (LiveTracker callback, deep-link onOpen handler from #8).

**Type/name consistency:** `progressForState`/`applyProgress`/`installJumpList`/`installThumbar` exported + used in index.js; `thumbar.update(running)` matches the returned object; `flux://new` → `{route:'new'}` handled in App; `nativeImage` already imported in index.js.

**Notes for executor:** Task 2 depends on Task 1. Commit after each. `progressForState` + the deeplink route are unit-tested; the Electron taskbar APIs are build-verified (Windows-only at runtime). No push/tag.
```
