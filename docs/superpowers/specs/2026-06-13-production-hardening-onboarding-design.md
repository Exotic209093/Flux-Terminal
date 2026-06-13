# Production Hardening + Onboarding — design

**Date:** 2026-06-13
**Sub-project:** #1 of the power-user program (`2026-06-13-power-user-program.md`).
**Goal:** make Flux safe to hand to all users — no double-instance corruption, no blank-window crashes, a real first-run experience, the two foundation residuals closed, and the repo hygiene that blocks an OSS release.
**Distribution context:** internal team first, then unsigned public OSS download. Windows-first.
**Status:** design approved 2026-06-13 (two-tier error boundary + log-and-keep-running crash policy confirmed).

## Scope

Four groups: a main-process safety net, a guided first-run experience, two foundation residuals, and repo hygiene. Each is independently testable.

## 1. Safety net (main process)

### Single-instance lock
- `app.requestSingleInstanceLock()` at startup, before `whenReady`. If it returns false, `app.quit()` and stop.
- `app.on('second-instance', (_e, argv) => { restore + focus mainWindow })`. Written to accept `argv` now so sub-project #8 (`flux://` deep links) can route the URL from it without rework.
- Rationale: a double-launch today opens two windows both watching `~/.claude` and both contending for the GPU disk-cache lock (the documented black-frame bug). Also the hard prerequisite for deep links.

