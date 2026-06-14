# Windows Shell Integration — design

**Date:** 2026-06-14
**Sub-project:** #12 of the power-user program (S).
**Goal:** Native Windows taskbar surfaces — a Jump List, taskbar progress reflecting live activity, and a thumbnail-toolbar Interrupt button. All reuse existing IPC; no-ops on non-Windows.
**Status:** approved (autonomous run).

## Decisions

- **Jump List** (`app.setUserTasks`): a couple of tasks that relaunch Flux with a `flux://` arg the existing deep-link cold-start router (#8) already handles — **Mission Control** (`flux://mission`) and **New chat** (`flux://new`, a new route). Tasks launch `process.execPath` with the URL as the argument.
- **Taskbar progress** (`win.setProgressBar`): reflect the tracked claude session — **indeterminate while a turn is running**, cleared otherwise. Driven from the existing `LiveTracker` snapshot in main. A pure `progressForState(snapshot)` decides the value/mode.
- **Thumbnail toolbar** (`win.setThumbarButtons`): an **Interrupt** button (visible on the taskbar thumbnail) that calls the existing `claudeRunner.interrupt()`. Icon is a generated nativeImage (data URL), like the overlay badge.
- All three are Windows-only; the calls are guarded (`process.platform === 'win32'`) so they no-op elsewhere.

## Changes

### New `src/main/winshell.js`
- `progressForState(snapshot)` → `{ value, mode }` (pure): running turn → `{ value: 2, mode: 'indeterminate' }`; else → `{ value: -1, mode: 'none' }`. Unit-tested.
- `installJumpList(app, execPath)` → `app.setUserTasks([...])` with the Mission Control + New chat tasks (guarded to win32).
- `installThumbar(win, { nativeImage, iconDataUrl, onInterrupt })` → registers a single Interrupt thumbar button; exposes an `update(running)` to show/hide it (empty array when nothing runs).
- `applyProgress(win, snapshot)` → `win.setProgressBar(value, { mode })` from `progressForState`.

### `src/main/deeplink.js`
- Add a `new` route: `flux://new` → `{ route: 'new' }`.

### `src/main/index.js`
- `whenReady`: `installJumpList(app, process.execPath)`; `installThumbar(mainWindow, { nativeImage, iconDataUrl, onInterrupt: () => claudeRunner && claudeRunner.interrupt() })`.
- In the `LiveTracker` callback (already receives each snapshot): `applyProgress(mainWindow, snapshot)` and `thumbar.update(snapshot && snapshot.state === 'running' ...)`.
- Rollup input: `winshell`.

### `src/renderer/src/App.jsx`
- Handle the `new` deep-link route → `startNewChat()`.

## Verification

- Unit: `progressForState` (running vs idle); `parseDeepLink('flux://new')`.
- Build: `npm run build` (out/main/winshell.js emitted).
- Manual (Windows): Jump List shows the tasks (right-click taskbar icon); a running tracked turn shows taskbar progress; the thumbnail Interrupt stops it.

## Out of scope

Recent-sessions in the Jump List (needs per-session deep links + dynamic list rebuild) — could be a follow-up. macOS dock equivalents (v1.1).

## Files

- New: `src/main/winshell.js`, `tests/winshell.test.js`.
- Edited: `src/main/index.js`, `src/main/deeplink.js`, `src/renderer/src/App.jsx`, `electron.vite.config.mjs`, plus extend `tests/deeplink.test.js` for the `new` route.
