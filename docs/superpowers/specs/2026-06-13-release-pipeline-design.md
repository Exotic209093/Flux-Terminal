# Release Pipeline (CI + auto-update) — design

**Date:** 2026-06-13
**Sub-project:** #2 of the power-user program (`2026-06-13-power-user-program.md`).
**Goal:** A green CI gate on every push/PR, a tag-triggered build that publishes a signed-later NSIS installer to GitHub Releases, and in-app auto-update so installed builds upgrade themselves.
**Distribution context:** repo `Exotic209093/Flux-Terminal` is already PUBLIC; prior versions already pushed. Unsigned (Windows SmartScreen prompts until signing is added). Windows-first.
**Status:** design approved 2026-06-13 (Node 24 runner, windows-latest, `v0.1.0` first real release, updater = check-on-launch / install-on-quit).

## Decisions

- **Runner:** `windows-latest` — node-pty native binaries + NSIS target are Windows-only, and the test suite loads node-pty and `node:sqlite`.
- **Node version:** 24, to match the dev environment and Electron 42's bundled Node. Node 22 on the runner risks `node:sqlite` being absent, which `searchindex.test.js` exercises.
- **First release:** `v0.1.0`. `git tag -l` is empty — no release was ever cut, so the CHANGELOG's `0.1.0` line was aspirational. `v0.1.0` becomes the first real release containing everything on main (June features + hardening + this pipeline).
- **Auto-update:** unsigned electron-updater on Windows NSIS works; updates download in the background and install on quit. SmartScreen prompts each update until signing lands.

## Components

### 1. CI workflow — `.github/workflows/ci.yml`
Triggers on `push` to `main` and all `pull_request`. One job on `windows-latest`, Node 24 with npm cache + an Electron-download cache. Steps: `npm ci` (postinstall runs `ensure-electron.cjs`), `npm test`, `npm run build`. Catches both test and build breaks.

### 2. Release workflow — `.github/workflows/release.yml`
Triggers on tag push matching `v*`. `permissions: contents: write` (so the default `GITHUB_TOKEN` can create the Release). One job on `windows-latest`, Node 24. Steps: `npm ci` → `npm run build` → `npx electron-builder --win --publish always` with `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. electron-builder reads the publish target from `electron-builder.yml`, builds the NSIS installer, generates `latest.yml`, and uploads installer + `latest.yml` + `.blockmap` to the tag's GitHub Release.

### 3. `electron-builder.yml` — publish target
Add:
```yaml
publish:
  provider: github
  owner: Exotic209093
  repo: Flux-Terminal
```
No `files` change needed — electron-builder always bundles production `node_modules` (node-pty already ships this way), so `electron-updater` is included automatically.

### 4. electron-updater — `src/main/updater.js`
Add `electron-updater` to `dependencies`. New module:
- `shouldAutoUpdate(app)` → `!!(app && app.isPackaged)` (pure, unit-tested; dev is a no-op).
- `initAutoUpdate({ app, updater, logger, onEvent })` → returns false (no-op) unless packaged; otherwise **lazy-requires** `electron-updater` (so unit tests and the dev process never load it), registers `error`/`update-available`/`update-downloaded` handlers (logged), and calls `checkForUpdatesAndNotify()`.
- Wired into `index.js` `whenReady` after the window is created; added to `electron.vite.config.mjs` rollup inputs.

### 5. CHANGELOG + README
- `CHANGELOG.md`: consolidate the `Unreleased` section into a dated `## [0.1.0] - 2026-06-13` and add the CI/release pipeline + auto-update lines.
- `README.md`: a **Download / Install** section linking to the Releases page, noting the unsigned SmartScreen step ("More info → Run anyway").

## Live rollout (controller-driven, after the local build merges to main)

Not subagent work — driven directly because it's outward-facing and needs watching:
1. Push `main` to `origin` → CI workflow runs → confirm green.
2. Cut and push `v0.1.0` → release workflow runs → confirm it builds and publishes.
3. Confirm the GitHub Release has the installer + `latest.yml`.

## Testing

- `updater.test.js`: `shouldAutoUpdate` true/false; `initAutoUpdate` returns false (no-op) when not packaged; with `{ isPackaged: true }` + an injected fake updater, registers handlers and calls `checkForUpdatesAndNotify`.
- Local packaging regression: `npm run build` succeeds; `npm run dist:dir` still produces an unpacked app (updater + publish block didn't break the build).
- Workflows: validated by the real CI run after push (the point of "wire it live"); they can't be meaningfully unit-tested locally.

## Out of scope (later)

Code signing (Azure Trusted Signing — a fast-follow once OSS-ready). macOS targets (v1.1). Release notes automation beyond the CHANGELOG.

## Files

- New: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `src/main/updater.js`, `tests/updater.test.js`.
- Edited: `electron-builder.yml` (publish), `package.json` (electron-updater dep), `src/main/index.js` (initAutoUpdate in whenReady), `electron.vite.config.mjs` (updater rollup input), `CHANGELOG.md`, `README.md`.