### Crash log — `src/main/crashlog.js`
- Installs `process.on('uncaughtException')`, `process.on('unhandledRejection')`, `app.on('render-process-gone')`, `app.on('child-process-gone')`.
- Appends structured lines (ISO ts, kind, message, stack) to `userData/logs/main.log`. Size-based rotation: when the file exceeds ~1 MB, rename to `main.1.log`, keep the last 3. Logging is best-effort and must never throw.
- **Policy on uncaught main exception:** log → `dialog.showErrorBox('Flux hit an unexpected error', message)` → keep running. Not force-quit (loses the user's live terminals), not relaunch (overkill for v0.1). Most uncaught throws in main are already-wrapped IPC edge cases.
- `crashlog.install()` called first thing in `whenReady` (and the renderer-error IPC registered alongside).

### React error boundary — two tiers
- New `src/renderer/src/components/ErrorBoundary.jsx` (class component, `getDerivedStateFromError` + `componentDidCatch`).
- **App-level:** wraps the entire provider tree in `main.jsx` (around `<SettingsProvider>…`). Fallback: a full panel — "Flux hit a problem", a **Reload** button (`location.reload()`), and a collapsible stack for power users.
- **Content-level:** a second boundary around the main content view (the session/timeline area in `App`). Fallback: an inline "This view failed to render — reload" so a transcript-render bug (likely once #4 adds rich rendering) degrades gracefully instead of white-screening the app.
- `componentDidCatch` forwards `{ message, stack, componentStack }` to main via a new `app:rendererError` IPC → written to the same crash log.

## 2. Guided first-run

### `src/main/environment.js` + `env:doctor` IPC
Returns `{ cli: { found, version, path }, loggedIn, sessionCount }`:
- **cli**: `resolveClaudeBin()` (reused from resume.js) then `execFile(bin, ['--version'])` for the version; `found:false` if resolution/version fails. Injectable `execFile`/`fs` for tests.
- **loggedIn**: `~/.claude/.credentials.json` exists and parses with a truthy `claudeAiOauth.accessToken`. No network call.
- **sessionCount**: `sessionIndex.list(1).length` (passed in, so the module stays testable).

### `WelcomeScreen` overlay (renderer)
- New `src/renderer/src/components/WelcomeScreen.jsx`, rendered above the view router in `App` when first-run and not dismissed (so routing is untouched).
- Calls `env:doctor` on mount; shows three rows with ✓/⚠: claude CLI (+ version), logged in, sessions found.
- Actions: **Launch your first claude session** (reuses the existing tracked-claude launch path), **Browse a folder to start in** (`dialog:pickFolder` → start there), **Get started** (dismiss).
- Dismiss writes `onboarding.dismissed = true` (+ `onboarding.version`) through `settings:set`.

### First-run state — settings.js
- Extend `DEFAULTS` with `onboarding: { dismissed: false, version: 1 }`; bump store `version` to 3.
- `_load` merges the `onboarding` object (booleans/number validated); `setByPath` routes `onboarding.*`.
- Chosen over a sentinel file / localStorage because settings.json is already the synchronous, no-flash source of truth read in `main.jsx` before first paint.

### Always-on honesty (not just first run)
- **CLI-missing banner:** a slim top banner in `App` when a cached `env:doctor` says `cli.found === false`, with the install command (`npm install -g @anthropic-ai/claude-code`) and a link. Covers a user removing the CLI after first run.
- **Zero-sessions empty state:** `Sidebar.jsx:72` only handles the *filtered* "No sessions match" case. Add a distinct zero-sessions-ever state (no query, `sessionCount === 0`) with a launch button.

## 3. Foundation residuals

### pty:spawn allowlist — pty.js
- Add a basename allowlist: `powershell.exe`, `pwsh.exe`, `cmd.exe`, `bash.exe`, `wsl.exe` (Windows) / common Unix shells, plus the platform default. `shell == null` → default.
- A provided `shell` whose lowercased basename isn't allowed → reject via the existing `PtyManager.lastSpawnError` + `{ ok:false }` contract (no throw).
- No injection today (empty args array), but an XSS could otherwise launch an arbitrary exe. Sub-project #10's profile editor extends the allowlist or adds a file picker.

### Cold-read V8 limit — parser.js + tailer.js
- `session:read` (index.js:128) falls back to `parseSessionFile`, which `readFileSync`s the whole file → throws past V8's ~512 MB string cap on multi-GB transcripts. (Draining `tailer.js` from offset 0 wouldn't fix it — the tailer does one `toString('utf8')` over the whole delta, hitting the same cap.)
- Fix: add a `streamLinesSync` reader to `parser.js` that reads fixed-size byte chunks and splits on `\n` at byte boundaries (newline is single-byte ASCII, so a partial multibyte codepoint at a chunk edge is preserved in a leftover Buffer, never bisected); `parseSessionFile` feeds its existing per-line reducer (`applyEvent`) from it instead of `readFileSync().split('\n')`. Memory is bounded regardless of file size.
- Parity test: streamed parse === current whole-file parse on a fixture; plus a chunk-boundary/UTF-8 reconstruction test.

## 4. Repo hygiene

- `LICENSE` — MIT, James Collard, 2026 (package.json already declares MIT).
- `package.json` — add `"engines": { "node": ">=22" }`.
- `CHANGELOG.md` — Keep-a-Changelog format; `0.1.0` entry summarising shipped features (terminal, sessions, themes, dashboards, Mission Control, search, etc.).
- `CONTRIBUTING.md` — dev setup: the no-OneDrive rule, `fix-electron`/extract-zip note, node-pty `npmRebuild:false` + space-in-path note, `npm test` glob form (`node --test tests/*.test.js`), and the `dev`/`build`/`dist` scripts.

## Testing

- `environment.js`: doctor result with injected `execFile`/`fs` (CLI found+version / not found / creds present-absent-malformed / session counts).
- pty allowlist: accept the known shells + default; reject an arbitrary path; `null` → default.
- crash log: rotation at threshold, keeps last 3, never throws on write failure.
- settings `onboarding`: default, round-trip through `setByPath`, merge from a v2 file (migration), corrupt-file fallback.
- cold-read reducer parity: streamed-from-zero === whole-file on a fixture.
- ErrorBoundary: renders fallback on a throwing child; forwards to the IPC.
- Smoke: `FLUX_SMOKE_VIEW=welcome` captures the welcome overlay against the built app.

## Out of scope (later sub-projects)

Code signing, electron-updater, GitHub Actions (all #2). Tray + `flux://` routing logic (#8 — but the single-instance `argv` seam lands here). Profile editor (#10).

## Files touched

- New: `src/main/environment.js`, `src/main/crashlog.js`, `src/renderer/src/components/WelcomeScreen.jsx`, `src/renderer/src/components/ErrorBoundary.jsx`, `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`.
- Edited: `src/main/index.js` (single-instance lock, crashlog install, `env:doctor` + `app:rendererError` IPCs), `src/main/pty.js` (allowlist), `src/main/parser.js` + `src/main/tailer.js` (shared reducer / cold-read drain), `src/main/settings.js` (`onboarding` section, version 3), `src/renderer/src/main.jsx` (boundaries), `src/renderer/src/App.jsx` (welcome overlay, CLI banner, content boundary), `src/renderer/src/components/Sidebar.jsx` (zero-sessions empty state), `package.json` (engines), `electron.vite.config.mjs` (new main-module rollup inputs: environment.js, crashlog.js).
