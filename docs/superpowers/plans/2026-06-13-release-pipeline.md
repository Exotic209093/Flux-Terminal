# Release Pipeline (CI + auto-update) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Actions CI gate (test + build) on push/PR, a tag-triggered NSIS release published to GitHub Releases, and in-app auto-update via electron-updater.

**Architecture:** Two workflow files, a publish block in electron-builder.yml, and a thin `src/main/updater.js` (pure `shouldAutoUpdate` + lazy-requiring `initAutoUpdate`) wired into `whenReady`. New main module must be added to `electron.vite.config.mjs` rollup inputs.

**Tech Stack:** GitHub Actions, electron-builder 26, electron-updater, Node 24, node:test.

**Spec:** `docs/superpowers/specs/2026-06-13-release-pipeline-design.md`

**Test command:** `npm test` runs `node --test "tests/**/*.test.js"`. Single file: `node --test tests/updater.test.js`.

**Tasks 1-5 are the LOCAL build (subagent work).** The live rollout (push, tag, verify CI) is controller-driven and listed at the end — NOT a subagent task.

---

## File Structure

- New: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- New: `src/main/updater.js`, `tests/updater.test.js`
- Modify: `electron-builder.yml` (publish), `package.json` (dep), `src/main/index.js` (wire), `electron.vite.config.mjs` (rollup input), `CHANGELOG.md`, `README.md`

---

## Task 1: electron-updater module + wiring

**Files:**
- Create: `src/main/updater.js`, `tests/updater.test.js`
- Modify: `package.json`, `src/main/index.js`, `electron.vite.config.mjs`

- [ ] **Step 1: Add the dependency**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm install electron-updater@^6`
Expected: `electron-updater` appears under `dependencies` in package.json; package-lock updates.

- [ ] **Step 2: Write the failing test**

Create `tests/updater.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const { shouldAutoUpdate, initAutoUpdate } = require('../src/main/updater')

test('shouldAutoUpdate only when packaged', () => {
  assert.strictEqual(shouldAutoUpdate({ isPackaged: true }), true)
  assert.strictEqual(shouldAutoUpdate({ isPackaged: false }), false)
  assert.strictEqual(shouldAutoUpdate(undefined), false)
})

test('initAutoUpdate is a no-op (returns false) in dev / unpackaged', () => {
  let touched = false
  const fake = { on() { touched = true }, checkForUpdatesAndNotify() { touched = true } }
  const r = initAutoUpdate({ app: { isPackaged: false }, updater: fake })
  assert.strictEqual(r, false)
  assert.strictEqual(touched, false)
})

