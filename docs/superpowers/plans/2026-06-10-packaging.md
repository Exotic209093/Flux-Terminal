# Packaging (Windows NSIS, unsigned) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production build actually render (it's blank today under `file://`) by serving the renderer over a custom `app://` scheme, then ship a Windows NSIS installer via electron-builder (unsigned).

**Architecture:** A small `appprotocol.js` registers a privileged `app://` scheme and serves `out/renderer/*` from disk with correct MIME (pure `resolveRendererPath` is unit-tested; the `protocol.handle` glue is thin). `index.js` registers the scheme before ready and `loadURL('app://./index.html')` in production. electron-builder packages `out/**` into an NSIS installer with `node-pty` asar-unpacked.

**Tech Stack:** Electron 42 (`protocol.registerSchemesAsPrivileged` + `protocol.handle`), electron-builder, Node built-in test runner.

---

## As-landed facts

- `src/main/index.js` `createWindow()`: in production (`!process.env.ELECTRON_RENDERER_URL`) it calls `mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))` → blank (ES-module CORS under `file://`). Dev uses `loadURL(ELECTRON_RENDERER_URL)`.
- `electron.vite.config.mjs` lists every `src/main/*.js` module in `rollupOptions.input` — a NEW main module MUST be added there or the built app crashes with "Cannot find module './x'".
- Built renderer: `out/renderer/index.html` + `out/renderer/assets/*` (relative `./assets/...` refs).
- `node-pty` is a native dep (`.node` binary) → must be `asarUnpack`ed to load from a packaged app.
- `package.json`: scripts dev/build/preview/postinstall/fix-electron/smoke/test; no electron-builder, no `build` config. `main: ./out/main/index.js`. version `0.1.0`.
- The `app://./index.html` URL parses to `{ host: '.', pathname: '/index.html' }`; assets resolve relative to it → `app://./assets/x.js` → pathname `/assets/x.js`. So mapping `url.pathname` onto the renderer dir works for both (host ignored).
- Verification must distinguish dev (`http://localhost`, already works) from the BUILT app (`electron .` / packaged) — the whole point is the built app rendering.

---

## File Structure

**New (main):** `src/main/appprotocol.js` — `registerAppScheme()` (privileged registration, call before ready), `serveAppProtocol(rendererDir)` (`protocol.handle` glue), `resolveRendererPath(rel, rendererDir)` (pure, testable), `MIME` map.
**New:** `build/icon.ico` (app icon), `electron-builder.yml` (packaging config).
**Modified:** `src/main/index.js` (register scheme + serve + `loadURL('app://…')`), `electron.vite.config.mjs` (add `appprotocol` input), `package.json` (electron-builder devDep + dist scripts).
**Tests:** `tests/appprotocol.test.js`.

**Shippable checkpoints:** end of Task 2 = the built (non-dev) app renders. End of Task 4 = an installable NSIS .exe.

---

## Task 1 — `appprotocol.js` (testable resolver + serve glue)

**Files:** Create `src/main/appprotocol.js`; Test `tests/appprotocol.test.js`.

- [ ] **Step 1: Write the failing test**

```js
// tests/appprotocol.test.js
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { resolveRendererPath, MIME } = require('../src/main/appprotocol')

const DIR = path.join('C:', 'app', 'out', 'renderer')

test('maps root and empty path to index.html', () => {
  assert.strictEqual(resolveRendererPath('/', DIR), path.join(DIR, 'index.html'))
  assert.strictEqual(resolveRendererPath('', DIR), path.join(DIR, 'index.html'))
})

test('maps an asset path under the renderer dir', () => {
  assert.strictEqual(resolveRendererPath('/assets/index-abc.js', DIR), path.join(DIR, 'assets', 'index-abc.js'))
})

test('rejects path traversal (returns null)', () => {
  assert.strictEqual(resolveRendererPath('/../../secret.txt', DIR), null)
  assert.strictEqual(resolveRendererPath('/..%2f..%2fsecret', DIR), null)
})

test('MIME covers the renderer asset types', () => {
  assert.strictEqual(MIME['.js'], 'text/javascript')
  assert.strictEqual(MIME['.css'], 'text/css')
  assert.strictEqual(MIME['.html'], 'text/html')
})
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/appprotocol.test.js` (cannot find module).

- [ ] **Step 3: Implement `src/main/appprotocol.js`**

