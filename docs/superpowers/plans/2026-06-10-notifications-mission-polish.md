# Notifications & Mission Control Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the A/B features trustworthy and inspectable — validated error detection, a test button + mute, an in-memory notification history with a topbar bell, and Mission Control cards with exact cost + filter + refresh.

**Architecture:** Additive changes to `notify.js` (history ring + `test()` + mute), `settings.js` (`muted`), `monitor.js`/`missioncontrol.js` (carry `usage`, drop the coarse cost), `index.js`/preload (test + history IPC), and the renderer (settings popover, new `NotificationBell`, Mission Control filter/refresh/exact-cost). Thresholds stay fixed; history is in-memory.

**Tech Stack:** Electron 42 main/preload + React renderer, Node built-in test runner, existing `pricing.js` (`estimateCost`/`formatUSD`).

---

## As-landed facts

- `notify.js` exports `{ Notifier, titleFor, COALESCE_MS, EVENT_SETTING }`. `Notifier` ctor opts: `getWindow, getSettings, getOpenSessionId, NotificationImpl, beep, now`. `deliver(notice)` does: mode lookup (off→return) → suppression → coalesce → `_toast`/`_badge` → sound. `titleFor(notice)` returns `{title, body}`.
- `settings.js`: `DEFAULTS = { version, notify:{turnFinished,turnError,blocked,usageThreshold,sound} }`; `setNotify(key,value)` accepts `sound` (boolean) + the four event keys (mode strings); `get()` clones. Exports `{ SettingsStore, DEFAULTS, MODES, EVENT_KEYS, DEFAULT_PROFILES }`.
- `monitor.js`: per-session record has `costUsd` (from `estimateCostUsd(usage, model)`); exports include `estimateCostUsd`. The record already parses `parsed.usage`.
- `missioncontrol.js`: `composeCards(records, now)` → card DTO with `costUsd`, `model`, `subagents`, `lastSnippet`, `lastActivityMs`, `status`, `group`, etc.; `cardsChanged(prev,next)` compares `sessionId/status/costUsd/subagents.running/lastSnippet`.
- `MissionCard.jsx` renders `$${card.costUsd.toFixed(2)}` + `card.model`.
- Renderer `src/renderer/src/lib/pricing.js` exports `estimateCost(usage, model)` → `{ total, ... }` and `formatUSD(n)` (used by `LivePanel`).
- App.jsx already has `window.flux.notify.onOpenSession(cb)` wired to `openSession`, and reports the open session via `notify.setOpenSession`.
- Real error shape (validated against `~/.claude/projects`): `{ type:'assistant', isApiErrorMessage:true, message:{ model:'<synthetic>', content:[{type:'text', text:'API Error…'}] } }`. The top-level `isApiErrorMessage===true` is the discriminator (a `<synthetic>` model alone is NOT an error). Tool-level `is_error:true` (on `tool_result`) must NOT count.
- Renderer has NO component unit tests; verify components by build + dev smoke (against `npm run dev` — `file://` build renders blank). Smoke pattern: stop electron, `Set-Location "C:\Users\james\Projects\Flux Terminal"; $env:FLUX_SMOKE_SHOT="C:\tmp\<n>.png"; npm run dev 2>&1 | Select-String "FLUX_SMOKE|App threw|Cannot"; Remove-Item Env:FLUX_SMOKE_SHOT`. Look at the PNG.

---

## File Structure

**Modified (main):** `parser.js` (error-shape test only), `notify.js` (history/test/mute/wording), `settings.js` (muted), `monitor.js` (usage in record, drop estimateCostUsd), `missioncontrol.js` (usage in card, token-based cardsChanged), `index.js` (IPC + onHistory wiring), `preload/index.js` (notify.test/history bridge).
**Modified (renderer):** `SettingsPopover.jsx` (test + mute), `MissionControl.jsx` + `MissionCard.jsx` (filter/refresh/exact cost), `App.jsx` (bell + history wiring), `index.css`.
**New (renderer):** `components/NotificationBell.jsx`.
**Tests:** extend `tests/parser-errors.test.js`, `tests/notify.test.js`, `tests/settings.test.js` (or settings-profiles), `tests/missioncontrol.test.js`.

