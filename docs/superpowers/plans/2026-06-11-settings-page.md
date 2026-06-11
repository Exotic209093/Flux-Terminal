# Settings Page + Unified Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate Flux's scattered settings into one `settings.json` source of truth and a dedicated Settings page (left rail + content + search), with no startup theme-flash and a one-time migration of the existing `localStorage` prefs.

**Architecture:** The main-process `SettingsStore` gains an `appearance` section and becomes authoritative. The preload exposes the stored settings **synchronously** (`sendSync`) so the renderer can theme the first paint. A renderer `SettingsProvider`/`useSettings()` owns the live settings object and the `applyTheme` side-effect; the Settings page and the quick-access controls (sidebar theme dropdown, topbar model picker) all read/write through it. On first boot of this version a migration copies `localStorage` (`flux.theme/animations/model`) into the store.

**Tech Stack:** Electron (main `settings.js` + IPC), preload `contextBridge`, React 19 renderer (context + components), plain CSS, `node:test` for pure logic. No new dependencies.

---

## File Structure

- `src/main/settings.js` — **modify**: add `appearance` + `appearanceMigrated` to defaults, version-2 load-forward, `getAppearance`/`setAppearance`/`setMigrated`/`setByPath`.
- `src/main/index.js` — **modify**: construct the store + register `settings:getSync`/`settings:set`/`app:version` before `createWindow()`; add `FLUX_SMOKE_VIEW=settings` to the smoke harness.
- `src/preload/index.js` — **modify**: `settings.initial` (sync), `settings.set`, `app.version`.
- `src/renderer/src/lib/appearance.js` — **modify**: add pure `resolveMotion(animations, reducedMotion)` and `mergeLegacyAppearance(current, legacy)`.
- `src/renderer/src/lib/settings-context.jsx` — **create**: `SettingsProvider` + `useSettings`.
- `src/renderer/src/main.jsx` — **modify**: sync read + migration + pre-render `applyTheme` + wrap `<App>` in `<SettingsProvider>`.
- `src/renderer/src/App.jsx` — **modify**: consume `useSettings()` instead of local theme/animations/model state; add `view === 'settings'`; gear opens it.
- `src/renderer/src/components/ControlBar.jsx` — **modify**: gear calls `onOpenSettings`; remove the popover.
- `src/renderer/src/components/SettingsPopover.jsx` — **delete**.
- `src/renderer/src/components/SettingsPage.jsx` — **create**: shell (rail + search + content).
- `src/renderer/src/components/settings/registry.js` — **create**: categories + searchable entries + `filterSettings`.
- `src/renderer/src/components/settings/AppearanceSection.jsx`, `NotificationsSection.jsx`, `TerminalSection.jsx`, `ModelsSection.jsx`, `AboutSection.jsx` — **create**.
- `src/renderer/src/index.css` — **modify**: Settings page styles.
- `tests/settings.test.js` — **modify**; `tests/appearance.test.js` — **modify**; `tests/settings-registry.test.js` — **create**.

---

### Task 1: Store — appearance section, version 2, setters

**Files:**
- Modify: `src/main/settings.js`
- Test: `tests/settings.test.js`

- [ ] **Step 1: Read the current files** — Read `src/main/settings.js` and `tests/settings.test.js` to see the existing `DEFAULTS`, `_load`, and test style.

- [ ] **Step 2: Add failing tests** — Append to `tests/settings.test.js` (it uses `node:test` + `require('../src/main/settings.js')`):

```js
test('appearance defaults + version 2', () => {
  const { DEFAULTS } = require('../src/main/settings.js')
  assert.strictEqual(DEFAULTS.version, 2)
  assert.deepStrictEqual(DEFAULTS.appearance, { theme: 'midnight', animations: 'auto', model: null })
  assert.strictEqual(DEFAULTS.appearanceMigrated, false)
})

test('setAppearance validates and persists', (t) => {
  const os = require('os'); const path = require('path'); const fs = require('fs')
  const { SettingsStore } = require('../src/main/settings.js')
  const file = path.join(os.tmpdir(), 'flux-set-' + Math.random().toString(36).slice(2) + '.json')
  const s = new SettingsStore(file)
  s.setAppearance('theme', 'aurora')
  s.setAppearance('animations', 'off')
  s.setAppearance('model', 'claude-opus-4-8')
  assert.deepStrictEqual(s.get().appearance, { theme: 'aurora', animations: 'off', model: 'claude-opus-4-8' })
  assert.throws(() => s.setAppearance('animations', 'sometimes'))
  assert.throws(() => s.setAppearance('theme', ''))
  assert.throws(() => s.setAppearance('nope', 'x'))
  // reload from disk keeps the values
  const s2 = new SettingsStore(file)
  assert.strictEqual(s2.get().appearance.theme, 'aurora')
  fs.unlinkSync(file)
})

test('setByPath routes appearance/notify/appearanceMigrated', (t) => {
  const os = require('os'); const path = require('path'); const fs = require('fs')
  const { SettingsStore } = require('../src/main/settings.js')
  const file = path.join(os.tmpdir(), 'flux-set-' + Math.random().toString(36).slice(2) + '.json')
  const s = new SettingsStore(file)
  s.setByPath('appearance.theme', 'matrix')
  s.setByPath('notify.sound', true)
  s.setByPath('appearanceMigrated', true)
  const d = s.get()
  assert.strictEqual(d.appearance.theme, 'matrix')
  assert.strictEqual(d.notify.sound, true)
  assert.strictEqual(d.appearanceMigrated, true)
  assert.throws(() => s.setByPath('bogus.key', 1))
  fs.unlinkSync(file)
})

test('v1 file loads forward to v2 with default appearance', (t) => {
  const os = require('os'); const path = require('path'); const fs = require('fs')
  const { SettingsStore } = require('../src/main/settings.js')
  const file = path.join(os.tmpdir(), 'flux-v1-' + Math.random().toString(36).slice(2) + '.json')
  fs.writeFileSync(file, JSON.stringify({ version: 1, notify: { sound: true } }))
  const s = new SettingsStore(file)
  const d = s.get()
  assert.strictEqual(d.version, 2)
  assert.deepStrictEqual(d.appearance, { theme: 'midnight', animations: 'auto', model: null })
  assert.strictEqual(d.notify.sound, true) // existing notify preserved
  assert.strictEqual(d.appearanceMigrated, false)
  fs.unlinkSync(file)
})
```