```js
// src/main/appprotocol.js
const fs = require('fs')
const path = require('path')

// Serve the built renderer over a custom app:// scheme. Under file:// Electron
// blocks the renderer's ES-module <script> by CORS (blank window in production);
// a privileged standard+secure scheme loads modules normally.
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
}

/**
 * Map an app:// URL pathname to an absolute file under rendererDir, or null if
 * it escapes the dir (path-traversal guard). Pure — unit-tested.
 */
function resolveRendererPath(rel, rendererDir) {
  let p = rel || ''
  try {
    p = decodeURIComponent(p)
  } catch {
    /* malformed escapes — fall through with raw */
  }
  if (!p || p === '/') p = '/index.html'
  const resolved = path.normalize(path.join(rendererDir, p))
  const base = path.normalize(rendererDir)
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null
  return resolved
}

/** Call BEFORE app.whenReady(). Registers app:// as a privileged scheme. */
function registerAppScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

/** Call in whenReady(). Serves rendererDir over app://. */
function serveAppProtocol(protocol, rendererDir) {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    const filePath = resolveRendererPath(url.pathname, rendererDir)
    if (!filePath) return new Response('forbidden', { status: 403 })
    try {
      const data = await fs.promises.readFile(filePath)
      const ext = path.extname(filePath).toLowerCase()
      return new Response(data, { headers: { 'content-type': MIME[ext] || 'application/octet-stream' } })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

module.exports = { resolveRendererPath, registerAppScheme, serveAppProtocol, MIME }
```

> Note: `protocol` is passed IN (not required at module top) so the test can `require` this file under plain `node --test` without pulling in Electron. The test only exercises `resolveRendererPath` + `MIME`. `new Response(...)` is the Web/undici global available in Electron's main process (Node 18+).

- [ ] **Step 4: Run to verify pass** — `node --test tests/appprotocol.test.js` (4 pass). Then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/main/appprotocol.js tests/appprotocol.test.js
git commit -F- <<'EOF'
feat(packaging): app:// protocol resolver + serve glue (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2 — wire the protocol into index.js  → **built app renders**

**Files:** Modify `src/main/index.js`, `electron.vite.config.mjs`.

- [ ] **Step 1: index.js — require + register scheme + serve + production loadURL.**

Add to the requires (after the other `./x` requires):
```js
const { registerAppScheme, serveAppProtocol } = require('./appprotocol')
```
Add `protocol` to the electron destructure on line 1 (alongside app, BrowserWindow, ipcMain, dialog, Notification, nativeImage):
```js
const { app, BrowserWindow, ipcMain, dialog, Notification, nativeImage, protocol } = require('electron')
```
Register the scheme at MODULE TOP LEVEL (must run before `app.whenReady()`), right after the requires / `let mainWindow = null` holders:
```js
// Must run before app is ready: make app:// a privileged scheme so the built
// renderer's ES modules load (file:// blocks them by CORS — blank window).
registerAppScheme(protocol)
```
In `whenReady` (very first thing inside the `.then(() => { … })`, before `createWindow()`):
```js
  serveAppProtocol(protocol, path.join(__dirname, '../renderer'))
```
In `createWindow()`, replace the production load:
```js
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
```
with:
```js
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadURL('app://./index.html')
  }
```

- [ ] **Step 2: electron.vite.config.mjs — add the build input.** In `rollupOptions.input`, add (after the last entry, e.g. `missioncontrol`):
```js
          missioncontrol: resolve('src/main/missioncontrol.js'),
          appprotocol: resolve('src/main/appprotocol.js')
```
(keep the existing entries; mind the comma on the previously-last line.)

- [ ] **Step 3: Verify the BUILT app renders (the key proof).**
1. `npm test` — green (incl. the 4 new appprotocol tests).
2. `npm run build`.
3. Confirm `out/main/appprotocol.js` exists (`Get-ChildItem out/main/appprotocol.js`).
4. Launch the BUILT app (NOT dev — this exercises the `app://` production path) and screenshot. Stop any electron first, then (PowerShell):
   `Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force; Set-Location "C:\Users\james\Projects\Flux Terminal"; $env:FLUX_SMOKE_SHOT="C:\tmp\flux-pkg-built.png"; & "node_modules/.bin/electron" . ; Remove-Item Env:FLUX_SMOKE_SHOT`
   (Use the pinned local electron binary, NOT `npx electron`, to avoid a download hang. This runs `electron .` with NO `ELECTRON_RENDERER_URL`, so it loads `app://./index.html` from the built `out/`.)
   Expect `FLUX_SMOKE_SHOT_OK`. **READ `C:\tmp\flux-pkg-built.png` — it MUST now show the full Flux UI (sidebar, tabs, terminal), NOT a blank dark frame.** This is the whole point — before this task the built app was blank. If it's still blank, the protocol wiring is wrong — investigate (DevTools console via a temporary `mainWindow.webContents.openDevTools()` or check the app:// handler) before claiming done.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js electron.vite.config.mjs
git commit -F- <<'EOF'
fix(packaging): serve renderer over app:// so the production build renders

The built renderer loads as an ES module; under file:// Electron blocks it by
CORS, leaving a blank window. Register a privileged app:// scheme and loadURL
app://./index.html in production. Dev (ELECTRON_RENDERER_URL) is unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3 — app icon

