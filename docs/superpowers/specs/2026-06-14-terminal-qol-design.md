# Terminal Power-User QoL — design

**Date:** 2026-06-14
**Sub-project:** #10 of the power-user program.
**Goal:** Make the terminal a power-user surface — clickable links/paths, copy-on-select + right-click paste, and real launch profiles (cwd/shell/args).
**Status:** approved (autonomous run).

## Decisions

- **Clickable links + paths:** add `@xterm/addon-web-links` for URLs; add a custom xterm link provider for Windows file paths. Both open through guarded main-process handlers (`shell.openExternal` for URLs, `shell.openPath`/reveal for files) — the renderer never opens anything itself.
- **Copy-on-select / right-click paste:** selection → clipboard (renderer `navigator.clipboard.writeText`); right-click → paste from the OS clipboard via a main `clipboard:readText` IPC (reliable under sandbox) written to the PTY.
- **Launch profile args:** thread `args` end-to-end (it's currently dropped) — `pty:spawn` → `pty.js` → node-pty — validated; expose cwd/shell/args/tracked in the Terminal settings profile editor (today it edits the name only).
- **Deferred / flagged:** OSC 133 prompt/command marks (needs injecting shell-integration into the user's shell on spawn — invasive, can clash with custom prompts; make it a future opt-in). Split/ratio/active-pane layout restore (current profileId+title restore is adequate; full geometry restore is low-value polish).

## Changes

### Main IPC — `src/main/index.js` + `src/preload/index.js`
- New `src/main/shellio.js` (pure guards): `isAllowedExternalUrl(url)` → only `http:`/`https:`/`mailto:`; `looksLikePath(s)` → a Windows/Unix path heuristic. Unit-tested.
- `index.js`: `ipcMain.handle('shell:openExternal', (_e, url) => isAllowedExternalUrl(url) ? (shell.openExternal(url), {ok:true}) : {ok:false})`; `ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(String(p)))`; `ipcMain.handle('clipboard:readText', () => clipboard.readText())` (import `clipboard` from electron).
- `preload`: `shell: { openExternal, openPath }`, `clipboard: { readText }`.

### TerminalPane — `src/renderer/src/components/TerminalPane.jsx`
- Load `WebLinksAddon` with a handler that calls `window.flux.shell.openExternal(uri)`.
- Register a `registerLinkProvider` for file paths (regex over the line text): clicking calls `window.flux.shell.openPath(path)`.
- `term.onSelectionChange(() => { const s = term.getSelection(); if (s) navigator.clipboard.writeText(s).catch(()=>{}) })`.
- Right-click (`host.oncontextmenu`): `e.preventDefault(); window.flux.clipboard.readText().then((t) => t && window.flux.pty.write(ptyId, t))`.
- Accept an `args` prop; pass it into `window.flux.pty.spawn({ id, cols, rows, cwd, shell, args })`.

### Args passthrough — `src/main/pty.js`, `src/main/ptymanager.js`, `src/main/index.js`
- `pty.js` `createPty({ cols, rows, cwd, shell, args })`: validate `args` (array of strings, capped length; reject otherwise) and pass to `pty.spawn(shell||default, validatedArgs, …)` instead of the hardcoded `[]`. Pure `validArgs(args)` helper, unit-tested.
- `index.js` `pty:spawn` handler: forward `args` to `ptyManager.spawn(id, { cols, rows, cwd, shell, args })`; `ptymanager.spawn` already forwards opts to `createPty`.

### Profile editor — `src/renderer/src/components/settings/TerminalSection.jsx` (or wherever the profile editor lives)
- Extend the profile editor (currently name-only) with fields for **cwd** (text), **shell** (text/select), **args** (space- or comma-split into an array), and a **tracked** toggle — saved through the existing `settings.saveProfile` path (save-on-blur, matching the current pattern). The store schema already carries `{ id, name, shell, args, cwd, tracked }`.

## Verification

- Unit: `isAllowedExternalUrl` / `looksLikePath` (shellio.js); `validArgs` (pty.js).
- Build: `npm run build` (new `@xterm/addon-web-links` dep bundles).
- Manual: a URL in terminal output is clickable and opens in the browser; a file path opens/reveals; selecting text copies it; right-click pastes; a profile with custom args/cwd launches correctly.

## Files

- New: `src/main/shellio.js`, `tests/shellio.test.js`, `tests/pty-args.test.js`.
- Edited: `src/main/index.js`, `src/main/pty.js`, `src/main/ptymanager.js` (forward args if needed), `src/preload/index.js`, `src/renderer/src/components/TerminalPane.jsx`, `src/renderer/src/components/TerminalWorkspace.jsx` (pass profile args to panes), the Terminal settings profile-editor component, `electron.vite.config.mjs` (rollup input: shellio), `package.json` (`@xterm/addon-web-links`).