- [ ] **Step 3: Run tests to verify they fail** — Run `npm test`. Expected: FAIL (version is 1, no `appearance`, no `setAppearance`/`setByPath`).

- [ ] **Step 4: Implement** — In `src/main/settings.js`:

Add constants near the top (after `EVENT_KEYS`):

```js
const ANIM_MODES = ['auto', 'on', 'off']
```

Change `DEFAULTS` to:

```js
const DEFAULTS = {
  version: 2,
  appearance: { theme: 'midnight', animations: 'auto', model: null },
  notify: {
    turnFinished: 'badge',
    turnError: 'toast',
    blocked: 'toast',
    usageThreshold: 'toast',
    sound: false,
    muted: false
  },
  profiles: DEFAULT_PROFILES,
  workspace: null,
  appearanceMigrated: false
}
```

In `_load`, after the `notify`/`profiles`/`workspace` merge block and before the closing of the `try`, add appearance + flag merge (so a v1 file loads forward — defaults already seeded by `this.data = clone(DEFAULTS)`):

```js
      if (parsed.appearance && typeof parsed.appearance === 'object') {
        const a = parsed.appearance
        if (typeof a.theme === 'string' && a.theme) this.data.appearance.theme = a.theme
        if (ANIM_MODES.includes(a.animations)) this.data.appearance.animations = a.animations
        if (typeof a.model === 'string' || a.model === null) this.data.appearance.model = a.model
      }
      if (typeof parsed.appearanceMigrated === 'boolean') this.data.appearanceMigrated = parsed.appearanceMigrated
```

Add methods inside the class (after `setNotify`):

```js
  getAppearance() {
    return clone(this.data.appearance)
  }

  setAppearance(key, value) {
    if (key === 'theme') {
      if (typeof value !== 'string' || !value) throw new Error('theme must be a non-empty string')
      this.data.appearance.theme = value
    } else if (key === 'animations') {
      if (!ANIM_MODES.includes(value)) throw new Error('invalid animations: ' + value)
      this.data.appearance.animations = value
    } else if (key === 'model') {
      if (value !== null && (typeof value !== 'string' || !value)) throw new Error('model must be a non-empty string or null')
      this.data.appearance.model = value
    } else {
      throw new Error('unknown appearance key: ' + key)
    }
    this._save()
    return this.get()
  }

  setMigrated(value) {
    this.data.appearanceMigrated = !!value
    this._save()
    return this.get()
  }

  // Dotted-path setter used by the generic settings:set IPC.
  setByPath(path, value) {
    const [section, key] = String(path).split('.')
    if (section === 'appearance') return this.setAppearance(key, value)
    if (section === 'notify') return this.setNotify(key, value)
    if (path === 'appearanceMigrated') return this.setMigrated(value)
    throw new Error('unknown settings path: ' + path)
  }
```

Update the `module.exports` to also export `ANIM_MODES`:

```js
module.exports = { SettingsStore, DEFAULTS, MODES, EVENT_KEYS, DEFAULT_PROFILES, ANIM_MODES }
```

