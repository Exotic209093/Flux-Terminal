# Flux Terminal

A vivid desktop terminal for **living and reliving your Claude Code sessions**.

It is a real, fully-capable terminal (you can run `claude`, PowerShell, git — anything
you do today) wrapped in a rich layer that makes your Claude Code sessions beautiful and
explorable: live dashboards, theming, a scrubable session timeline, and cross-session stats.

Built with **Electron + xterm.js + node-pty** (a true ConPTY-backed pseudo-terminal) and a
**React** UI.

---

## Where the files live (important)

The real project lives at:

```
C:\Users\james\Projects\Flux Terminal
```

**not** under OneDrive. There is a shortcut at
`OneDrive\Documents\My Projects\Flux Terminal.lnk` so you can still open it from there.

Why: OneDrive cannot hold an Electron project. It dereferences `node_modules` junctions
into real folders and its sync filter corrupts Electron's ~140 MB binary extraction. Keep
the source here and back it up with git/GitHub instead.

---

## Quick start

```powershell
npm install          # installs deps; postinstall repairs Electron's binary (see below)
npm run dev          # launch Flux Terminal with hot reload
```

Other scripts:

| script | what it does |
| --- | --- |
| `npm run dev` | run the app in development (HMR) |
| `npm run build` | bundle main + preload + renderer into `out/` |
| `npm run preview` | run the built app |
| `npm test` | run unit tests (Node built-in test runner) |
| `npm run smoke` | verify `node-pty` works under plain Node |
| `npm run smoke:electron` | verify `node-pty` works under Electron's ABI |
| `npm run fix-electron` | re-extract Electron's binary if it goes missing |

### Known environment quirk: Electron's `extract-zip`

On this toolchain (Node 24 + Electron 42 on Windows) Electron's own postinstall uses
`extract-zip`, which silently stalls after the first zip entry and leaves
`node_modules/electron/dist` without `electron.exe`. Our `postinstall`
(`scripts/ensure-electron.cjs`) detects this and re-extracts the cached artifact with a
reliable extractor. If you ever see "electron.exe missing", run `npm run fix-electron`.

`node-pty` itself needs **no** native rebuild — v1.1+ ships N-API prebuilds that are
ABI-stable across Node and Electron.

---

## Architecture

```
src/
  main/        Electron main process (Node)
    index.js   window + IPC + PTY bridge
    pty.js     node-pty spawn helper (ConPTY on Windows)
  preload/
    index.js   contextBridge → window.flux  (safe IPC surface)
  renderer/    React app (the UI)
    src/
      App.jsx  the terminal pane (xterm.js)
scripts/
  ensure-electron.cjs  Electron binary repair (postinstall)
  smoke-pty.cjs        node-pty ABI smoke test
  smoke-window.cjs     full-window screenshot smoke test
```

---

## Roadmap

- [x] **Milestone 0 — De-risk:** real PTY in an Electron/xterm window; `claude` runs in it.
- [x] **Milestone 1 — Vertical slice:** terminal pane + sidebar listing real `~/.claude`
      sessions, with a defensive JSONL parser (tolerant of half-written lines & unknown
      event types). Verified: 70 sessions, 21,420 msgs, 0 parse errors.
- [x] **Milestone 2 — The four pillars:**
  - [x] Themes & visual effects (5 presets, live switching, glow/gradient effects)
  - [x] Live dashboards (tokens / cost / tools, real per-model pricing incl. cache tokens)
  - [x] Session timeline & replay
  - [x] Cross-session stats & gamification (activity chart, achievements, streaks)

- [x] **Live session tracking:** a `▶ Launch tracked claude` action runs
      `claude --session-id <uuid>` in the terminal and follows *exactly* that session
      live — tokens, cost, cache %, tools, message count update as you work (incremental
      byte-offset tail; exact session-id correlation, no heuristic guessing).

- [x] **Interactive sessions:** open a session and **send messages right in that window** —
      it resumes that exact session (`claude --resume <id> -p`, prompt via stdin) and the
      reply streams back into the timeline (file watcher re-parses on change). Auto-scrolls
      to the bottom unless you scroll up, with a **↓ jump-to-latest** button. A **context-window
      gauge** at the top shows how full the model's context is (e.g. 56% · 538K / 1M).

- [x] **Skills section:** a Skills tab listing your local skills (`~/.claude/skills`), plugin
      skills, and **starter skills bundled with Flux** (`skills/`) you can install into
      `~/.claude/skills` with one click. (Resume also now runs from a session's *creation*
      cwd, so messaging works even if the session changed directories.)

- [x] **Plan usage:** live 5-hour and weekly limit gauges (the same data as `/usage`)
      in the topbar and at the top of every session, with reset countdowns.

- [x] **Slash commands:** `/`-triggered autocomplete in the session composer
      (builtins + your custom `~/.claude/commands` + project commands).

- [x] **Images:** session images render inline with a click-to-zoom lightbox;
      paste or attach an image in the composer to send it.

- [x] **Session Workspace v2:** start new chats in the rich UI (folder + model
      selection), a topbar model switcher, interrupt a running turn, the full
      slash-command set (terminal-only ones marked), subagent sub-views with
      drill-in timelines, and a topbar control cluster (model · running-agents ·
      remote-control toggle).

- [x] **Watcher + notifications (Milestone A):** auto-detect any active `claude` session
      (started anywhere) and signal turn-finished / error / blocked / usage-limit via OS
      toast or quiet taskbar badge — configurable per-event via the ⚙ topbar popover.

- [x] **Mission Control (Milestone B):** an all-sessions grid (topbar 🛰 tab or `Ctrl+M`)
      grouping every recent session into **Needs you** / **Running** / **Idle** with live
      cost, model, subagent count, and last-reply snippet; click a card to open it.

- [x] **Terminal QoL (Milestone E):** tabbed terminal with a two-pane split, saved launch
      profiles (restored as fresh shells on relaunch), and per-pane scrollback search
      (Ctrl+F); the tracked-`claude` live bar stays docked above the tabs.

### Possible next steps
- Timeline scrubber / playback controls; collapse long thinking blocks
- Syntax-highlight code in the replay
- Package installers (`electron-builder`) for a double-click app
