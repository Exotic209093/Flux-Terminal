# Tray + Deep Links (+ ntfy push) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** System tray (background presence), `flux://` deep links to sessions, and optional ntfy push on needs-you events. Completes Checkpoint B.

**Architecture:** Pure `deeplink.js` (parse/find) + push helpers in `notify.js`; new main modules wired in `index.js`; `tray.js`; settings gains `push`/`tray`; renderer routes deep links + adds settings UI. New main modules go in `electron.vite.config.mjs` rollup inputs.

**Tech Stack:** Electron 42 (Tray, setAsDefaultProtocolClient, global fetch), node:test. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-14-tray-deeplinks-design.md`

**Test command:** `npm test`. Build: `npm run build`. Main modules are CommonJS (tests `require()`).

**Note:** the single-instance lock + `second-instance` handler already exist in `index.js` (from #1). This plan extends them.

---

## Task 1: deeplink parser

**Files:**
- Create: `src/main/deeplink.js`, `tests/deeplink.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/deeplink.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const { parseDeepLink, findDeepLink } = require('../src/main/deeplink')

const UUID = '11111111-2222-3333-4444-555555555555'

test('parses flux://session/<uuid>', () => {
  assert.deepStrictEqual(parseDeepLink('flux://session/' + UUID), { route: 'session', sessionId: UUID })
})
test('parses flux://mission', () => {
  assert.deepStrictEqual(parseDeepLink('flux://mission'), { route: 'mission' })
})
test('rejects bad scheme / bad uuid / garbage', () => {
  assert.strictEqual(parseDeepLink('http://session/' + UUID), null)
  assert.strictEqual(parseDeepLink('flux://session/not-a-uuid'), null)
  assert.strictEqual(parseDeepLink('flux://nope'), null)
  assert.strictEqual(parseDeepLink('garbage'), null)
  assert.strictEqual(parseDeepLink(null), null)
})
test('findDeepLink scans an argv array', () => {
  assert.deepStrictEqual(findDeepLink(['electron', '.', 'flux://mission']), { route: 'mission' })
  assert.strictEqual(findDeepLink(['electron', '.']), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/deeplink.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/main/deeplink.js`:

```js
// Parse flux:// deep links. Pure; the main process scans argv/open-url for these.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseDeepLink(url) {
  if (typeof url !== 'string' || !url.toLowerCase().startsWith('flux://')) return null
  let u
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = (u.host || u.hostname || '').toLowerCase()
  if (host === 'session') {
    const id = decodeURIComponent((u.pathname || '').replace(/^\/+/, ''))
    return UUID_RE.test(id) ? { route: 'session', sessionId: id } : null
  }
  if (host === 'mission') return { route: 'mission' }
  return null
}

function findDeepLink(argv) {
  for (const a of argv || []) {
    const r = parseDeepLink(a)
    if (r) return r
  }
  return null
}

module.exports = { parseDeepLink, findDeepLink }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/deeplink.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/deeplink.js tests/deeplink.test.js
git commit -m "feat(deeplink): parse flux:// session/mission links

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: settings push/tray config + ntfy push

**Files:**
- Modify: `src/main/settings.js`, `src/main/notify.js`
- Test: `tests/settings-push-tray.test.js`, `tests/notify-push.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/settings-push-tray.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const os = require('os')
const path = require('path')
const { SettingsStore } = require('../src/main/settings')

function tmp() { return path.join(os.tmpdir(), 'flux-pt-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json') }

test('push/tray defaults', () => {
  const s = new SettingsStore(tmp())
  assert.deepStrictEqual(s.get().push, { enabled: false, url: '' })
  assert.deepStrictEqual(s.get().tray, { closeToTray: false })
})
test('setByPath persists push.url and tray.closeToTray', () => {
  const f = tmp()
  const s = new SettingsStore(f)
  s.setByPath('push.enabled', true)
  s.setByPath('push.url', 'https://ntfy.sh/mytopic')
  s.setByPath('tray.closeToTray', true)
  const r = new SettingsStore(f).get()
  assert.strictEqual(r.push.enabled, true)
  assert.strictEqual(r.push.url, 'https://ntfy.sh/mytopic')
  assert.strictEqual(r.tray.closeToTray, true)
})
test('invalid types throw', () => {
  const s = new SettingsStore(tmp())
  assert.throws(() => s.setByPath('push.enabled', 'yes'))
  assert.throws(() => s.setByPath('tray.closeToTray', 1))
})
```

Create `tests/notify-push.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const { Notifier, shouldPush, buildPushMessage } = require('../src/main/notify')

test('shouldPush only for needs-you events when enabled + url set', () => {
  const on = { enabled: true, url: 'https://ntfy.sh/t' }
  assert.strictEqual(shouldPush('turn:error', on), true)
  assert.strictEqual(shouldPush('blocked', on), true)
  assert.strictEqual(shouldPush('usage:threshold', on), true)
  assert.strictEqual(shouldPush('turn:finished', on), false)
  assert.strictEqual(shouldPush('turn:error', { enabled: false, url: 'x' }), false)
  assert.strictEqual(shouldPush('turn:error', { enabled: true, url: '' }), false)
})

test('Notifier posts to the push URL on an error event when configured', () => {
  const posts = []
  const n = new Notifier({
    getSettings: () => ({ notify: { turnError: 'toast' }, push: { enabled: true, url: 'https://ntfy.sh/t' } }),
    getWindow: () => null,
    NotificationImpl: class { on() {} show() {} },
    httpPost: (url, msg) => posts.push({ url, msg }),
    now: () => 1000
  })
  n.deliver({ sessionId: 's', title: 'My session', event: { type: 'turn:error' } })
  assert.strictEqual(posts.length, 1)
  assert.strictEqual(posts[0].url, 'https://ntfy.sh/t')
  assert.ok(posts[0].msg.title)
})

test('Notifier does not post when push disabled', () => {
  const posts = []
  const n = new Notifier({
    getSettings: () => ({ notify: { turnError: 'toast' }, push: { enabled: false, url: '' } }),
    getWindow: () => null, NotificationImpl: class { on() {} show() {} },
    httpPost: (url, msg) => posts.push({ url, msg }), now: () => 1000
  })
  n.deliver({ sessionId: 's', title: 't', event: { type: 'turn:error' } })
  assert.strictEqual(posts.length, 0)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/settings-push-tray.test.js tests/notify-push.test.js`
Expected: FAIL.

- [ ] **Step 3: settings.js — push/tray**

In `src/main/settings.js`:
- In `DEFAULTS`, add `push: { enabled: false, url: '' },` and `tray: { closeToTray: false },` (alongside `profiles`/`workspace`).
- In `_load()`, after the existing merges, add:

```js
      if (parsed.push && typeof parsed.push === 'object') {
        if (typeof parsed.push.enabled === 'boolean') this.data.push.enabled = parsed.push.enabled
        if (typeof parsed.push.url === 'string') this.data.push.url = parsed.push.url
      }
      if (parsed.tray && typeof parsed.tray === 'object') {
        if (typeof parsed.tray.closeToTray === 'boolean') this.data.tray.closeToTray = parsed.tray.closeToTray
      }
```

- Add setter methods (near `setOnboarding`):

```js
  setPush(key, value) {
    if (key === 'enabled') {
      if (typeof value !== 'boolean') throw new Error('push.enabled must be boolean')
      this.data.push.enabled = value
    } else if (key === 'url') {
      if (typeof value !== 'string') throw new Error('push.url must be a string')
      this.data.push.url = value
    } else throw new Error('unknown push key: ' + key)
    this._save()
    return this.get()
  }
  setTray(key, value) {
    if (key === 'closeToTray') {
      if (typeof value !== 'boolean') throw new Error('tray.closeToTray must be boolean')
      this.data.tray.closeToTray = value
    } else throw new Error('unknown tray key: ' + key)
    this._save()
    return this.get()
  }
```

- In `setByPath`, add routes before the final throw:

```js
    if (section === 'push') return this.setPush(key, value)
    if (section === 'tray') return this.setTray(key, value)
```

- [ ] **Step 4: notify.js — push helpers + Notifier**

In `src/main/notify.js`:
- Add pure helpers (near `titleFor`):

```js
function shouldPush(eventType, push) {
  if (!push || !push.enabled || !push.url) return false
  return eventType === 'turn:error' || eventType === 'blocked' || eventType === 'usage:threshold'
}

function buildPushMessage(notice) {
  const { title, body } = titleFor(notice)
  return { title, body }
}
```

- In the `Notifier` constructor add: `this.httpPost = opts.httpPost || (() => {})`.
- In `deliver`, after `this._record(notice, mode)`, add:

```js
    const push = this.getSettings().push
    if (shouldPush(notice.event.type, push)) {
      try { this.httpPost(push.url, buildPushMessage(notice)) } catch { /* best-effort */ }
    }
```

- Update the export to include `shouldPush, buildPushMessage`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/settings-push-tray.test.js tests/notify-push.test.js tests/notify.test.js tests/notify-snooze.test.js`
Expected: PASS (new + existing notify tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/settings.js src/main/notify.js tests/settings-push-tray.test.js tests/notify-push.test.js
git commit -m "feat(notify): optional ntfy push on needs-you events + push/tray settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Deep-link wiring (main + preload + App + protocols)

**Files:**
- Modify: `src/main/index.js`, `src/preload/index.js`, `src/renderer/src/App.jsx`, `electron-builder.yml`, `electron.vite.config.mjs`

- [ ] **Step 1: Register the protocol + rollup input**

In `electron-builder.yml`, add a top-level block:

```yaml
protocols:
  - name: Flux Terminal
    schemes:
      - flux
```

In `electron.vite.config.mjs`, in `rollupOptions.input`, after the `updater` line add:

```js
          deeplink: resolve('src/main/deeplink.js'),
```

- [ ] **Step 2: index.js — register client + route deep links**

In `src/main/index.js`:
- Require: `const { findDeepLink, parseDeepLink } = require('./deeplink')`.
- After the single-instance lock block, register the protocol:

```js
if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient('flux', process.execPath, [path.resolve(process.argv[1])])
} else {
  app.setAsDefaultProtocolClient('flux')
}
```

- Extend the existing `second-instance` handler to route a deep link (after focusing the window):

```js
app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  const route = findDeepLink(argv)
  if (route) emit('deeplink:open', route)
})
```

- macOS open-url (harmless on Windows): near the other `app.on(...)`:

```js
app.on('open-url', (e, url) => {
  e.preventDefault()
  const route = parseDeepLink(url)
  if (route) emit('deeplink:open', route)
})
```

- Cold-start: inside `whenReady`, after `createWindow()`, route any launch deep link once the renderer is loaded:

```js
  const launchRoute = findDeepLink(process.argv)
  if (launchRoute && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => emit('deeplink:open', launchRoute))
  }