**Shippable checkpoints:** end of Phase 5 = test button + mute + history backend usable; end of Phase 8 = full polish.

---

## Phase 1 — Validate error detection (real-shape test)

### Task 1: lock `isErrorRecord` with the real API-error shape

**Files:** Modify `tests/parser-errors.test.js`; (only touch `src/main/parser.js` IF a new real marker is needed — likely not).

- [ ] **Step 1: Add a real-shape test** to `tests/parser-errors.test.js`:

```js
test('isErrorRecord matches a real API-error assistant record but NOT a synthetic non-error or a tool error', () => {
  const { isErrorRecord } = require('../src/main/parser')
  // Real shape observed in ~/.claude/projects: top-level isApiErrorMessage flag.
  const apiError = {
    type: 'assistant',
    isApiErrorMessage: true,
    message: { model: '<synthetic>', content: [{ type: 'text', text: 'API Error: Overloaded' }] }
  }
  const syntheticNonError = {
    type: 'assistant',
    isApiErrorMessage: false,
    message: { model: '<synthetic>', content: [{ type: 'text', text: 'No response requested.' }] }
  }
  const toolError = { type: 'user', message: { content: [{ type: 'tool_result', is_error: true }] } }
  assert.strictEqual(isErrorRecord(apiError), true)
  assert.strictEqual(isErrorRecord(syntheticNonError), false) // <synthetic> alone is not an error
  assert.strictEqual(isErrorRecord(toolError), false) // tool errors are not turn errors
})
```