**Files:** Create `build/icon.ico` (+ a generator script run once).

- [ ] **Step 1: Generate `build/icon.ico`.** electron-builder reads `build/icon.ico` (256×256 multi-size). Generate a simple branded icon (⚡ accent `#89b4fa` on `#0b0e14`) without adding an image dependency — build a PNG with Node's `zlib` and embed it in a minimal multi-image `.ico`. Run this Node script (it writes the file; it is a one-off, not committed as a script):

```js
// run with: node -e "...":  generates build/icon.ico (256x256 RGBA, single image .ico)
const fs = require('fs'); const zlib = require('zlib'); const path = require('path')
const S = 256
const buf = Buffer.alloc(S * (1 + S * 4))
function px(x, y, r, g, b, a) { const o = y * (1 + S * 4) + 1 + x * 4; buf[o]=r; buf[o+1]=g; buf[o+2]=b; buf[o+3]=a }
// background rounded-ish dark, with a bright accent diagonal "bolt" band
for (let y = 0; y < S; y++) {
  buf[y * (1 + S * 4)] = 0
  for (let x = 0; x < S; x++) {
    // base dark
    let r = 0x0b, g = 0x0e, b = 0x14, a = 255
    // a thick accent diagonal stripe = stylised bolt
    const d = (x - y)
    if (d > -28 && d < 28) { r = 0x89; g = 0xb4; b = 0xfa }
    px(x, y, r, g, b, a)
  }
}
function crc32(b){let c=~0;for(let i=0;i<b.length;i++){c^=b[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1))}return ~c>>>0}
function chunk(t,d){const len=Buffer.alloc(4);len.writeUInt32BE(d.length);const tt=Buffer.from(t);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc32(Buffer.concat([tt,d])));return Buffer.concat([len,tt,d,cr])}
const sig=Buffer.from([137,80,78,71,13,10,26,10])
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(S,0);ihdr.writeUInt32BE(S,4);ihdr[8]=8;ihdr[9]=6
const png=Buffer.concat([sig,chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(buf)),chunk('IEND',Buffer.alloc(0))])
// ICO wrapping a PNG (Vista+ supports PNG-compressed icon entries)
const ico=Buffer.alloc(6+16)
ico.writeUInt16LE(0,0); ico.writeUInt16LE(1,2); ico.writeUInt16LE(1,4) // reserved, type=1, count=1
ico.writeUInt8(0,6); ico.writeUInt8(0,7) // width/height 0 = 256
ico.writeUInt8(0,8); ico.writeUInt8(0,9) // colors, reserved
ico.writeUInt16LE(1,10); ico.writeUInt16LE(32,12) // planes, bpp
ico.writeUInt32LE(png.length,14); ico.writeUInt32LE(6+16,18) // size, offset
fs.mkdirSync(path.join(process.cwd(),'build'),{recursive:true})
fs.writeFileSync(path.join(process.cwd(),'build','icon.ico'), Buffer.concat([ico, png]))
console.log('wrote build/icon.ico', (6+16+png.length), 'bytes')
```
Run it (PowerShell): save the above to a temp file and `node temp-icon.js`, OR paste into `node -e "..."`. Confirm `build/icon.ico` exists and is a few KB. Delete the temp generator script (do NOT commit it).

- [ ] **Step 2: Commit the icon**

```bash
git add build/icon.ico
git commit -F- <<'EOF'
chore(packaging): app icon (build/icon.ico)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4 — electron-builder config + package + verify

**Files:** Create `electron-builder.yml`; Modify `package.json`.

- [ ] **Step 1: Install electron-builder**

Run: `npm install -D electron-builder`
Expected: adds `electron-builder` to devDependencies. (If the postinstall `ensure-electron` runs, that's fine.)

- [ ] **Step 2: Create `electron-builder.yml`** at the repo root:

```yaml
appId: com.fluxterminal.app
productName: Flux Terminal
directories:
  output: dist
  buildResources: build
files:
  - out/**/*
  - package.json
asar: true
asarUnpack:
  - "**/node_modules/node-pty/**"
win:
  target:
    - nsis
  icon: build/icon.ico
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
```

- [ ] **Step 3: Add scripts to `package.json`.** In `scripts`, add:
```json
    "dist": "electron-vite build && electron-builder",
    "dist:dir": "electron-vite build && electron-builder --dir"