test('initAutoUpdate wires handlers and checks for updates when packaged', () => {
  const events = []
  const fake = {
    on(name) { events.push(name) },
    checkForUpdatesAndNotify() { events.push('checked') }
  }
  const r = initAutoUpdate({ app: { isPackaged: true }, updater: fake, logger: { log() {}, error() {} } })
  assert.strictEqual(r, true)
  assert.ok(events.includes('error'))
  assert.ok(events.includes('update-available'))
  assert.ok(events.includes('update-downloaded'))
  assert.ok(events.includes('checked'))
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/updater.test.js`
Expected: FAIL (cannot find module `../src/main/updater`).

- [ ] **Step 4: Implement updater.js**

Create `src/main/updater.js`:

```js
// src/main/updater.js
// In-app auto-update via electron-updater. No-op unless the app is packaged
// (dev runs from source and has no update feed). electron-updater is
// lazy-required so this module — and unit tests / the dev process — never load
// it unless an update check actually runs.

function shouldAutoUpdate(app) {
  return !!(app && app.isPackaged)
}

function initAutoUpdate({ app, updater, logger = console, onEvent } = {}) {
  if (!shouldAutoUpdate(app)) return false
  const u = updater || require('electron-updater').autoUpdater
  try {
    u.autoDownload = true
    u.on('error', (e) => logger.error && logger.error('[updater] ' + (e && e.message)))
    u.on('update-available', (info) => {
      logger.log && logger.log('[updater] update-available ' + (info && info.version))
      onEvent && onEvent('available', info)
    })
    u.on('update-downloaded', (info) => {
      logger.log && logger.log('[updater] update-downloaded ' + (info && info.version))
      onEvent && onEvent('downloaded', info)
    })
    u.checkForUpdatesAndNotify()
    return true
  } catch (e) {
    logger.error && logger.error('[updater] init failed ' + (e && e.message))
    return false
  }
}

module.exports = { shouldAutoUpdate, initAutoUpdate }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/updater.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Register the module in the build**

In `electron.vite.config.mjs`, in `rollupOptions.input`, after the `crashlog: resolve('src/main/crashlog.js')` line add:

```js
          updater: resolve('src/main/updater.js')
```

(Ensure the line before it ends with a comma.)

- [ ] **Step 7: Wire into the main process**

In `src/main/index.js`, after the line `const { install: installCrashLog } = require('./crashlog')` add:

```js
const { initAutoUpdate } = require('./updater')
```

In the `app.whenReady().then(...)` body, after the line `mainWindow.on('focus', () => notifier && notifier.clear())` add:

```js
  // Check for updates on launch (no-op in dev; packaged builds self-update).
  initAutoUpdate({ app })
```

- [ ] **Step 8: Verify build + tests**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build && npm test 2>&1 | tail -6`
Expected: build succeeds, `out/main/updater.js` emitted; all tests pass (273 + 3 new = 276).

- [ ] **Step 9: Commit**

```bash
git add src/main/updater.js tests/updater.test.js src/main/index.js electron.vite.config.mjs package.json package-lock.json
git commit -m "feat(updater): electron-updater auto-update (check on launch, no-op in dev)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: electron-builder publish target

**Files:**
- Modify: `electron-builder.yml`

- [ ] **Step 1: Add the publish block**

In `electron-builder.yml`, append at the end of the file:

```yaml
publish:
  provider: github
  owner: Exotic209093
  repo: Flux-Terminal
```

- [ ] **Step 2: Verify packaging still works (unpacked)**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run dist:dir 2>&1 | tail -12`
Expected: builds an unpacked app into `dist/win-unpacked/` with no errors. (This confirms the publish block + electron-updater dependency didn't break packaging. `dist:dir` does not upload anything.)

Verify the app folder exists:
Run (PowerShell): `Test-Path "dist/win-unpacked/Flux Terminal.exe"`
Expected: `True`.

- [ ] **Step 3: Commit**

```bash
git add electron-builder.yml
git commit -m "build: publish NSIS releases to the GitHub repo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Cache Electron download
        uses: actions/cache@v4
        with:
          path: ~/AppData/Local/electron/Cache
          key: electron-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

      - name: Install
        run: npm ci

      - name: Test
        run: npm test

      - name: Build
        run: npm run build
```

- [ ] **Step 2: Validate the YAML locally**

Run (PowerShell): `cd "C:/Users/james/Projects/Flux Terminal"; node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/ci.yml','utf8');if(!/runs-on: windows-latest/.test(s)||!/npm test/.test(s)){process.exit(1)}console.log('ci.yml ok')"`
Expected: `ci.yml ok` (a basic content sanity check — the real validation is the live CI run).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: test + build gate on push and PR (windows, node 24)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the release workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Cache Electron download
        uses: actions/cache@v4
        with:
          path: ~/AppData/Local/electron/Cache
          key: electron-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

      - name: Install
        run: npm ci

      - name: Build renderer/main/preload
        run: npm run build

      - name: Package + publish NSIS to the GitHub Release
        run: npx electron-builder --win --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Validate the YAML locally**

Run (PowerShell): `cd "C:/Users/james/Projects/Flux Terminal"; node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/release.yml','utf8');if(!/tags:/.test(s)||!/--publish always/.test(s)||!/contents: write/.test(s)){process.exit(1)}console.log('release.yml ok')"`
Expected: `release.yml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: tag-triggered NSIS release publish to GitHub Releases

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: CHANGELOG + README

**Files:**
- Modify: `CHANGELOG.md`, `README.md`

- [ ] **Step 1: Consolidate the CHANGELOG into a dated 0.1.0**

In `CHANGELOG.md`, replace everything from the line `## [Unreleased]` through the end of the file with:

```markdown
## [0.1.0] - 2026-06-13

First published release.

### App
- Real ConPTY terminal (tabs + two-pane split + per-pane scrollback search),
  live and relived Claude Code sessions with a defensive JSONL parser, themes
  and animated backgrounds, live token/cost/tools dashboards, session timeline
  + replay, cross-session stats, live session tracking, interactive resume,
  skills, plan-usage gauges, slash-command autocomplete, inline images, Mission
  Control, watcher + notifications, and FTS5 cross-session search.

### Hardening + onboarding
- Single-instance lock (a second launch focuses the running window).
- Crash log (`userData/logs/main.log`) for uncaught exceptions, unhandled
  rejections, and renderer/child crashes; rotated, never uploaded.
- App-level + per-view React error boundaries with a reload fallback.
- Guided first-run welcome screen (claude CLI / login / sessions checks),
  a persistent CLI-missing banner, and a real zero-sessions empty state.
- `pty:spawn` validates the requested shell against an allowlist.
- Session reads stream the transcript in bounded chunks, so multi-GB files no
  longer hit V8's string-size limit.

### Distribution
- GitHub Actions CI (test + build) on push/PR.
- Tag-triggered NSIS installer published to GitHub Releases.
- In-app auto-update via electron-updater (unsigned; SmartScreen prompts until
  code signing is added).
```

- [ ] **Step 2: Add a Download section to the README**

In `README.md`, after the line `**React** UI.` (the end of the intro paragraph, around line 10) and before the following `---`, insert:

```markdown

## Download

Grab the latest installer from the
[Releases page](https://github.com/Exotic209093/Flux-Terminal/releases).

Flux is **not code-signed yet**, so Windows SmartScreen will warn on first run:
click **More info → Run anyway**. Installed builds auto-update from new releases.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md README.md
git commit -m "docs: 0.1.0 changelog + README download section

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Live rollout (controller-driven — NOT a subagent task)

After Tasks 1-5 land and the branch merges to `main`:

1. Push `main` to origin: `git push origin main`. The CI workflow runs on the push — watch it (`gh run watch` / `gh run list`) and confirm it's green.
2. Cut and push the tag: `git tag v0.1.0 && git push origin v0.1.0`. The release workflow runs.
3. Confirm the release: `gh release view v0.1.0` shows the `.exe` installer, `latest.yml`, and `.blockmap` attached.

If CI fails, read the logs (`gh run view --log-failed`), fix on a branch, and re-push before tagging.

---

## Self-Review

**Spec coverage:** CI workflow → Task 3; release workflow → Task 4; publish block → Task 2; electron-updater + wiring → Task 1; CHANGELOG/README → Task 5; live rollout (push/tag/verify) → final section. Node 24 + windows-latest used in both workflows. `v0.1.0` first release in the rollout.

**Placeholder scan:** none — every step has full file content or an exact command. Workflows are validated by a local sanity check + the real CI run (explicitly noted; they can't be meaningfully unit-tested).

**Type/name consistency:** `shouldAutoUpdate`/`initAutoUpdate` signatures match Task 1's test and the index.js wiring; `updater` rollup input name matches the file; the publish `owner`/`repo` match the real remote (`Exotic209093/Flux-Terminal`).

**Notes for the executor:** Tasks 1-5 are independent except Task 2's `dist:dir` benefits from Task 1's dep being installed. Commit after each task. Do NOT push or tag — that's the controller's live-rollout step.