- [ ] **Step 2: Run** — `node --test tests/parser-errors.test.js`. Expected: PASS with the EXISTING `isErrorRecord` (the `o.isApiErrorMessage === true` marker already matches `apiError`; `toolError` has no top-level `is_error`/`isApiErrorMessage` so it's correctly false). If it unexpectedly fails, adjust `isErrorRecord` minimally and report what real shape required it.

- [ ] **Step 3: Commit**

```bash
git add tests/parser-errors.test.js
git commit -F- <<'EOF'
test(parser): lock isErrorRecord against the real API-error record shape

Validated against ~/.claude/projects: top-level isApiErrorMessage:true is
the real discriminator; <synthetic> model alone and tool-level is_error are
correctly not flagged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Phase 2 — notify.js: history + test + mute + wording

### Task 2: extend `Notifier`

**Files:** Modify `src/main/notify.js`; Test: extend `tests/notify.test.js`.

- [ ] **Step 1: Add failing tests** to `tests/notify.test.js` (append; reuse the existing `world()`/`makeNotifier()` helpers — but those don't pass `onHistory`, so add a dedicated factory in the new tests):

```js
test('records delivered notices to a bounded history (newest first) and fires onHistory', () => {
  const w = world()
  const hist = []
  const n = new Notifier({
    getWindow: () => w.win, getSettings: () => w.settings, getOpenSessionId: () => w.openId,
    NotificationImpl: fakeNotificationFactory(w.sink), beep: () => {}, now: () => w.now,
    onHistory: (e) => hist.push(e)
  })
  n.deliver({ sessionId: 's1', title: 'A', event: { type: 'turn:error' } })
  w.now = 20000
  n.deliver({ sessionId: 's2', title: 'B', event: { type: 'turn:finished' } })
  const h = n.getHistory()
  assert.strictEqual(h.length, 2)
  assert.strictEqual(h[0].sessionId, 's2') // newest first
  assert.strictEqual(h[0].mode, 'badge') // turn:finished default = badge
  assert.strictEqual(h[1].mode, 'toast') // turn:error default = toast
  assert.strictEqual(hist.length, 2) // onHistory fired per delivery
})

test('history is bounded to MAX_HISTORY', () => {
  const { Notifier, MAX_HISTORY } = require('../src/main/notify')
  const w = world()
  const n = new Notifier({ getWindow: () => w.win, getSettings: () => w.settings, getOpenSessionId: () => w.openId, NotificationImpl: fakeNotificationFactory(w.sink), beep: () => {}, now: () => w.now })
  for (let i = 0; i < MAX_HISTORY + 10; i++) { w.now = i * 20000; n.deliver({ sessionId: 's' + i, title: 't', event: { type: 'turn:error' } }) }
  assert.strictEqual(n.getHistory().length, MAX_HISTORY)
})

test('muted short-circuits delivery (no toast/badge/history)', () => {
  const w = world()
  w.settings.notify.muted = true
  const n = makeNotifier(w)
  n.deliver({ sessionId: 's', title: 'x', event: { type: 'turn:error' } })
  assert.strictEqual(w.sink.shown.length, 0)
  assert.strictEqual(w.win.overlay, null)
  assert.strictEqual(n.getHistory().length, 0)
})

test('test() always shows a toast bypassing mute/suppression/coalescing and records mode test', () => {
  const w = world()
  w.settings.notify.muted = true
  w.win.focused = true
  w.openId = '__test__'
  const n = makeNotifier(w)
  n.test()
  n.test() // immediate repeat — coalescing bypassed
  assert.strictEqual(w.sink.shown.length, 2)
  assert.strictEqual(n.getHistory()[0].mode, 'test')
})
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/notify.test.js` (new tests fail: `getHistory`/`test`/`MAX_HISTORY` undefined, muted not honored).

- [ ] **Step 3: Edit `src/main/notify.js`.**

Add the constant near `COALESCE_MS`:
```js
const MAX_HISTORY = 50
```

Refine `titleFor` (replace the existing function) to add elapsed time + project:
```js
function titleFor(notice) {
  const t = notice.title || 'Session'
  const proj = notice.project ? ` · ${notice.project}` : ''
  switch (notice.event.type) {
    case 'turn:finished': {
      const secs = Math.round((notice.event.durationMs || 0) / 1000)
      const dur = secs >= 60 ? `${Math.round(secs / 60)}m` : `${secs}s`
      return { title: `✓ Done in ${dur}`, body: t }
    }
    case 'turn:error':
      return { title: '⚠ Session error', body: t + proj }
    case 'blocked':
      return { title: '⏳ Waiting on you', body: t + proj }
    case 'usage:threshold':
      return { title: '📊 Usage limit near', body: `${notice.event.window} at ${notice.event.utilization}%` }
    default:
      return { title: 'Flux', body: t }
  }
}
```

In the `Notifier` constructor, add `onHistory` + the history array:
```js
    this.onHistory = opts.onHistory || (() => {})
    this.history = []
```

Add a private recorder + getter (methods on the class):
```js
  _record(notice, mode) {
    const entry = { type: notice.event.type, sessionId: notice.sessionId, title: notice.title || 'Session', ts: this.now(), mode }
    this.history.unshift(entry)
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY
    this.onHistory(entry)
  }

  getHistory() {
    return this.history.slice()
  }
```

In `deliver(notice)`, add the mute short-circuit FIRST (before the mode lookup) and record after dispatch. Replace the body:
```js
  deliver(notice) {
    const setting = this.getSettings().notify || {}
    if (setting.muted) return // do-not-disturb
    const mode = setting[EVENT_SETTING[notice.event.type]] || 'off'
    if (mode === 'off') return

    const win = this.getWindow()
    if (win && !win.isDestroyed() && win.isFocused() && this.getOpenSessionId() === notice.sessionId) return

    const now = this.now()
    const last = this.lastDelivered.get(notice.sessionId)
    if (last != null && now - last < COALESCE_MS) return
    this.lastDelivered.set(notice.sessionId, now)

    if (mode === 'toast') this._toast(notice)
    else if (mode === 'badge') this._badge()
    if (setting.sound) this.beep()
    this._record(notice, mode)
  }
```

Add `test()` (explicit user action — bypasses mute/suppression/coalescing):
```js
  /** Fire a sample notification through the real toast path (explicit user action). */
  test() {
    const notice = { sessionId: '__test__', title: 'Flux test notification', project: '', event: { type: 'turn:finished', durationMs: 90_000 } }
    this._toast(notice)
    if ((this.getSettings().notify || {}).sound) this.beep()
    this._record(notice, 'test')
  }
```

Update exports:
```js
module.exports = { Notifier, titleFor, COALESCE_MS, EVENT_SETTING, MAX_HISTORY }
```

- [ ] **Step 4: Run to verify pass** — `node --test tests/notify.test.js` (all, incl. the original 7 + 4 new). Then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/main/notify.js tests/notify.test.js
git commit -F- <<'EOF'
feat(notify): in-memory history, test(), mute, richer titles (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Phase 3 — settings.js: muted

### Task 3: add `notify.muted`

**Files:** Modify `src/main/settings.js`; Test: extend `tests/settings.test.js`.

- [ ] **Step 1: Add a failing test** to `tests/settings.test.js`:

```js
test('muted is a boolean notify key, defaults false, round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-mute-'))
  const file = path.join(dir, 's.json')
  const s = new SettingsStore(file)
  assert.strictEqual(s.get().notify.muted, false)
  s.setNotify('muted', true)
  assert.strictEqual(new SettingsStore(file).get().notify.muted, true)
  assert.throws(() => s.setNotify('muted', 'yes')) // must be boolean
})
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/settings.test.js`.

- [ ] **Step 3: Edit `src/main/settings.js`.**

In `DEFAULTS.notify`, add `muted: false`:
```js
    usageThreshold: 'toast',
    sound: false,
    muted: false