```
(append after `"smoke:electron"` etc.; mind commas.)

- [ ] **Step 4: Build the UNPACKED app first (fast) and verify it runs.**
Run: `npm run dist:dir`
- This builds `out/` then packs to `dist/win-unpacked/Flux Terminal.exe` (no NSIS installer yet — faster).
- If electron-builder's Electron download stalls (the known `extract-zip` quirk), document the workaround used (e.g. set `$env:ELECTRON_BUILDER_CACHE` or retry; the dev electron is already cached under `node_modules/electron`).
Then LAUNCH the unpacked app and screenshot (PowerShell):
`Get-Process "Flux Terminal" -ErrorAction SilentlyContinue | Stop-Process -Force; $env:FLUX_SMOKE_SHOT="C:\tmp\flux-pkg-unpacked.png"; & "dist/win-unpacked/Flux Terminal.exe" ; Remove-Item Env:FLUX_SMOKE_SHOT`
**READ `C:\tmp\flux-pkg-unpacked.png`** — confirm the packaged app RENDERS the full UI (proves app:// works in a real package) AND that the terminal area shows a shell prompt (proves `node-pty` loaded from the unpacked asar). Describe what you see. If the terminal is blank but the UI renders, node-pty failed to load → check `asarUnpack`.

- [ ] **Step 5: Build the NSIS installer.**
Run: `npm run dist`
Expected: produces `dist/Flux Terminal Setup 0.1.0.exe` (+ a `latest.yml`/blockmap). Confirm the file exists and its size (~80-160 MB). Report the exact filename.

- [ ] **Step 6: Install + launch the installed app (the real proof).**
Silent-install then launch (PowerShell):
`& "dist\Flux Terminal Setup 0.1.0.exe" /S; Start-Sleep -Seconds 20`
(NSIS `/S` = silent; non-oneClick still honors `/S`. Installs to `%LOCALAPPDATA%\Programs\flux-terminal` or the per-user default.) Then find and launch the installed exe:
`$exe = Get-ChildItem "$env:LOCALAPPDATA\Programs" -Recurse -Filter "Flux Terminal.exe" -ErrorAction SilentlyContinue | Select-Object -First 1; $env:FLUX_SMOKE_SHOT="C:\tmp\flux-pkg-installed.png"; & $exe.FullName ; Remove-Item Env:FLUX_SMOKE_SHOT`
**READ `C:\tmp\flux-pkg-installed.png`** — confirm the INSTALLED app renders the full UI + a working terminal. This is the definitive proof. Describe what you see. (If silent install path differs, locate the exe under `$env:LOCALAPPDATA\Programs` or `$env:ProgramFiles`.)

- [ ] **Step 7: Add `dist/` to .gitignore** (don't commit the 100 MB+ artifacts). Append `dist/` to `.gitignore` (create the file if absent; check it doesn't already ignore it).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json electron-builder.yml .gitignore
git commit -F- <<'EOF'
feat(packaging): electron-builder NSIS installer (node-pty asar-unpacked)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5 — docs

**Files:** Modify `docs/superpowers/specs/2026-06-10-packaging-design.md`, `README.md`.

- [ ] **Step 1:** Set the spec Status line to `implemented 2026-06-10 (see docs/superpowers/plans/2026-06-10-packaging.md)`.
- [ ] **Step 2:** Update `README.md`: under the "Other scripts" table add `npm run dist` ("build a Windows NSIS installer in dist/") and `npm run dist:dir` ("build an unpacked app for testing"). Add a roadmap bullet:
```md
- [x] **Packaging:** the production build renders (served over a custom `app://` scheme,
      fixing the file:// blank-window bug) and `npm run dist` produces an unsigned Windows
      NSIS installer (node-pty asar-unpacked). Code signing is a documented future step.
```
Also tick/remove the "Package installers (electron-builder)" item from "Possible next steps" if present.
- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-10-packaging-design.md README.md
git commit -F- <<'EOF'
docs: mark packaging implemented; README dist scripts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Self-review notes (author)

- **Spec coverage:** app:// protocol fix (Tasks 1-2) ✓ with the built-app-renders proof (Task 2 Step 3); electron-builder NSIS + node-pty asarUnpack (Task 4) ✓; icon (Task 3) ✓; install+launch verification (Task 4 Step 6) ✓; unsigned + later-signing note (config has no cert fields; README/spec note) ✓; dist/ gitignored ✓.
- **Placeholders:** none — protocol code, icon generator, and electron-builder.yml are complete.
- **Type/name consistency:** `registerAppScheme`/`serveAppProtocol`/`resolveRendererPath`/`MIME` used consistently across appprotocol.js, index.js, and the test; `appprotocol` added to vite inputs so `require('./appprotocol')` resolves in the build.
- **Key risk surfaced:** Task 4 Step 4 explicitly checks node-pty loads in the package (terminal renders), and documents the extract-zip workaround if the electron-builder download stalls.
- **Verification is real:** three escalating proofs — built app via `electron .` (Task 2), unpacked package (Task 4 Step 4), installed app (Task 4 Step 6) — each with a screenshot to actually LOOK at.