```

- [ ] **Step 3: preload — onOpen**

In `src/preload/index.js`, add a `deeplink` bridge object:

```js
  deeplink: {
    onOpen: (cb) => {
      const listener = (_e, route) => cb(route)
      ipcRenderer.on('deeplink:open', listener)
      return () => ipcRenderer.removeListener('deeplink:open', listener)
    }
  },
```

- [ ] **Step 4: App — route deep links**

In `src/renderer/src/App.jsx`, add an effect (near the notify open-session effect):

```jsx
  useEffect(() => {
    return window.flux.deeplink.onOpen((route) => {
      if (route.route === 'session') openById(route.sessionId)
      else if (route.route === 'mission') setView('mission')
    })
  }, [openById])
```

- [ ] **Step 5: Verify build**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3`
Expected: build succeeds; `out/main/deeplink.js` emitted.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.js src/preload/index.js src/renderer/src/App.jsx electron-builder.yml electron.vite.config.mjs
git commit -m "feat(deeplink): register flux:// + route session/mission links

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: System tray + close-to-tray

**Files:**
- Create: `src/main/tray.js`
- Modify: `src/main/index.js`, `electron.vite.config.mjs`

- [ ] **Step 1: Create tray.js**

Create `src/main/tray.js`:

```js
// System tray with Show/Quit. Icon resolution falls back to a generated
// nativeImage so packaged builds (which don't ship build/) always have one.
const fs = require('fs')

// 16x16 pink dot — same data URL used for the taskbar overlay badge.
const FALLBACK_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAdklEQVR4nGP43L2CAQ0nfe5eseNz94q3n7tX/IfSO6Di6GoZkDkGn7tXnIRqwoVPQtVhGGCAZCMh/BbZEJgBhGzG5hK4AUkkaobhJJgBO8g0YAfMAGL9ji0swAaQoxmGqeMCisOA4ligOB1QJSVSnBeokhvJwgBc3NY+xPo8owAAAABJRU5ErkJggg=='

function resolveTrayImage(nativeImage, iconPath) {
  try {
    if (iconPath && fs.existsSync(iconPath)) return iconPath
  } catch {
    /* fall through */
  }
  return nativeImage.createFromDataURL(FALLBACK_ICON)
}

function createTray({ Tray, Menu, nativeImage, getWindow, onQuit, iconPath }) {
  const tray = new Tray(resolveTrayImage(nativeImage, iconPath))
  tray.setToolTip('Flux Terminal')
  const show = () => {
    const w = getWindow()
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Flux', click: show },
      { type: 'separator' },
      { label: 'Quit', click: () => onQuit() }
    ])
  )
  tray.on('click', show)
  return tray
}

module.exports = { createTray, resolveTrayImage }
```