- [ ] **Step 5: Run tests to verify they pass** — Run `npm test`. Expected: all PASS (existing + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/main/settings.js tests/settings.test.js
git commit -m "feat(settings): appearance section + version 2 + setByPath"
```

---

### Task 2: IPC + preload (synchronous initial settings)

**Files:**
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

No unit test (IPC glue; verified by build + later smoke).

- [ ] **Step 1: Read** — Read `src/main/index.js` around the existing `settings:*` handlers (~line 211) and the `app.whenReady` body (~line 486), plus `src/preload/index.js` settings block.

- [ ] **Step 2: Reorder store construction** — In `src/main/index.js` `app.whenReady().then(() => {`, MOVE the `settingsStore = new SettingsStore(...)` line so it runs **before** `createWindow()`. Result (top of the whenReady body):

```js
app.whenReady().then(() => {
  serveAppProtocol(protocol, path.join(__dirname, '../renderer'))
  settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'))
  createWindow()
  promptStore = new PromptStore(path.join(app.getPath('userData'), 'prompts.json'))
  promptStore.seed()
```

(Remove the later `settingsStore = new SettingsStore(...)` line that was after `createWindow()`.)

- [ ] **Step 3: Add IPC handlers** — In `src/main/index.js`, near the other `settings:*` handlers (top-level, around line 211), add:

```js
// Synchronous read so the preload can hand the renderer its settings before
// first paint (avoids a flash of the default theme). settingsStore is assigned
// before createWindow in whenReady, so it exists by the time this fires.
ipcMain.on('settings:getSync', (e) => {
  e.returnValue = settingsStore ? settingsStore.get() : null
})
ipcMain.handle('settings:set', (_e, { path, value }) => {
  if (!settingsStore) return { ok: false, error: 'no store' }
  try {
    return { ok: true, settings: settingsStore.setByPath(path, value) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
ipcMain.handle('app:version', () => app.getVersion())
```

- [ ] **Step 4: Add smoke-harness settings view** — In `src/main/index.js`, in the `FLUX_SMOKE_VIEW` chain inside the smoke block (after the `mission` branch), add:

```js
        } else if (process.env.FLUX_SMOKE_VIEW === 'settings') {
          await wc.executeJavaScript("document.querySelector('.settings-gear')?.click()")
```

- [ ] **Step 5: Expose in preload** — In `src/preload/index.js`, replace the `settings: { ... }` object with (adds `initial` + `set`, keeps the rest):

```js
  settings: {
    initial: ipcRenderer.sendSync('settings:getSync'),
    get: () => ipcRenderer.invoke('settings:get'),
    set: (path, value) => ipcRenderer.invoke('settings:set', { path, value }),
    setNotify: (key, value) => ipcRenderer.invoke('settings:setNotify', { key, value }),
    profiles: () => ipcRenderer.invoke('settings:profiles'),
    saveProfile: (p) => ipcRenderer.invoke('settings:saveProfile', p),
    deleteProfile: (id) => ipcRenderer.invoke('settings:deleteProfile', id),
    getWorkspace: () => ipcRenderer.invoke('settings:getWorkspace'),
    setWorkspace: (layout) => ipcRenderer.send('settings:setWorkspace', layout)
  },
  app: {
    version: () => ipcRenderer.invoke('app:version')
  },
```

(`ipcRenderer.sendSync('settings:getSync')` runs once at preload load; its value is a plain object frozen into `window.flux.settings.initial`.)

- [ ] **Step 6: Verify build** — Run `npm run build`. Expected: exit 0. Run `npm test` — still all green (no test changes).

- [ ] **Step 7: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat(settings): sync initial-settings IPC + settings:set + app:version"
```

---

### Task 3: Renderer pure helpers (resolveMotion, mergeLegacyAppearance)

**Files:**
- Modify: `src/renderer/src/lib/appearance.js`
- Test: `tests/appearance.test.js`

- [ ] **Step 1: Add failing tests** — Append to `tests/appearance.test.js`:

```js
test('resolveMotion: on/off explicit, auto follows reducedMotion', async () => {
  const { resolveMotion } = await import('../src/renderer/src/lib/appearance.js')
  assert.strictEqual(resolveMotion('on', true), true)
  assert.strictEqual(resolveMotion('off', false), false)
  assert.strictEqual(resolveMotion('auto', false), true)
  assert.strictEqual(resolveMotion('auto', true), false)
})

test('mergeLegacyAppearance: legacy localStorage wins where valid', async () => {
  const { mergeLegacyAppearance } = await import('../src/renderer/src/lib/appearance.js')
  const current = { theme: 'midnight', animations: 'auto', model: null }
  // legacy: theme set, animations '0' -> off, model set
  assert.deepStrictEqual(
    mergeLegacyAppearance(current, { theme: 'dracula', animations: '0', model: 'claude-opus-4-8' }),
    { theme: 'dracula', animations: 'off', model: 'claude-opus-4-8' }
  )
  // legacy animations '1' -> on; missing theme/model keep current
  assert.deepStrictEqual(
    mergeLegacyAppearance(current, { theme: null, animations: '1', model: null }),
    { theme: 'midnight', animations: 'on', model: null }
  )
  // no legacy at all -> unchanged copy
  assert.deepStrictEqual(mergeLegacyAppearance(current, { theme: null, animations: null, model: null }), current)
})
```

- [ ] **Step 2: Run tests to verify they fail** — Run `npm test`. Expected: FAIL (`resolveMotion`/`mergeLegacyAppearance` not exported).

- [ ] **Step 3: Implement** — Append to `src/renderer/src/lib/appearance.js`:

```js
// Tri-state animation pref -> concrete boolean. 'auto' follows the OS setting.
export function resolveMotion(animations, reducedMotion) {
  if (animations === 'on') return true
  if (animations === 'off') return false
  return !reducedMotion // 'auto'
}

// Merge legacy localStorage values into the stored appearance object. Legacy
// wins where present + valid. legacy = { theme, animations: '1'|'0'|null, model }.
export function mergeLegacyAppearance(current, legacy) {
  const out = { ...current }
  if (typeof legacy.theme === 'string' && legacy.theme) out.theme = legacy.theme
  if (legacy.animations === '1') out.animations = 'on'
  else if (legacy.animations === '0') out.animations = 'off'
  if (typeof legacy.model === 'string' && legacy.model) out.model = legacy.model
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass** — Run `npm test`. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/appearance.js tests/appearance.test.js
git commit -m "feat(settings): resolveMotion + mergeLegacyAppearance helpers"
```

---

### Task 4: SettingsProvider + useSettings

**Files:**
- Create: `src/renderer/src/lib/settings-context.jsx`

No unit test (React context/component; build + integration verified later).

- [ ] **Step 1: Create the provider** — Create `src/renderer/src/lib/settings-context.jsx`:

```jsx
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { applyTheme } from './themes'
import { resolveMotion, prefersReducedMotion } from './appearance'

const SettingsContext = createContext(null)

// `initial` is the already-migrated settings object (from main.jsx).
export function SettingsProvider({ initial, children }) {
  const [settings, setSettings] = useState(initial)

  // Single place that turns settings into the live theme + motion attributes.
  useEffect(() => {
    const a = settings.appearance
    applyTheme(a.theme, { motion: resolveMotion(a.animations, prefersReducedMotion()) })
  }, [settings.appearance.theme, settings.appearance.animations])

  // Optimistically update local state, then persist through main. If main
  // rejects, fall back to its authoritative copy.
  const update = useCallback((path, value) => {
    setSettings((prev) => applyPath(prev, path, value))
    window.flux.settings.set(path, value).then((res) => {
      if (res && res.ok) setSettings(res.settings)
    })
  }, [])

  return <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}

// Immutable dotted-path set for the two-level paths we use (e.g. appearance.theme,
// notify.sound) and the single key appearanceMigrated.
function applyPath(obj, path, value) {
  const parts = String(path).split('.')
  if (parts.length === 1) return { ...obj, [parts[0]]: value }
  const [section, key] = parts
  return { ...obj, [section]: { ...obj[section], [key]: value } }
}
```

- [ ] **Step 2: Verify build** — Run `npm run build`. Expected: exit 0 (component compiles; not yet rendered).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/settings-context.jsx
git commit -m "feat(settings): SettingsProvider + useSettings hook"
```

---

### Task 5: Cutover — migration in entry, wrap App, App consumes useSettings

**Files:**
- Modify: `src/renderer/src/main.jsx`
- Modify: `src/renderer/src/App.jsx`
- Modify: `src/renderer/src/components/ControlBar.jsx`

No unit test (integration; verified by build + smoke).

- [ ] **Step 1: Migration + provider in the entry** — Replace `src/renderer/src/main.jsx` with:

```jsx
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { SettingsProvider } from './lib/settings-context'
import { applyTheme } from './lib/themes'
import { resolveMotion, prefersReducedMotion, mergeLegacyAppearance } from './lib/appearance'
import './index.css'

// 1. Settings arrive synchronously from main (no flash).
const initial = window.flux.settings.initial || { appearance: { theme: 'midnight', animations: 'auto', model: null }, appearanceMigrated: true }

// 2. One-time migration from the old localStorage prefs.
let appearance = initial.appearance
if (!initial.appearanceMigrated) {
  const legacy = {
    theme: localStorage.getItem('flux.theme'),
    animations: localStorage.getItem('flux.animations'),
    model: localStorage.getItem('flux.model')
  }
  appearance = mergeLegacyAppearance(initial.appearance, legacy)
  window.flux.settings.set('appearance.theme', appearance.theme)
  window.flux.settings.set('appearance.animations', appearance.animations)
  window.flux.settings.set('appearance.model', appearance.model)
  window.flux.settings.set('appearanceMigrated', true)
  localStorage.removeItem('flux.theme')
  localStorage.removeItem('flux.animations')
  localStorage.removeItem('flux.model')
}

// 3. Theme the very first paint.
applyTheme(appearance.theme, { motion: resolveMotion(appearance.animations, prefersReducedMotion()) })

const seeded = { ...initial, appearance, appearanceMigrated: true }
createRoot(document.getElementById('root')).render(
  <SettingsProvider initial={seeded}>
    <App />
  </SettingsProvider>
)
```

- [ ] **Step 2: App consumes useSettings** — In `src/renderer/src/App.jsx`:

(a) Update imports: remove `applyTheme, loadTheme, saveTheme` from the themes import and remove the `loadAnimations, saveAnimations` / `ThemeBackground` appearance imports added previously for local state. Replace with:

```jsx
import ThemeBackground from './components/ThemeBackground'
import { useSettings } from './lib/settings-context'
import { resolveMotion, prefersReducedMotion } from './lib/appearance'
import { DEFAULT_MODEL, isKnownModel } from './lib/models'
```

(b) Remove these local-state blocks entirely: the `const [theme, setThemeState] = useState(loadTheme())` line, the `animations` state + `setAnimations` callback, the `model` state + `setModel` callback, the `setTheme` callback, and the `useEffect(() => { applyTheme(theme, { motion: animations }) }, [theme, animations])` effect.

(c) At the top of the component body add:

```jsx
  const { settings, update } = useSettings()
  const theme = settings.appearance.theme
  const animated = resolveMotion(settings.appearance.animations, prefersReducedMotion())
  const model = isKnownModel(settings.appearance.model) ? settings.appearance.model : DEFAULT_MODEL
  const setTheme = (t) => update('appearance.theme', t)
  const setModel = (m) => update('appearance.model', m)
  const [showSettings, setShowSettings] = useState(false) // replaced by view below; see step (e)
```

(Delete the throwaway `showSettings` line — it's covered by the `view` state. It's listed only so you don't add a duplicate. Use the `view` approach in Task 6.)

(d) `<ThemeBackground theme={theme} animated={animated} />` — already rendered as the shell's first child; keep it, now fed by the derived values.

(e) `<ControlBar ... />` — remove the `animations={...}` and `onToggleAnimations={...}` props; add `onOpenSettings={() => setView('settings')}`. Keep `model`/`onModel` (now from the store).

(f) `<Sidebar ... theme={theme} onTheme={setTheme} ... />` — unchanged interface (values now sourced from the store).

- [ ] **Step 3: ControlBar gear opens the page** — Replace `src/renderer/src/components/ControlBar.jsx` with:

```jsx
import { useState, useEffect } from 'react'
import ModelPicker from './ModelPicker'

// Topbar control cluster: model picker, running-subagent badge, remote-control
// toggle, and the settings gear (opens the Settings page).
export default function ControlBar({ model, onModel, agents, liveActive, onAgentsClick, ptyId, onOpenSettings }) {
  const [remoteOn, setRemoteOn] = useState(false)
  useEffect(() => {
    if (!liveActive) setRemoteOn(false)
  }, [liveActive])
  const toggleRemote = () => {
    if (!liveActive) return
    window.flux.pty.write(ptyId, '/remote-control\r')
    setRemoteOn((v) => !v)
  }
  const running = agents ? agents.running : 0
  return (
    <div className="control-bar">
      <ModelPicker model={model} onChange={onModel} />
      {running > 0 && (
        <button className="agents-badge" onClick={onAgentsClick} title="Running subagents — click to view">
          ▶ {running} agent{running === 1 ? '' : 's'}
        </button>
      )}
      <button
        className={'remote-toggle' + (remoteOn ? ' on' : '')}
        onClick={toggleRemote}
        disabled={!liveActive}
        title={
          liveActive
            ? "Send /remote-control to the live terminal (can't read true state)"
            : 'No live claude running in the terminal'
        }
      >
        ⊙ Remote{remoteOn ? ' on' : ''}
      </button>
      <button className="settings-gear" onClick={onOpenSettings} title="Settings">
        ⚙
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Verify build + smoke** — Run `npm run build` (exit 0) and `npm test` (green). Then kill stray electron and smoke the default view:

```powershell
Get-Process electron,"Flux Terminal" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$env:FLUX_SMOKE_SHOT="C:\tmp\flux-cutover.png"; & "node_modules\.bin\electron.cmd" . | Out-Null; Remove-Item Env:\FLUX_SMOKE_SHOT
```

Read `C:\tmp\flux-cutover.png`: the app must render with the correct theme (no flash), sidebar theme dropdown present, ⚙ gear present. Expected: renders normally; switching theme via the sidebar dropdown still works (the store now drives it).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/main.jsx src/renderer/src/App.jsx src/renderer/src/components/ControlBar.jsx
git commit -m "feat(settings): cut renderer over to the settings store + migration"
```

---

### Task 6: Settings page core — shell, registry, Appearance + Notifications, gear opens it

**Files:**
- Create: `src/renderer/src/components/SettingsPage.jsx`
- Create: `src/renderer/src/components/settings/registry.js`
- Create: `src/renderer/src/components/settings/AppearanceSection.jsx`
- Create: `src/renderer/src/components/settings/NotificationsSection.jsx`
- Delete: `src/renderer/src/components/SettingsPopover.jsx`
- Modify: `src/renderer/src/App.jsx` (render the page for `view === 'settings'`)
- Modify: `src/renderer/src/index.css`

No unit test (components; the registry's pure `filterSettings` is tested in Task 7). Verified via smoke.

- [ ] **Step 1: Registry** — Create `src/renderer/src/components/settings/registry.js`:

```js
import AppearanceSection from './AppearanceSection'
import NotificationsSection from './NotificationsSection'
import TerminalSection from './TerminalSection'
import ModelsSection from './ModelsSection'
import AboutSection from './AboutSection'

export const CATEGORIES = [
  { id: 'appearance', label: 'Appearance', icon: '🎨', Section: AppearanceSection },
  { id: 'notifications', label: 'Notifications', icon: '🔔', Section: NotificationsSection },
  { id: 'terminal', label: 'Terminal', icon: '⌨', Section: TerminalSection },
  { id: 'models', label: 'Models', icon: '◆', Section: ModelsSection },
  { id: 'about', label: 'About', icon: 'ℹ', Section: AboutSection }
]

// Flat searchable index — label + keywords per category, for the search box.
export const SEARCH_INDEX = [
  { category: 'appearance', label: 'Theme', keywords: 'theme color midnight aurora nebula synthwave matrix nord dracula' },
  { category: 'appearance', label: 'Background animation', keywords: 'animation motion reduced' },
  { category: 'notifications', label: 'Notification events', keywords: 'notify toast badge turn finished error blocked usage' },
  { category: 'notifications', label: 'Sound', keywords: 'sound beep' },
  { category: 'notifications', label: 'Mute', keywords: 'mute do not disturb dnd' },
  { category: 'terminal', label: 'Shell profiles', keywords: 'terminal shell profile powershell claude' },
  { category: 'models', label: 'Default model', keywords: 'model opus sonnet haiku fable' },
  { category: 'about', label: 'About Flux', keywords: 'version about github' }
]

// Pure: returns the category ids whose label or any entry matches the query.
export function filterSettings(query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return CATEGORIES.map((c) => c.id)
  const hits = new Set()
  for (const c of CATEGORIES) if (c.label.toLowerCase().includes(q)) hits.add(c.id)
  for (const e of SEARCH_INDEX) {
    if (e.label.toLowerCase().includes(q) || e.keywords.includes(q)) hits.add(e.category)
  }
  return CATEGORIES.filter((c) => hits.has(c.id)).map((c) => c.id)
}
```

- [ ] **Step 2: AppearanceSection** — Create `src/renderer/src/components/settings/AppearanceSection.jsx`:

```jsx
import { useSettings } from '../../lib/settings-context'
import { THEMES } from '../../lib/themes'

const ANIM = [
  ['auto', 'Auto'],
  ['on', 'On'],
  ['off', 'Off']
]

export default function AppearanceSection() {
  const { settings, update } = useSettings()
  const a = settings.appearance
  return (
    <div>
      <div className="set-h">Appearance</div>
      <div className="set-sub">Theme, motion, and how Flux looks.</div>

      <div className="set-sec-label">Theme</div>
      <div className="set-swatches">
        {Object.entries(THEMES).map(([key, t]) => (
          <button
            key={key}
            className={'set-sw' + (a.theme === key ? ' active' : '')}
            onClick={() => update('appearance.theme', key)}
          >
            <span className="set-sw-prev" style={{ background: t.vars['--bg'] }}>
              <span style={{ color: t.vars['--accent'] }}>⚡</span>
            </span>
            <span className="set-sw-name">{t.name}</span>
          </button>
        ))}
      </div>

      <div className="set-sec-label">Motion</div>
      <div className="set-row">
        <div className="set-row-l">
          <span className="set-row-name">Background animation</span>
          <span className="set-row-desc">Animated theme backgrounds. Auto follows your OS reduced-motion setting.</span>
        </div>
        <div className="set-seg">
          {ANIM.map(([val, lbl]) => (
            <button
              key={val}
              className={'set-seg-btn' + (a.animations === val ? ' on' : '')}
              onClick={() => update('appearance.animations', val)}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: NotificationsSection** — Create `src/renderer/src/components/settings/NotificationsSection.jsx`:

```jsx
import { useSettings } from '../../lib/settings-context'

const ROWS = [
  ['turnFinished', 'Turn finished (long)'],
  ['turnError', 'Error / failed'],
  ['blocked', 'Blocked / waiting'],
  ['usageThreshold', 'Usage limit ≥ 90%']
]
const MODES = ['toast', 'badge', 'off']

export default function NotificationsSection() {
  const { settings, update } = useSettings()
  const n = settings.notify
  return (
    <div>
      <div className="set-h">Notifications</div>
      <div className="set-sub">How Flux alerts you about background sessions.</div>

      <div className="set-row">
        <div className="set-row-l">
          <span className="set-row-name">Mute all</span>
          <span className="set-row-desc">Do not disturb — suppress every notification.</span>
        </div>
        <input type="checkbox" checked={!!n.muted} onChange={(e) => update('notify.muted', e.target.checked)} />
      </div>

      <div className="set-sec-label">Per event</div>
      {ROWS.map(([key, label]) => (
        <div className="set-row" key={key}>
          <div className="set-row-l"><span className="set-row-name">{label}</span></div>
          <div className="set-seg">
            {MODES.map((m) => (
              <button key={m} className={'set-seg-btn' + (n[key] === m ? ' on' : '')} onClick={() => update('notify.' + key, m)}>
                {m}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="set-row">
        <div className="set-row-l"><span className="set-row-name">Play a sound</span></div>
        <input type="checkbox" checked={!!n.sound} onChange={(e) => update('notify.sound', e.target.checked)} />
      </div>

      <button className="set-test-btn" onClick={() => window.flux.notify.test()}>Send test notification</button>
    </div>
  )
}
```

- [ ] **Step 4: Stub the other three sections** — So the registry imports resolve, create minimal versions now (fully built in Task 7). Create `TerminalSection.jsx`, `ModelsSection.jsx`, `AboutSection.jsx` each as:

`src/renderer/src/components/settings/TerminalSection.jsx`:
```jsx
export default function TerminalSection() {
  return (<div><div className="set-h">Terminal</div><div className="set-sub">Coming up in this build.</div></div>)
}
```
`src/renderer/src/components/settings/ModelsSection.jsx`:
```jsx
export default function ModelsSection() {
  return (<div><div className="set-h">Models</div><div className="set-sub">Coming up in this build.</div></div>)
}
```
`src/renderer/src/components/settings/AboutSection.jsx`:
```jsx
export default function AboutSection() {
  return (<div><div className="set-h">About</div><div className="set-sub">Coming up in this build.</div></div>)
}
```

- [ ] **Step 5: SettingsPage shell** — Create `src/renderer/src/components/SettingsPage.jsx`:

```jsx
import { useState } from 'react'
import { CATEGORIES, filterSettings } from './settings/registry'

export default function SettingsPage() {
  const [active, setActive] = useState('appearance')
  const [query, setQuery] = useState('')
  const visible = filterSettings(query)
  const current = CATEGORIES.find((c) => c.id === active) || CATEGORIES[0]
  const Section = current.Section
  return (
    <div className="settings-page">
      <div className="settings-rail">
        <div className="settings-rail-title">⚙ Settings</div>
        <input
          className="settings-search"
          placeholder="Search settings…"
          value={query}
          onChange={(e) => {
            const v = e.target.value
            setQuery(v)
            const vis = filterSettings(v)
            if (vis.length && !vis.includes(active)) setActive(vis[0])
          }}
        />
        {CATEGORIES.filter((c) => visible.includes(c.id)).map((c) => (
          <button
            key={c.id}
            className={'settings-nav' + (active === c.id ? ' active' : '')}
            onClick={() => setActive(c.id)}
          >
            <span className="settings-nav-icon">{c.icon}</span> {c.label}
          </button>
        ))}
      </div>
      <div className="settings-content">
        <Section />
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Render it from App + delete the popover** — In `src/renderer/src/App.jsx`: add the import `import SettingsPage from './components/SettingsPage'`, and add a pane-slot block alongside the other views:

```jsx
        {view === 'settings' && (
          <div className="pane-slot">
            <SettingsPage />
          </div>
        )}
```

Also add a Ctrl+, shortcut in the existing keydown effect (next to the Ctrl+M handler):

```jsx
      } else if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        setView((v) => (v === 'settings' ? 'terminal' : 'settings'))
```

Delete the file `src/renderer/src/components/SettingsPopover.jsx` (`git rm`). Confirm nothing else imports it (`ControlBar` no longer does after Task 5).

- [ ] **Step 7: CSS** — Append to `src/renderer/src/index.css`:

```css
/* ---- Settings page ------------------------------------------------------ */
.settings-page { flex: 1; min-height: 0; display: flex; background: var(--bg); }
.settings-rail { width: 220px; flex: none; background: var(--bg-panel); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; padding: 14px 10px; gap: 3px; overflow-y: auto; }
.settings-rail-title { font-size: 15px; font-weight: 800; padding: 4px 8px 10px; }
.settings-search { margin: 0 4px 10px; padding: 7px 10px; font-size: 12px; color: var(--text);
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: 7px; outline: none; }
.settings-search:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-glow); }
.settings-nav { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: 7px;
  background: none; border: 1px solid transparent; color: var(--text-dim); font: inherit; font-size: 13px;
  text-align: left; cursor: pointer; }
.settings-nav:hover { background: var(--bg-hover); color: var(--text); }
.settings-nav.active { background: var(--bg-elev); color: var(--text); border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-glow); }
.settings-nav-icon { width: 18px; text-align: center; }
.settings-content { flex: 1; min-width: 0; overflow-y: auto; padding: 24px 28px 48px; }

.set-h { font-size: 20px; font-weight: 800; margin-bottom: 4px; }
.set-sub { color: var(--text-dim); font-size: 12px; margin-bottom: 20px; }
.set-sec-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--text-dim); margin: 20px 0 10px; }
.set-row { display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 11px 14px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: 9px; margin-bottom: 8px; }
.set-row-l { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.set-row-name { color: var(--text); font-weight: 600; }
.set-row-desc { color: var(--text-faint); font-size: 11px; }
.set-swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.set-sw { display: flex; flex-direction: column; padding: 0; overflow: hidden; cursor: pointer;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 9px; }
.set-sw.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-glow); }
.set-sw-prev { height: 44px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
.set-sw-name { font-size: 11px; padding: 5px 8px; color: var(--text); text-align: left; }
.set-seg { display: inline-flex; border: 1px solid var(--border); border-radius: 7px; overflow: hidden; flex: none; }
.set-seg-btn { background: none; border: none; color: var(--text-faint); font: inherit; font-size: 11px;
  padding: 5px 12px; cursor: pointer; }
.set-seg-btn.on { background: var(--accent); color: var(--bg); font-weight: 700; }
.set-test-btn { margin-top: 14px; background: var(--accent); color: var(--bg); border: none; border-radius: 7px;
  padding: 8px 14px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.set-test-btn:hover { filter: brightness(1.08); }
```

- [ ] **Step 8: Build + smoke** — `npm run build` (exit 0), `npm test` (green). Then:

```powershell
Get-Process electron,"Flux Terminal" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$env:FLUX_SMOKE_VIEW="settings"; $env:FLUX_SMOKE_SHOT="C:\tmp\flux-settings.png"; & "node_modules\.bin\electron.cmd" . | Out-Null; Remove-Item Env:\FLUX_SMOKE_VIEW,Env:\FLUX_SMOKE_SHOT
```

Read `C:\tmp\flux-settings.png`: confirm the Settings page opens (gear click), left rail with 5 categories + search, Appearance content with theme swatches + Auto/On/Off segment. Expected: renders correctly.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/SettingsPage.jsx src/renderer/src/components/settings/ src/renderer/src/App.jsx src/renderer/src/index.css
git rm src/renderer/src/components/SettingsPopover.jsx
git commit -m "feat(settings): Settings page shell + Appearance/Notifications + gear opens it"
```

---

### Task 7: Remaining sections + search test

**Files:**
- Modify: `src/renderer/src/components/settings/TerminalSection.jsx`
- Modify: `src/renderer/src/components/settings/ModelsSection.jsx`
- Modify: `src/renderer/src/components/settings/AboutSection.jsx`
- Test: `tests/settings-registry.test.js`

- [ ] **Step 1: filterSettings test** — Create `tests/settings-registry.test.js`. The registry imports `.jsx` section files, which `node:test` can't load. Test the pure logic by importing only the function — to keep it importable, the test imports the module and exercises `filterSettings` (the `.jsx` imports are inert in Node only if they don't execute React; they do `import X from './X'` which Node can't parse). **Therefore:** put `filterSettings`, `CATEGORIES` metadata (id/label/icon — without `Section`), and `SEARCH_INDEX` in a separate pure file `registry-data.js` and have `registry.js` import the section components and re-export, attaching `Section`. Refactor:

Create `src/renderer/src/components/settings/registry-data.js`:
```js
export const CATEGORY_META = [
  { id: 'appearance', label: 'Appearance', icon: '🎨' },
  { id: 'notifications', label: 'Notifications', icon: '🔔' },
  { id: 'terminal', label: 'Terminal', icon: '⌨' },
  { id: 'models', label: 'Models', icon: '◆' },
  { id: 'about', label: 'About', icon: 'ℹ' }
]

export const SEARCH_INDEX = [
  { category: 'appearance', label: 'Theme', keywords: 'theme color midnight aurora nebula synthwave matrix nord dracula' },
  { category: 'appearance', label: 'Background animation', keywords: 'animation motion reduced' },
  { category: 'notifications', label: 'Notification events', keywords: 'notify toast badge turn finished error blocked usage' },
  { category: 'notifications', label: 'Sound', keywords: 'sound beep' },
  { category: 'notifications', label: 'Mute', keywords: 'mute do not disturb dnd' },
  { category: 'terminal', label: 'Shell profiles', keywords: 'terminal shell profile powershell claude' },
  { category: 'models', label: 'Default model', keywords: 'model opus sonnet haiku fable' },
  { category: 'about', label: 'About Flux', keywords: 'version about github' }
]

export function filterSettings(query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return CATEGORY_META.map((c) => c.id)
  const hits = new Set()
  for (const c of CATEGORY_META) if (c.label.toLowerCase().includes(q)) hits.add(c.id)
  for (const e of SEARCH_INDEX) {
    if (e.label.toLowerCase().includes(q) || e.keywords.includes(q)) hits.add(e.category)
  }
  return CATEGORY_META.filter((c) => hits.has(c.id)).map((c) => c.id)
}
```

Rewrite `registry.js` to compose meta + sections:
```js
import { CATEGORY_META, filterSettings } from './registry-data'
import AppearanceSection from './AppearanceSection'
import NotificationsSection from './NotificationsSection'
import TerminalSection from './TerminalSection'
import ModelsSection from './ModelsSection'
import AboutSection from './AboutSection'

const SECTIONS = { appearance: AppearanceSection, notifications: NotificationsSection,
  terminal: TerminalSection, models: ModelsSection, about: AboutSection }

export const CATEGORIES = CATEGORY_META.map((c) => ({ ...c, Section: SECTIONS[c.id] }))
export { filterSettings }
```

`SettingsPage.jsx`'s imports (`CATEGORIES, filterSettings` from `./settings/registry`) still resolve — no change needed there.

Test file `tests/settings-registry.test.js`:
```js
const test = require('node:test')
const assert = require('node:assert')

test('filterSettings: empty query returns all categories in order', async () => {
  const { filterSettings, CATEGORY_META } = await import('../src/renderer/src/components/settings/registry-data.js')
  assert.deepStrictEqual(filterSettings(''), CATEGORY_META.map((c) => c.id))
  assert.deepStrictEqual(filterSettings('   '), CATEGORY_META.map((c) => c.id))
})

test('filterSettings: matches category label and keywords', async () => {
  const { filterSettings } = await import('../src/renderer/src/components/settings/registry-data.js')
  assert.deepStrictEqual(filterSettings('theme'), ['appearance'])
  assert.deepStrictEqual(filterSettings('sound'), ['notifications'])
  assert.deepStrictEqual(filterSettings('model'), ['models'])
  assert.deepStrictEqual(filterSettings('zzzz'), [])
})
```

- [ ] **Step 2: Run test to verify it fails** — Run `npm test`. Expected: FAIL (`registry-data.js` doesn't exist yet).

- [ ] **Step 3: Create `registry-data.js` and refactor `registry.js`** as shown in Step 1.

- [ ] **Step 4: Run test to verify it passes** — Run `npm test`. Expected: PASS.

- [ ] **Step 5: TerminalSection** — Replace `src/renderer/src/components/settings/TerminalSection.jsx`:

```jsx
import { useState, useEffect } from 'react'

// Shell profiles live in main (settings.json) and are managed via window.flux.settings.
export default function TerminalSection() {
  const [profiles, setProfiles] = useState([])
  const refresh = () => window.flux.settings.profiles().then(setProfiles)
  useEffect(() => { refresh() }, [])

  const add = async () => {
    await window.flux.settings.saveProfile({ name: 'New profile', shell: null, args: [], cwd: null })
    refresh()
  }
  const rename = async (p, name) => { await window.flux.settings.saveProfile({ ...p, name }); refresh() }
  const del = async (id) => { await window.flux.settings.deleteProfile(id); refresh() }

  return (
    <div>
      <div className="set-h">Terminal</div>
      <div className="set-sub">Shell profiles available in the terminal tab launcher.</div>
      <div className="set-sec-label">Profiles</div>
      {profiles.map((p) => (
        <div className="set-row" key={p.id}>
          <input
            className="settings-search"
            style={{ margin: 0, flex: 1 }}
            value={p.name}
            onChange={(e) => rename(p, e.target.value)}
          />
          <button className="set-seg-btn" onClick={() => del(p.id)} title="Delete profile">✕</button>
        </div>
      ))}
      <button className="set-test-btn" onClick={add}>+ Add profile</button>
    </div>
  )
}
```

- [ ] **Step 6: ModelsSection** — Replace `src/renderer/src/components/settings/ModelsSection.jsx`:

```jsx
import { useSettings } from '../../lib/settings-context'
import { MODELS, DEFAULT_MODEL, isKnownModel } from '../../lib/models'

export default function ModelsSection() {
  const { settings, update } = useSettings()
  const current = isKnownModel(settings.appearance.model) ? settings.appearance.model : DEFAULT_MODEL
  return (
    <div>
      <div className="set-h">Models</div>
      <div className="set-sub">The model new chats and sends use by default.</div>
      <div className="set-row">
        <div className="set-row-l">
          <span className="set-row-name">Default model</span>
          <span className="set-row-desc">Also changeable from the topbar picker.</span>
        </div>
        <select
          className="settings-search"
          style={{ margin: 0 }}
          value={current}
          onChange={(e) => update('appearance.model', e.target.value)}
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: AboutSection** — Replace `src/renderer/src/components/settings/AboutSection.jsx`:

```jsx
import { useState, useEffect } from 'react'

export default function AboutSection() {
  const [version, setVersion] = useState('')
  useEffect(() => { window.flux.app.version().then(setVersion) }, [])
  return (
    <div>
      <div className="set-h">About</div>
      <div className="set-sub">Flux Terminal — a desktop home for Claude Code sessions.</div>
      <div className="set-row">
        <div className="set-row-l"><span className="set-row-name">Version</span></div>
        <span className="set-row-desc">{version || '…'}</span>
      </div>
      <div className="set-row">
        <div className="set-row-l"><span className="set-row-name">Repository</span></div>
        <span className="set-row-desc">github.com/Exotic209093/Flux-Terminal</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Build + smoke each category** — `npm run build` (exit 0), `npm test` (green). Then screenshot the page (it opens on Appearance; Terminal/Models/About are reachable by clicking the rail — capture is fine on Appearance, and you can click via the harness if desired):

```powershell
Get-Process electron,"Flux Terminal" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$env:FLUX_SMOKE_VIEW="settings"; $env:FLUX_SMOKE_SHOT="C:\tmp\flux-settings2.png"; & "node_modules\.bin\electron.cmd" . | Out-Null; Remove-Item Env:\FLUX_SMOKE_VIEW,Env:\FLUX_SMOKE_SHOT
```

Read `C:\tmp\flux-settings2.png` and confirm the page renders with all five categories in the rail. Expected: renders.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/settings/ tests/settings-registry.test.js
git commit -m "feat(settings): Terminal/Models/About sections + searchable registry"
```

---

### Task 8: Verify end-to-end (tests, build, migration, per-category)

**Files:** none (verification only)

- [ ] **Step 1: Tests + build** — Run `npm test` (all green) and `npm run build` (exit 0).

- [ ] **Step 2: Migration check** — Simulate a legacy user: launch the built app once with a forced legacy localStorage value, then confirm it lands in the store. From the project root:

```powershell
Get-Process electron,"Flux Terminal" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
# seed a legacy theme into the built renderer's localStorage by injecting before load is hard;
# instead verify the store path directly:
Get-Content "$env:APPDATA\flux-terminal\settings.json" -ErrorAction SilentlyContinue
```

Then launch normally, switch theme to "Aurora" via the Settings page, relaunch, and confirm `settings.json` shows `appearance.theme: "aurora"` and the app boots into Aurora with no flash. (The clean-install path is the common case; the localStorage→store migration is exercised for anyone upgrading.)

- [ ] **Step 3: Per-category visual** — Launch the built app, open Settings (⚙ or Ctrl+,), click through Appearance / Notifications / Terminal / Models / About, and confirm each renders and edits persist across a relaunch. Capture a screenshot of at least Appearance + Notifications:

```powershell
Get-Process electron,"Flux Terminal" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$env:FLUX_SMOKE_VIEW="settings"; $env:FLUX_SMOKE_SHOT="C:\tmp\flux-settings-final.png"; & "node_modules\.bin\electron.cmd" . | Out-Null; Remove-Item Env:\FLUX_SMOKE_VIEW,Env:\FLUX_SMOKE_SHOT
```

Read the screenshot to confirm. Expected: Settings page renders; theme switching from the page works and persists.

- [ ] **Step 4: Final commit (only if a tuning fix was needed)**

```bash
git add -A
git commit -m "fix(settings): tuning from verification"
```

---

## Self-Review

- **Spec coverage:** dedicated page + left rail + search (Task 6) ✓; 5 categories (Tasks 6–7) ✓; `settings.json` single source of truth with `appearance` + version 2 (Task 1) ✓; synchronous initial settings, no flash (Tasks 2, 5) ✓; one-time localStorage→store migration (Tasks 3, 5) ✓; `SettingsProvider`/`useSettings` (Task 4) ✓; gear opens page, popover retired, quick-access kept (Task 5) ✓; tri-state animation Auto/On/Off (Tasks 1, 6) ✓; app version in About (Tasks 2, 7) ✓; unit tests for store + helpers + search-filter, smoke for the page (Tasks 1, 3, 7, 8) ✓.
- **Placeholder scan:** none — every step has complete code. (Task 6 deliberately ships stub sections that Task 7 replaces; both are full files, not placeholders, so the build stays green between commits.)
- **Type/name consistency:** `setByPath(path,value)` (Task 1) ↔ `settings:set { path, value }` (Task 2) ↔ preload `set(path,value)` (Task 2) ↔ `update(path,value)`→`applyPath` (Task 4) ↔ section calls `update('appearance.theme', …)` / `update('notify.sound', …)` (Tasks 6–7) — all use the same dotted-path convention. `resolveMotion`/`mergeLegacyAppearance` defined in Task 3, used in Tasks 4–5. `window.flux.settings.initial`/`set`, `window.flux.app.version` defined in Task 2, used in Tasks 5/7. `filterSettings`/`CATEGORIES` defined in Tasks 6–7 and consumed by `SettingsPage`.
- **Spec deviation noted:** `mergeLegacyAppearance` lives in the renderer `lib/appearance.js` (Task 3), not main `settings.js` as the spec text said — the migration runs renderer-side and can't import main code. Functionally identical.
- **Sequencing safety:** every task leaves the app building and tests green. The risky cutover (Task 5) is one cohesive commit; the Settings page lands with working stub sections (Task 6) before they're fleshed out (Task 7).
```