```

In `_load()`, where it merges notify, also accept `muted` (next to the `sound` boolean merge):
```js
        if (typeof parsed.notify.sound === 'boolean') this.data.notify.sound = parsed.notify.sound
        if (typeof parsed.notify.muted === 'boolean') this.data.notify.muted = parsed.notify.muted
```

In `setNotify(key, value)`, extend the boolean-key branch to accept `muted` as well as `sound`:
```js
    if (key === 'sound' || key === 'muted') {
      if (typeof value !== 'boolean') throw new Error(key + ' must be boolean')
      this.data.notify[key] = value
    } else if (EVENT_KEYS.includes(key)) {
```

- [ ] **Step 4: Run to verify pass** — `node --test tests/settings.test.js tests/settings-profiles.test.js` (no regression). Then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/main/settings.js tests/settings.test.js
git commit -F- <<'EOF'
feat(settings): notify.muted do-not-disturb flag (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Phase 4 — monitor + missioncontrol: exact cost via usage

### Task 4: carry `usage` in the card; drop coarse cost

**Files:** Modify `src/main/monitor.js`, `src/main/missioncontrol.js`; Test: update `tests/missioncontrol.test.js` and `tests/monitor.test.js`.

- [ ] **Step 1: Update the missioncontrol test** (`tests/missioncontrol.test.js`) — the `rec()` helper and `cardsChanged` test currently use `costUsd`; switch to `usage`:

Replace the `rec()` helper's `costUsd: 1,` line with:
```js
    usage: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 },
```
Replace the `cardsChanged detects …` test with:
```js
test('cardsChanged detects status/usage/snippet/subagent/count changes', () => {
  const a = composeCards([rec({ sessionId: 'x' })], 1000)
  const b = composeCards([rec({ sessionId: 'x' })], 1000)
  assert.strictEqual(cardsChanged(a, b), false)
  assert.strictEqual(cardsChanged(null, b), true)
  assert.strictEqual(cardsChanged(a, composeCards([rec({ sessionId: 'x', usage: { input: 999, output: 50, cacheRead: 0, cacheCreation: 0 } })], 1000)), true)
  assert.strictEqual(cardsChanged(a, composeCards([rec({ sessionId: 'x', turnOpen: true })], 1000)), true)
})