- [ ] **Step 2: Rollup input**

In `electron.vite.config.mjs`, after the `deeplink` line add:

```js
          tray: resolve('src/main/tray.js'),
```

- [ ] **Step 3: index.js — create tray, close-to-tray, isQuitting**

In `src/main/index.js`:
- Require + electron bits: `const { createTray } = require('./tray')` and ensure `Tray, Menu` are imported from `electron` (add to the top `require('electron')` destructure: `Tray, Menu`).
- Add a module-level flag: `let isQuitting = false` and `let tray = null`.
- `app.on('before-quit', () => { isQuitting = true })`.
- In `createWindow`, add a close handler:

```js
  mainWindow.on('close', (e) => {
    if (!isQuitting && settingsStore && settingsStore.get().tray.closeToTray) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
```

- In `whenReady`, after `createWindow()` and after `settingsStore` exists, create the tray:

```js
  const iconPath = path.join(__dirname, '../../build/icon.ico')
  tray = createTray({
    Tray, Menu, nativeImage,
    getWindow: () => mainWindow,
    onQuit: () => { isQuitting = true; app.quit() },
    iconPath: fs.existsSync(iconPath) ? iconPath : null
  })
```

- [ ] **Step 4: Verify build**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3`
Expected: build succeeds; `out/main/tray.js` emitted.

- [ ] **Step 5: Commit**

```bash
git add src/main/tray.js src/main/index.js electron.vite.config.mjs
git commit -m "feat(tray): system tray (Show/Quit) + optional close-to-tray

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Settings UI — close-to-tray + push

**Files:**
- Modify: `src/renderer/src/components/settings/NotificationsSection.jsx`

- [ ] **Step 1: Add the controls**

In `src/renderer/src/components/settings/NotificationsSection.jsx`, before the final `Send test notification` button, add (reads `settings.tray`/`settings.push` via the same `update`):

```jsx
      <div className="set-sec-label">Background</div>
      <div className="set-row">
        <div className="set-row-l">
          <span className="set-row-name">Close to tray</span>
          <span className="set-row-desc">Keep Flux running in the tray when you close the window.</span>
        </div>
        <input type="checkbox" checked={!!(settings.tray && settings.tray.closeToTray)} onChange={(e) => update('tray.closeToTray', e.target.checked)} />
      </div>

      <div className="set-sec-label">Remote push (ntfy)</div>
      <div className="set-row">
        <div className="set-row-l">
          <span className="set-row-name">Enable push</span>
          <span className="set-row-desc">POST a message to a URL on needs-you events (error / blocked / usage).</span>
        </div>
        <input type="checkbox" checked={!!(settings.push && settings.push.enabled)} onChange={(e) => update('push.enabled', e.target.checked)} />
      </div>
      <div className="set-row">
        <div className="set-row-l"><span className="set-row-name">Push URL</span><span className="set-row-desc">e.g. https://ntfy.sh/your-topic</span></div>
        <input
          className="set-text"
          type="text"
          placeholder="https://ntfy.sh/your-topic"
          value={(settings.push && settings.push.url) || ''}
          onChange={(e) => update('push.url', e.target.value)}
        />
      </div>
```

- [ ] **Step 2: Style the text input (if not already present)**

In `src/renderer/src/index.css`, append (skip if `.set-text` already exists):

```css
.set-text { background: rgba(255,255,255,0.06); border: 1px solid var(--border, #2a2a2a); color: var(--text); border-radius: 6px; padding: 5px 8px; min-width: 240px; }
```

- [ ] **Step 3: Verify build + full suite**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3 && npm test 2>&1 | tail -5`
Expected: build succeeds; all tests pass (302 prior + 4 deeplink + 3 settings-push-tray + 3 notify-push = 312).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/settings/NotificationsSection.jsx src/renderer/src/index.css
git commit -m "feat(settings): close-to-tray toggle + ntfy push config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** parseDeepLink/findDeepLink → Task 1; settings push/tray + ntfy push helpers + Notifier post → Task 2; protocol register + deep-link routing + preload + App + electron-builder protocols → Task 3; tray.js + tray creation + close-to-tray → Task 4; settings UI → Task 5. Builds on #1's single-instance lock.

**Placeholder scan:** new modules + tests have full code; integration edits are exact with anchors.

**Type/name consistency:** `parseDeepLink`/`findDeepLink` used in main (Task 3) + tests; `shouldPush`/`buildPushMessage` exported from notify and used in Notifier + tests; `setPush`/`setTray` + `setByPath` routes match the UI's `update('push.*'/'tray.*')`; `createTray({Tray,Menu,nativeImage,...})` matches index.js's electron imports; rollup inputs `deeplink`/`tray` added.

**Notes for executor:** Tasks 1-2 independent; 3 depends on 1; 4 depends on 2 (reads `settings.tray`); 5 depends on 2 (settings) and is UI-only. Commit after each. Tray + protocol are Electron-API (build-verified, no unit tests); deeplink/push/settings are unit-tested. No push/tag — controller merges. Deep-link end-to-end only fully works after an installed build registers the protocol; dev registration via setAsDefaultProtocolClient is best-effort.
```