test('composeCards passes usage + model through for renderer-side cost', () => {
  const cards = composeCards([rec({ sessionId: 'x', model: 'claude-opus-4-8', usage: { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 } })], 1000)
  assert.deepStrictEqual(cards[0].usage, { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 })
  assert.strictEqual(cards[0].model, 'claude-opus-4-8')
})
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/missioncontrol.test.js`.

- [ ] **Step 3: Edit `src/main/missioncontrol.js`.**

Add a token helper near the top:
```js
function tokensOf(u) {
  if (!u) return 0
  return (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheCreation || 0)
}
```
In `composeCards`, replace the `costUsd: r.costUsd,` line in the card object with:
```js
      usage: r.usage || { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
```
In `cardsChanged`, replace the `a.costUsd !== b.costUsd ||` comparison with:
```js
      tokensOf(a.usage) !== tokensOf(b.usage) ||
```
Export `tokensOf` (add to `module.exports`).

- [ ] **Step 4: Edit `src/main/monitor.js`.**

In the record (`_ensure` initial object), replace `costUsd: 0,` with:
```js
        usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
```
In `_tick` where the parse updates the record, replace `rec.costUsd = estimateCostUsd(parsed.usage, rec.model)` with:
```js
          rec.usage = parsed.usage || rec.usage
```
Remove the `estimateCostUsd` function and its export (delete the `const APPROX_PER_MTOK …` block and `estimateCostUsd` from `module.exports`). Update `tests/monitor.test.js`: remove any `estimateCostUsd` import/use if present (the existing monitor tests use parsed objects with `usage` already, so likely no change needed — verify by running).

- [ ] **Step 5: Run to verify pass** — `node --test tests/missioncontrol.test.js tests/monitor.test.js`. Then `npm test`.

- [ ] **Step 6: Commit**

```bash
git add src/main/monitor.js src/main/missioncontrol.js tests/missioncontrol.test.js tests/monitor.test.js
git commit -F- <<'EOF'
feat(missioncontrol): carry usage for renderer-side exact cost; drop coarse estimate (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Phase 5 — IPC + preload wiring  → **backend shippable**

### Task 5: test/history IPC + onHistory push

**Files:** Modify `src/main/index.js`, `src/preload/index.js`.

- [ ] **Step 1: index.js — wire `onHistory` + IPC.** In `whenReady`, where `notifier = new Notifier({…})` is constructed, add `onHistory`:
```js
  notifier = new Notifier({
    getWindow: () => mainWindow,
    getSettings: () => settingsStore.get(),
    getOpenSessionId: () => openSessionId,
    NotificationImpl: Notification,
    beep: () => require('electron').shell.beep(),
    onHistory: (entry) => emit('notify:history-add', entry)
  })
```
Add IPC handlers next to the existing `notify:setOpenSession`:
```js
ipcMain.handle('notify:test', () => { if (notifier) notifier.test(); return { ok: true } })
ipcMain.handle('notify:history', () => (notifier ? notifier.getHistory() : []))
```

- [ ] **Step 2: preload — extend the `notify` bridge** (KEEP setOpenSession/onOpenSession, ADD):
```js
    test: () => ipcRenderer.invoke('notify:test'),
    history: () => ipcRenderer.invoke('notify:history'),
    onHistoryAdd: (cb) => {
      const listener = (_e, entry) => cb(entry)
      ipcRenderer.on('notify:history-add', listener)
      return () => ipcRenderer.removeListener('notify:history-add', listener)
    }
```

- [ ] **Step 3: Verify** — `npm test` green; `npm run build` succeeds. Dev smoke `C:\tmp\flux-p5.png` — app boots (no crash from the new IPC). Look at the PNG.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -F- <<'EOF'
feat(notify): test + history IPC and history-add push

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Phase 6 — Settings popover: test button + mute

### Task 6: SettingsPopover additions

**Files:** Modify `src/renderer/src/components/SettingsPopover.jsx`, `src/renderer/src/index.css`.

- [ ] **Step 1: Edit `SettingsPopover.jsx`.** Add a mute checkbox at the top and a test button at the bottom. After the `setMode` helper, the `notify` state already exists. Add the mute row right after `<div className="settings-pop-title">Notifications</div>`:
```jsx
      <label className="settings-mute">
        <input type="checkbox" checked={!!notify.muted} onChange={(e) => setMode('muted', e.target.checked)} />
        Mute all (do not disturb)
      </label>
```
And after the existing sound `<label>`, add the test button:
```jsx
      <button className="settings-test" onClick={() => window.flux.notify.test()}>
        Send test notification
      </button>
```
(`setMode` already calls `window.flux.settings.setNotify(key, value)` which now accepts `'muted'`.)

- [ ] **Step 2: Append CSS** to `src/renderer/src/index.css`:
```css
.settings-mute { display: flex; align-items: center; gap: 6px; margin: 4px 0 10px; color: var(--text); font-size: 12px; }
.settings-test { margin-top: 10px; width: 100%; background: var(--accent); color: var(--bg); border: none;
  border-radius: 6px; padding: 6px; cursor: pointer; font-size: 12px; }
.settings-test:hover { filter: brightness(1.08); }
```

- [ ] **Step 3: Verify** — `npm run build`; `npm test` (149+ still green). Dev smoke: capture, then interactively open ⚙, toggle mute, click "Send test notification" → a toast appears even while focused (test bypasses suppression). Screenshot `C:\tmp\flux-p6.png` — confirm the popover shows the mute checkbox + test button. Look at it.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/SettingsPopover.jsx src/renderer/src/index.css
git commit -F- <<'EOF'
feat(notify): settings popover mute toggle + test-notification button

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Phase 7 — Notification bell + history panel

### Task 7: `NotificationBell` in the topbar

**Files:** Create `src/renderer/src/components/NotificationBell.jsx`; Modify `src/renderer/src/App.jsx`, `src/renderer/src/index.css`.

- [ ] **Step 1: Create `NotificationBell.jsx`:**
```jsx
// src/renderer/src/components/NotificationBell.jsx
import { useEffect, useState } from 'react'

const ICON = { 'turn:finished': '✓', 'turn:error': '⚠', blocked: '⏳', 'usage:threshold': '📊', test: '🔔' }

function rel(ts, now) {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.round(s / 60) + 'm'
  return Math.round(s / 3600) + 'h'
}

export default function NotificationBell({ onOpenSession }) {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    window.flux.notify.history().then((h) => setItems(h || []))
    const off = window.flux.notify.onHistoryAdd((entry) => {
      setItems((prev) => [entry, ...prev].slice(0, 50))
      setUnread((u) => u + 1)
    })
    const tick = setInterval(() => setNow(Date.now()), 10000)
    return () => { off(); clearInterval(tick) }
  }, [])

  const toggle = () => { setOpen((o) => !o); setUnread(0) }

  return (
    <div className="bell-anchor">
      <button className={'bell-btn' + (unread > 0 ? ' has-unread' : '')} onClick={toggle} title="Notifications">
        🔔{unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" onMouseLeave={() => setOpen(false)}>
          <div className="bell-title">Recent notifications</div>
          {items.length === 0 && <div className="bell-empty">Nothing yet.</div>}
          {items.map((it, i) => (
            <div
              key={i}
              className="bell-item"
              onClick={() => { if (it.sessionId && it.sessionId !== '__test__') onOpenSession(it.sessionId); setOpen(false) }}
            >
              <span className="bell-icon">{ICON[it.type] || '•'}</span>
              <span className="bell-item-title">{it.title}</span>
              <span className="bell-item-time">{rel(it.ts, now)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire into App.jsx.** Import it: `import NotificationBell from './components/NotificationBell'`. Render it in the topbar — place it just before `<UsageBar />` (so it sits in the control cluster):
```jsx
          <NotificationBell onOpenSession={(id) => {
            const sess = sessions.find((s) => s.sessionId === id)
            if (sess) openSession(sess)
          }} />
```

- [ ] **Step 3: Append CSS** to `src/renderer/src/index.css`:
```css
.bell-anchor { position: relative; display: inline-flex; }
.bell-btn { background: none; border: 1px solid var(--border); color: var(--text-dim); border-radius: 6px;
  padding: 2px 8px; cursor: pointer; position: relative; }
.bell-btn.has-unread, .bell-btn:hover { color: var(--text); border-color: var(--accent); }
.bell-badge { position: absolute; top: -6px; right: -6px; background: var(--alert); color: var(--bg);
  border-radius: 999px; font-size: 9px; padding: 0 4px; line-height: 1.4; }
.bell-panel { position: absolute; top: 130%; right: 0; z-index: 50; width: 300px; max-height: 360px; overflow-y: auto;
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: 10px; padding: 8px;
  box-shadow: 0 8px 30px rgba(0,0,0,.45); }
.bell-title { font-weight: 600; color: var(--text); font-size: 12px; margin-bottom: 6px; }
.bell-empty { color: var(--text-faint); font-size: 12px; padding: 12px 4px; text-align: center; }
.bell-item { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 6px; cursor: pointer; }
.bell-item:hover { background: var(--bg-hover); }
.bell-icon { flex: none; }
.bell-item-title { flex: 1; color: var(--text-dim); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bell-item-time { flex: none; color: var(--text-faint); font-size: 11px; }
```

- [ ] **Step 4: Verify** — `npm run build`; `npm test`. Dev smoke: open the app, click ⚙ → Send test notification a couple times, then click the 🔔 → the panel lists the test entries. Screenshot `C:\tmp\flux-p7.png` showing the bell (and ideally the open panel). Look at it. Confirm clicking a non-test entry opens its session.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/NotificationBell.jsx src/renderer/src/App.jsx src/renderer/src/index.css
git commit -F- <<'EOF'
feat(notify): topbar notification bell + history panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Phase 8 — Mission Control: exact cost + filter + refresh

### Task 8: MissionCard cost via pricing.js; MissionControl filter + refresh

**Files:** Modify `src/renderer/src/components/MissionCard.jsx`, `src/renderer/src/components/MissionControl.jsx`, `src/renderer/src/index.css`.

- [ ] **Step 1: MissionCard.jsx — exact cost.** Add the import and compute cost from `usage`:
```jsx
import { estimateCost, formatUSD } from '../lib/pricing'
```
Replace the cost `<span>$${card.costUsd.toFixed(2)}</span>` line in `.mcard-meta` with:
```jsx
        <span>{formatUSD(estimateCost(card.usage, card.model).total)}</span>
```

- [ ] **Step 2: MissionControl.jsx — filter row + manual refresh.** Add state + a refresh + a filter, and apply the filter to the groups. Replace the component body's `byGroup`/return with:
```jsx
  const [filter, setFilter] = useState('all') // 'all' | 'needsYou' | 'running'

  const refresh = () => window.flux.missioncontrol.list().then((res) => { if (res.ok) setCards(res.cards) })

  const visibleGroups = GROUPS.filter((g) => filter === 'all' || g.key === filter)
  const byGroup = (g) => cards.filter((c) => c.group === g)

  return (
    <div className="mission">
      <div className="mission-toolbar">
        <div className="mission-filter">
          {[['all', 'All'], ['needsYou', 'Needs you'], ['running', 'Running']].map(([k, label]) => (
            <button key={k} className={'mfilter' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
        <button className="mission-refresh" onClick={refresh} title="Refresh">⟳</button>
      </div>
      {cards.length === 0 && <div className="mission-empty">No active sessions in the last 24h.</div>}
      {visibleGroups.map((g) => {
        const groupItems = byGroup(g.key)
        if (!groupItems.length) return null
        return (
          <div key={g.key}>
            <div className="mission-group-title">{g.title} · {groupItems.length}</div>
            <div className="mission-grid">
              {groupItems.map((c) => (
                <MissionCard key={c.sessionId} card={c} now={now} onOpen={onOpenCard} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
```
Ensure `useState` is imported (it already is alongside `useEffect`).

- [ ] **Step 3: Append CSS** to `src/renderer/src/index.css`:
```css
.mission-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.mission-filter { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.mfilter { background: none; border: none; color: var(--text-faint); font-size: 12px; padding: 4px 10px; cursor: pointer; }
.mfilter.on { background: var(--accent); color: var(--bg); }
.mission-refresh { background: none; border: 1px solid var(--border); color: var(--text-dim); border-radius: 6px;
  padding: 2px 9px; cursor: pointer; font-size: 14px; }
.mission-refresh:hover { color: var(--text); border-color: var(--accent); }
```

- [ ] **Step 4: Verify** — `npm run build`; `npm test`. Dev smoke `C:\tmp\flux-p8.png` of the Mission view (FLUX_SMOKE_VIEW=mission) — confirm the filter row (All/Needs you/Running) + ⟳ render above the grid, and cards show a real `$x.xx` cost. Look at it. Confirm filter buttons switch the visible groups.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/MissionCard.jsx src/renderer/src/components/MissionControl.jsx src/renderer/src/index.css
git commit -F- <<'EOF'
feat(missioncontrol): exact cost via pricing.js + filter row + manual refresh

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Phase 9 — Verify & docs

### Task 9: full verification + docs

- [ ] **Step 1: Full suite** — `npm test`; report counts (expect prior total + new tests). `npm run build` success; `npm run smoke` OK.
- [ ] **Step 2: Live verification (manual, interactive):** open the app; ⚙ → Send test notification (see toast + bell entry); run a real tracked claude (`claude (tracked)` profile) with a >30s task and confirm a turn-finished badge/flash + a bell entry; if a session errors, confirm the ⚠ toast. Confirm Mission Control shows that session as running/needs-you while active. Capture `C:\tmp\flux-p9.png`.
- [ ] **Step 3: Update spec status + README.** In `docs/superpowers/specs/2026-06-10-notifications-mission-polish-design.md` set Status to `implemented 2026-06-10`. Add a README roadmap bullet:
```md
- [x] **A+B polish:** validated error detection, a ⚙ test-notification button + mute, an
      in-memory notification history with a topbar 🔔 bell, and Mission Control cards with
      exact cost + All/Needs-you/Running filter + manual refresh.
```
- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-10-notifications-mission-polish-design.md README.md
git commit -F- <<'EOF'
docs: mark notifications+mission polish implemented; README

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Self-review notes (author)

- **Spec coverage:** error detection validated with a real-shape test (Task 1) ✓; wording (Task 2 titleFor) ✓; test button + mute (Tasks 2,3,6) ✓; history ring + bell panel (Tasks 2,5,7) ✓; exact cost + filter + refresh (Tasks 4,8) ✓.
- **Placeholders:** none — every code step is complete. Task 1 may need zero `parser.js` change (the existing marker is validated); the step says so explicitly.
- **Type/name consistency:** `notify` bridge (`test`/`history`/`onHistoryAdd`) matches index.js IPC (`notify:test`/`notify:history`/`notify:history-add`); `Notifier.test()`/`getHistory()`/`onHistory` consistent; card `usage` produced by `composeCards` and consumed by `MissionCard` via `estimateCost`; `cardsChanged` uses `tokensOf(usage)`; `setNotify('muted', …)` accepted by settings.
- **Mute vs history:** muted `deliver` returns before `_record`, so muted events are NOT in history (matches the test). `test()` always records (mode `'test'`).
- **Bell open clears unread; test entries don't navigate** (sessionId `'__test__'` guarded).
