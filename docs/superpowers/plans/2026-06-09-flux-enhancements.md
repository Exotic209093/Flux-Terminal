# Flux Terminal Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live plan-usage gauges (5-hour + weekly windows), slash-command autocomplete in the session composer, and image support (render incoming, attach/paste outgoing) to Flux Terminal.

**Architecture:** Electron main process gains three small modules (`usage.js` polls Anthropic's OAuth usage endpoint, `commands.js` lists slash commands, image-stash IPC writes temp files); the parser learns `image` content blocks. The renderer gains four focused units (`useUsage` hook, `UsageBar`, `SlashMenu`, `Lightbox`) wired into the existing topbar and `SessionView`. All main↔renderer traffic goes through the existing `window.flux` contextBridge pattern.

**Tech Stack:** Electron 42 (main = CommonJS, global `fetch` available), React 19, Node 24 built-in test runner (`node --test`) — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-09-flux-enhancements-design.md`

---

## Verified facts the plan relies on

- Endpoint: `GET https://api.anthropic.com/api/oauth/usage` with headers
  `Authorization: Bearer <token>` and `anthropic-beta: oauth-2025-04-20`
  (both extracted from the claude CLI binary, v2.1.154).
- Response windows: `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`,
  each with `utilization` (percent 0–100) and/or `remaining_percentage`, plus `resets_at`
  (ISO timestamp, may be null).
- Token lives at `~/.claude/.credentials.json` → `claudeAiOauth.accessToken`.
  ⚠ The Claude Code sandbox blocks reading this file from agent shells; the **app** reads it
  at runtime, and tests must NEVER read the real file (always inject paths/tokens).
- CSS theme variables available: `--bg`, `--bg-elev`, `--bg-panel`, `--bg-hover`, `--border`,
  `--text`, `--text-dim`, `--text-faint`, `--accent`, `--accent-glow`.
- `package.json` has no `"type"` field → `.js` files in `tests/` are CommonJS; `require()` of
  `src/main/*.js` works directly under `node --test`.
- LivePanel renders only aggregate metrics, not timeline items — but `live.js` ships its
  `recent` ring over IPC every 1.5 s, so image base64 must be stripped from that ring (Task 9).

---

### Task 1: Usage fetcher core (`src/main/usage.js`) — TDD

**Files:**
- Modify: `package.json` (add test script)
- Test: `tests/usage.test.js` (create)
- Create: `src/main/usage.js`

- [ ] **Step 1: Add the test script to `package.json`**

In the `"scripts"` block, after `"smoke:electron"`, add:

```json
    "test": "node --test tests/"
```

- [ ] **Step 2: Write the failing tests**

Create `tests/usage.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { normalizeUsage, readAccessToken, fetchUsage } = require('../src/main/usage')

test('normalizeUsage maps all four windows', () => {
  const out = normalizeUsage({
    five_hour: { utilization: 23.4, resets_at: '2026-06-09T20:00:00Z' },
    seven_day: { utilization: 41, resets_at: '2026-06-12T11:00:00Z' },
    seven_day_opus: { utilization: 5, resets_at: null },
    seven_day_sonnet: { utilization: 0, resets_at: null }
  })
  assert.deepStrictEqual(out.fiveHour, { utilization: 23, resetsAt: '2026-06-09T20:00:00Z' })
  assert.deepStrictEqual(out.sevenDay, { utilization: 41, resetsAt: '2026-06-12T11:00:00Z' })
  assert.strictEqual(out.sevenDayOpus.utilization, 5)
  assert.strictEqual(out.sevenDaySonnet.utilization, 0)
})

test('normalizeUsage falls back to remaining_percentage and clamps', () => {
  const out = normalizeUsage({
    five_hour: { remaining_percentage: 30, resets_at: null },
    seven_day: { utilization: 250, resets_at: null }
  })
  assert.strictEqual(out.fiveHour.utilization, 70)
  assert.strictEqual(out.sevenDay.utilization, 100)
})

test('normalizeUsage returns null for junk', () => {
  assert.strictEqual(normalizeUsage(null), null)
  assert.strictEqual(normalizeUsage({}), null)
  assert.strictEqual(normalizeUsage({ five_hour: { bogus: 1 } }), null)
})

test('readAccessToken reads claudeAiOauth.accessToken from an explicit file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-usage-'))
  const file = path.join(dir, 'creds.json')
  fs.writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: 'tok-123' } }))
  assert.strictEqual(readAccessToken(file), 'tok-123')
  assert.strictEqual(readAccessToken(path.join(dir, 'missing.json')), null)
  fs.writeFileSync(file, 'not json')
  assert.strictEqual(readAccessToken(file), null)
})

test('fetchUsage: no token -> NO_CREDS', async () => {
  const res = await fetchUsage({ getToken: () => null })
  assert.strictEqual(res.ok, false)
  assert.strictEqual(res.code, 'NO_CREDS')
})

test('fetchUsage: 401 -> AUTH', async () => {
  const res = await fetchUsage({
    getToken: () => 't',
    fetchImpl: async () => ({ ok: false, status: 401 })
  })
  assert.strictEqual(res.code, 'AUTH')
})

test('fetchUsage: network throw -> NETWORK', async () => {
  const res = await fetchUsage({
    getToken: () => 't',
    fetchImpl: async () => { throw new Error('offline') }
  })
  assert.strictEqual(res.code, 'NETWORK')
})

test('fetchUsage: happy path normalizes and stamps fetchedAt', async () => {
  const res = await fetchUsage({
    getToken: () => 't',
    fetchImpl: async (url, opts) => {
      assert.strictEqual(url, 'https://api.anthropic.com/api/oauth/usage')
      assert.strictEqual(opts.headers.Authorization, 'Bearer t')
      assert.strictEqual(opts.headers['anthropic-beta'], 'oauth-2025-04-20')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          five_hour: { utilization: 10, resets_at: '2026-06-09T20:00:00Z' },
          seven_day: { utilization: 50, resets_at: '2026-06-12T11:00:00Z' }
        })
      }
    }
  })
  assert.strictEqual(res.ok, true)
  assert.strictEqual(res.windows.fiveHour.utilization, 10)
  assert.ok(typeof res.fetchedAt === 'number')
})

test('fetchUsage: unrecognized body -> SHAPE', async () => {
  const res = await fetchUsage({
    getToken: () => 't',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) })
  })
  assert.strictEqual(res.code, 'SHAPE')
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/main/usage'`

- [ ] **Step 4: Implement `src/main/usage.js`**

```js
const fs = require('fs')
const path = require('path')
const os = require('os')

// Live plan usage: the same endpoint `claude /usage` hits, called with the
// Claude Code OAuth token from ~/.claude/.credentials.json. The token never
// leaves this machine except to api.anthropic.com.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA = 'oauth-2025-04-20'

function credentialsPath() {
  return path.join(os.homedir(), '.claude', '.credentials.json')
}

/** Access token from the Claude Code credentials store, or null. */
function readAccessToken(file = credentialsPath()) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch {
    return null
  }
  try {
    const creds = JSON.parse(raw)
    const oauth = creds.claudeAiOauth || creds
    return (oauth && typeof oauth.accessToken === 'string' && oauth.accessToken) || null
  } catch {
    return null
  }
}

function normalizeWindow(w) {
  if (!w || typeof w !== 'object') return null
  let utilization = null
  if (typeof w.utilization === 'number') utilization = w.utilization
  else if (typeof w.remaining_percentage === 'number') utilization = 100 - w.remaining_percentage
  if (utilization == null || Number.isNaN(utilization)) return null
  return {
    utilization: Math.max(0, Math.min(100, Math.round(utilization))),
    resetsAt: w.resets_at || null
  }
}

/** Normalize the API body to our window shape, or null if unrecognized. */
function normalizeUsage(json) {
  if (!json || typeof json !== 'object') return null
  const windows = {
    fiveHour: normalizeWindow(json.five_hour),
    sevenDay: normalizeWindow(json.seven_day),
    sevenDayOpus: normalizeWindow(json.seven_day_opus),
    sevenDaySonnet: normalizeWindow(json.seven_day_sonnet)
  }
  if (!windows.fiveHour && !windows.sevenDay) return null
  return windows
}

/**
 * Fetch + normalize. Returns { ok:true, windows, fetchedAt } or
 * { ok:false, code, error } with code in:
 * NO_CREDS | AUTH | NETWORK | HTTP_<n> | PARSE | SHAPE
 */
async function fetchUsage(opts = {}) {
  const getToken = opts.getToken || readAccessToken
  const fetchImpl = opts.fetchImpl || fetch
  const token = getToken()
  if (!token) {
    return { ok: false, code: 'NO_CREDS', error: 'No Claude Code login found — run `claude` once to sign in.' }
  }
  let res
  try {
    res = await fetchImpl(USAGE_URL, {
      headers: {
        Authorization: 'Bearer ' + token,
        'anthropic-beta': OAUTH_BETA,
        'Content-Type': 'application/json'
      }
    })
  } catch (err) {
    return { ok: false, code: 'NETWORK', error: err.message }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, code: 'AUTH', error: 'Login expired — run `claude` once to refresh, then retry.' }
  }
  if (!res.ok) {
    return { ok: false, code: 'HTTP_' + res.status, error: 'Usage endpoint returned ' + res.status }
  }
  let json
  try {
    json = await res.json()
  } catch (err) {
    return { ok: false, code: 'PARSE', error: err.message }
  }
  const windows = normalizeUsage(json)
  if (!windows) return { ok: false, code: 'SHAPE', error: 'Unrecognized usage response shape' }
  return { ok: true, windows, fetchedAt: Date.now() }
}

module.exports = { normalizeUsage, readAccessToken, fetchUsage, USAGE_URL, OAUTH_BETA }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json tests/usage.test.js src/main/usage.js
git commit -m "feat: usage fetcher for /api/oauth/usage with normalized windows"
```

---

### Task 2: UsagePoller — TDD

**Files:**
- Modify: `src/main/usage.js`
- Test: `tests/usage.test.js` (append)

- [ ] **Step 1: Append failing poller tests to `tests/usage.test.js`**

```js
const { UsagePoller } = require('../src/main/usage')

test('UsagePoller: keeps last good windows and flags stale on failure', async () => {
  const results = [
    { ok: true, windows: { fiveHour: { utilization: 10, resetsAt: null }, sevenDay: null, sevenDayOpus: null, sevenDaySonnet: null }, fetchedAt: 111 },
    { ok: false, code: 'NETWORK', error: 'offline' }
  ]
  const emitted = []
  const poller = new UsagePoller((snap) => emitted.push(snap), {
    fetchUsage: async () => results.shift()
  })
  await poller.refresh()
  await poller.refresh()
  assert.strictEqual(emitted.length, 2)
  assert.strictEqual(emitted[0].ok, true)
  assert.strictEqual(emitted[1].ok, false)
  assert.strictEqual(emitted[1].stale, true)
  assert.strictEqual(emitted[1].windows.fiveHour.utilization, 10)
  assert.deepStrictEqual(poller.snapshot(), emitted[1])
})

test('UsagePoller: snapshot before any fetch is an INIT error', () => {
  const poller = new UsagePoller(() => {}, { fetchUsage: async () => ({ ok: false, code: 'X', error: 'x' }) })
  assert.strictEqual(poller.snapshot().code, 'INIT')
  assert.strictEqual(poller.snapshot().windows, null)
})

test('UsagePoller: failure with no prior success has null windows, stale false', async () => {
  const emitted = []
  const poller = new UsagePoller((s) => emitted.push(s), {
    fetchUsage: async () => ({ ok: false, code: 'AUTH', error: 'expired' })
  })
  await poller.refresh()
  assert.strictEqual(emitted[0].stale, false)
  assert.strictEqual(emitted[0].windows, null)
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test`
Expected: FAIL — `UsagePoller is not a constructor`

- [ ] **Step 3: Implement `UsagePoller` in `src/main/usage.js`**

Add above the `module.exports` line, and add `UsagePoller` to the exports:

```js
/**
 * Polls fetchUsage() on an interval, retaining the last good snapshot so the
 * UI keeps showing gauges (flagged stale) through transient failures.
 */
class UsagePoller {
  constructor(onUpdate, opts = {}) {
    this.onUpdate = onUpdate
    this.intervalMs = opts.intervalMs || 60000
    this.fetchUsage = opts.fetchUsage || fetchUsage
    this.timer = null
    this.lastGood = null
    this.lastEmit = null
  }

  start() {
    if (this.timer) return
    this.refresh()
    this.timer = setInterval(() => this.refresh(), this.intervalMs)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  snapshot() {
    return this.lastEmit || { ok: false, code: 'INIT', error: 'usage not fetched yet', windows: null }
  }

  async refresh() {
    const result = await this.fetchUsage()
    let emitted
    if (result.ok) {
      this.lastGood = result
      emitted = result
    } else {
      emitted = {
        ...result,
        stale: !!this.lastGood,
        windows: this.lastGood ? this.lastGood.windows : null,
        fetchedAt: this.lastGood ? this.lastGood.fetchedAt : null
      }
    }
    this.lastEmit = emitted
    this.onUpdate(emitted)
    return emitted
  }
}

module.exports = { normalizeUsage, readAccessToken, fetchUsage, UsagePoller, USAGE_URL, OAUTH_BETA }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/usage.test.js src/main/usage.js
git commit -m "feat: UsagePoller with stale-snapshot retention"
```

---

### Task 3: Usage IPC + preload bridge

**Files:**
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

- [ ] **Step 1: Wire the poller in `src/main/index.js`**

Add to the require block at the top:

```js
const { UsagePoller } = require('./usage')
```

Add to the module-level state (next to `let liveTracker = null`):

```js
let usagePoller = null
```

Add a new section after the Skills handlers:

```js
// ---- Plan usage (5h + weekly windows) ---------------------------------------
ipcMain.handle('usage:get', () =>
  usagePoller ? usagePoller.snapshot() : { ok: false, code: 'INIT', error: 'starting', windows: null }
)
ipcMain.handle('usage:refresh', () =>
  usagePoller ? usagePoller.refresh() : { ok: false, code: 'INIT', error: 'starting', windows: null }
)
```

In `app.whenReady().then(() => { ... })`, after the `liveTracker = new LiveTracker(...)` block:

```js
  usagePoller = new UsagePoller((snap) => emit('usage:update', snap))
  usagePoller.start()
```

In the `window-all-closed` handler, after the `liveTracker` cleanup:

```js
  if (usagePoller) usagePoller.stop()
```

- [ ] **Step 2: Expose the bridge in `src/preload/index.js`**

Add a `usage` namespace inside the `exposeInMainWorld('flux', { ... })` object, after `live`:

```js
  usage: {
    get: () => ipcRenderer.invoke('usage:get'),
    refresh: () => ipcRenderer.invoke('usage:refresh'),
    onUpdate: (cb) => {
      const listener = (_e, snap) => cb(snap)
      ipcRenderer.on('usage:update', listener)
      return () => ipcRenderer.removeListener('usage:update', listener)
    }
  }
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: all three bundles succeed (exit 0).

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat: usage IPC (get/refresh/update) + window.flux.usage bridge"
```

---

### Task 4: `useUsage` hook + `UsageBar` + topbar placement

**Files:**
- Create: `src/renderer/src/lib/useUsage.js`
- Create: `src/renderer/src/components/UsageBar.jsx`
- Modify: `src/renderer/src/App.jsx`
- Modify: `src/renderer/src/index.css`

- [ ] **Step 1: Create `src/renderer/src/lib/useUsage.js`**

```js
import { useEffect, useState, useCallback } from 'react'

// Shared plan-usage state: initial fetch + push updates from the main-process
// poller. Multiple components can use this hook; they stay in sync because all
// instances subscribe to the same usage:update events.
export function useUsage() {
  const [usage, setUsage] = useState(null)

  useEffect(() => {
    let alive = true
    window.flux.usage.get().then((u) => {
      if (alive && u) setUsage(u)
    })
    const off = window.flux.usage.onUpdate(setUsage)
    return () => {
      alive = false
      off()
    }
  }, [])

  const refresh = useCallback(() => {
    window.flux.usage.refresh()
  }, [])

  return { usage, refresh }
}
```

- [ ] **Step 2: Create `src/renderer/src/components/UsageBar.jsx`**

```jsx
import { useEffect, useState } from 'react'

const WINDOWS = [
  { key: 'fiveHour', label: '5h' },
  { key: 'sevenDay', label: 'Week' },
  { key: 'sevenDayOpus', label: 'Week · Opus', detailOnly: true },
  { key: 'sevenDaySonnet', label: 'Week · Sonnet', detailOnly: true }
]

function countdown(resetsAt) {
  if (!resetsAt) return null
  const ms = new Date(resetsAt).getTime() - Date.now()
  if (Number.isNaN(ms)) return null
  if (ms <= 0) return 'resetting…'
  const m = Math.ceil(ms / 60000)
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 48) return h + 'h ' + (m % 60) + 'm'
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h'
}

function heat(pct) {
  if (pct >= 90) return ' hot'
  if (pct >= 70) return ' warm'
  return ''
}

// Plan-usage gauges. Compact (topbar) by default; `detailed` adds the
// per-model weekly windows and reset countdowns (session header).
export default function UsageBar({ usage, onRefresh, detailed = false }) {
  // re-render every 30s so the countdowns tick between fetches
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  if (!usage) return null

  if (!usage.windows) {
    const signIn = usage.code === 'NO_CREDS' || usage.code === 'AUTH'
    return (
      <div className={'usage-bar' + (detailed ? ' detailed' : '')}>
        <span className="usage-err" title={usage.error || ''}>
          {signIn ? '⚠ usage: sign in with claude' : '⚠ usage unavailable'}
        </span>
        <button className="usage-refresh" onClick={onRefresh} title="Retry">
          ⟳
        </button>
      </div>
    )
  }

  const rows = WINDOWS.filter((w) => (detailed || !w.detailOnly) && usage.windows[w.key])
  return (
    <div className={'usage-bar' + (detailed ? ' detailed' : '')}>
      {rows.map((w) => {
        const win = usage.windows[w.key]
        const reset = countdown(win.resetsAt)
        return (
          <div
            className={'usage-gauge' + heat(win.utilization)}
            key={w.key}
            title={`${w.label} window: ${win.utilization}% used${reset ? ' · resets in ' + reset : ''}`}
          >
            <span className="usage-label">{w.label}</span>
            <span className="usage-track">
              <span className="usage-fill" style={{ width: win.utilization + '%' }} />
            </span>
            <span className="usage-pct">{win.utilization}%</span>
            {detailed && reset && <span className="usage-reset">resets in {reset}</span>}
          </div>
        )
      })}
      {usage.stale && (
        <span className="usage-stale" title={usage.error || 'last fetch failed'}>
          stale
        </span>
      )}
      <button className="usage-refresh" onClick={onRefresh} title="Refresh usage">
        ⟳
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Mount in the topbar (`src/renderer/src/App.jsx`)**

Add imports:

```js
import UsageBar from './components/UsageBar'
import { useUsage } from './lib/useUsage'
```

Inside `App()`, next to the other hooks:

```js
const { usage, refresh: refreshUsage } = useUsage()
```

In the topbar JSX, after the conditional `{selected && (...)}` tab button, as the last child of `<div className="topbar">`:

```jsx
<UsageBar usage={usage} onRefresh={refreshUsage} />
```

- [ ] **Step 4: Add styles to `src/renderer/src/index.css`** (append at end)

```css
/* ---- plan usage gauges ---------------------------------------------- */
.usage-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-left: auto;
  padding: 0 10px;
}
.usage-gauge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-dim);
}
.usage-label {
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 10px;
  color: var(--text-faint);
  white-space: nowrap;
}
.usage-track {
  width: 64px;
  height: 5px;
  border-radius: 3px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  overflow: hidden;
}
.usage-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
  transition: width 0.4s ease;
}
.usage-gauge.warm .usage-fill { background: #e8a33d; }
.usage-gauge.hot .usage-fill { background: #e8503d; }
.usage-gauge.warm .usage-pct { color: #e8a33d; }
.usage-gauge.hot .usage-pct { color: #e8503d; }
.usage-pct {
  min-width: 32px;
  font-variant-numeric: tabular-nums;
}
.usage-reset {
  color: var(--text-faint);
  font-size: 10px;
  white-space: nowrap;
}
.usage-refresh {
  background: none;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 13px;
  padding: 2px 4px;
}
.usage-refresh:hover { color: var(--text); }
.usage-err { font-size: 11px; color: var(--text-faint); }
.usage-stale { font-size: 10px; color: #e8a33d; }
.usage-bar.detailed {
  margin: 10px 0 0;
  margin-left: 0;
  padding: 10px 12px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  flex-wrap: wrap;
}
```

- [ ] **Step 5: Build + visual smoke**

Run: `npm run build`
Expected: success.

Run (PowerShell):
```powershell
$env:FLUX_SMOKE_SHOT = "C:\tmp\flux-usage-topbar.png"; npm run preview
```
Expected: console prints `FLUX_SMOKE_SHOT_OK`; open the PNG and confirm the topbar shows the two gauges (or the sign-in notice if the token is unavailable). Clear the env var afterwards: `Remove-Item Env:FLUX_SMOKE_SHOT`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/useUsage.js src/renderer/src/components/UsageBar.jsx src/renderer/src/App.jsx src/renderer/src/index.css
git commit -m "feat: UsageBar gauges in topbar via useUsage hook"
```

---

### Task 5: Detailed usage block in the session header

**Files:**
- Modify: `src/renderer/src/components/SessionView.jsx`

- [ ] **Step 1: Add the detailed UsageBar to `SessionView`**

Add imports at the top of `SessionView.jsx`:

```js
import UsageBar from './UsageBar'
import { useUsage } from '../lib/useUsage'
```

Inside `SessionView(...)`, with the other hooks (before the early returns):

```js
const { usage, refresh: refreshUsage } = useUsage()
```

In the header JSX, insert directly after the closing `</div>` of `<div className="sv-context">…</div>` and before `<div className="sv-stats">`:

```jsx
<UsageBar usage={usage} onRefresh={refreshUsage} detailed />
```

- [ ] **Step 2: Build + visual smoke**

Run: `npm run build`
Expected: success.

Run (PowerShell):
```powershell
$env:FLUX_SMOKE_SHOT = "C:\tmp\flux-usage-session.png"; $env:FLUX_SMOKE_VIEW = "session"; npm run preview
```
Expected: `FLUX_SMOKE_SHOT_OK`; the session header shows the detailed usage block (all available windows + reset countdowns). Clean up: `Remove-Item Env:FLUX_SMOKE_SHOT; Remove-Item Env:FLUX_SMOKE_VIEW`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/SessionView.jsx
git commit -m "feat: detailed plan-usage block at the top of each session"
```

---

### Task 6: Slash-command lister (`src/main/commands.js`) — TDD

**Files:**
- Test: `tests/commands.test.js` (create)
- Create: `src/main/commands.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/commands.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { listCommands, frontmatterDescription } = require('../src/main/commands')

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flux-cmds-'))
}

test('frontmatterDescription extracts description, tolerates absence', () => {
  assert.strictEqual(
    frontmatterDescription('---\ndescription: Review a PR\n---\nbody'),
    'Review a PR'
  )
  assert.strictEqual(frontmatterDescription('---\ndescription: "Quoted"\n---\n'), 'Quoted')
  assert.strictEqual(frontmatterDescription('no frontmatter here'), '')
  assert.strictEqual(frontmatterDescription('---\nother: x\n---\n'), '')
})

test('listCommands includes builtins', () => {
  const cmds = listCommands(null, { userDir: path.join(tmpdir(), 'none') })
  const usage = cmds.find((c) => c.name === '/usage')
  assert.ok(usage)
  assert.strictEqual(usage.source, 'builtin')
})

test('listCommands merges user + project commands with precedence project > user > builtin', () => {
  const userDir = tmpdir()
  const projRoot = tmpdir()
  const projDir = path.join(projRoot, '.claude', 'commands')
  fs.mkdirSync(projDir, { recursive: true })

  fs.writeFileSync(path.join(userDir, 'deploy.md'), '---\ndescription: User deploy\n---\nDo it')
  fs.writeFileSync(path.join(userDir, 'review.md'), 'overrides builtin /review')
  fs.writeFileSync(path.join(projDir, 'deploy.md'), '---\ndescription: Project deploy\n---\nDo it here')
  fs.writeFileSync(path.join(projDir, 'notes.txt'), 'ignored — not .md')

  const cmds = listCommands(projRoot, { userDir })
  const deploy = cmds.find((c) => c.name === '/deploy')
  assert.strictEqual(deploy.source, 'project')
  assert.strictEqual(deploy.description, 'Project deploy')
  const review = cmds.find((c) => c.name === '/review')
  assert.strictEqual(review.source, 'user')
  assert.ok(!cmds.find((c) => c.name === '/notes'))
  // sorted by name
  const names = cmds.map((c) => c.name)
  assert.deepStrictEqual(names, [...names].sort())
})

test('listCommands tolerates missing dirs', () => {
  const cmds = listCommands('Z:\\does\\not\\exist', { userDir: 'Z:\\nope' })
  assert.ok(cmds.length > 0) // builtins still present
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/main/commands'`

- [ ] **Step 3: Implement `src/main/commands.js`**

```js
const fs = require('fs')
const path = require('path')
const os = require('os')

// Slash commands for composer autocomplete: curated builtins + custom command
// files (~/.claude/commands and <project>/.claude/commands, top-level *.md).

const BUILTINS = [
  ['/clear', 'Clear conversation history'],
  ['/compact', 'Compact conversation, keeping a summary'],
  ['/config', 'Open config panel'],
  ['/context', 'Visualize current context usage'],
  ['/cost', 'Show total cost of current session'],
  ['/doctor', 'Check health of your Claude Code install'],
  ['/help', 'Show help and available commands'],
  ['/init', 'Generate a CLAUDE.md for this project'],
  ['/memory', 'Edit Claude memory files'],
  ['/model', 'Switch model'],
  ['/permissions', 'Manage tool permissions'],
  ['/pr-comments', 'Get comments from a GitHub pull request'],
  ['/review', 'Review a pull request'],
  ['/status', 'Show Claude Code status'],
  ['/usage', 'Show plan usage limits']
].map(([name, description]) => ({ name, description, source: 'builtin' }))

/** Read "description:" from an optional YAML frontmatter block. */
function frontmatterDescription(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  if (!m) return ''
  const d = /^description:\s*(.+)$/m.exec(m[1])
  return d ? d[1].trim().replace(/^['"]|['"]$/g, '') : ''
}

/** Scan a commands dir for top-level *.md files. Missing dir → []. */
function scanCommandsDir(dir, source) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue
    let description = ''
    try {
      description = frontmatterDescription(fs.readFileSync(path.join(dir, e.name), 'utf-8'))
    } catch {
      /* unreadable file — list it without a description */
    }
    out.push({ name: '/' + e.name.slice(0, -3), description, source })
  }
  return out
}

/**
 * Merged command list for a session cwd. Precedence on a name clash:
 * project > user > builtin. Sorted by name.
 */
function listCommands(cwd, opts = {}) {
  const userDir = opts.userDir || path.join(os.homedir(), '.claude', 'commands')
  const projectDir = cwd ? path.join(cwd, '.claude', 'commands') : null
  const byName = new Map()
  for (const c of BUILTINS) byName.set(c.name, c)
  for (const c of scanCommandsDir(userDir, 'user')) byName.set(c.name, c)
  if (projectDir) for (const c of scanCommandsDir(projectDir, 'project')) byName.set(c.name, c)
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
}

module.exports = { listCommands, scanCommandsDir, frontmatterDescription, BUILTINS }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (16 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/commands.test.js src/main/commands.js
git commit -m "feat: slash-command lister (builtins + user + project .claude/commands)"
```

---

### Task 7: Commands IPC + preload bridge

**Files:**
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

- [ ] **Step 1: IPC handler in `src/main/index.js`**

Add to the require block:

```js
const { listCommands } = require('./commands')
```

Add after the usage handlers:

```js
// ---- Slash commands (composer autocomplete) ---------------------------------
ipcMain.handle('commands:list', (_e, cwd) => {
  try {
    return { ok: true, commands: listCommands(cwd) }
  } catch (err) {
    return { ok: false, error: err.message, commands: [] }
  }
})
```

- [ ] **Step 2: Preload bridge in `src/preload/index.js`**

Add after the `usage` namespace:

```js
  commands: {
    list: (cwd) => ipcRenderer.invoke('commands:list', cwd)
  }
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat: commands:list IPC + window.flux.commands bridge"
```

---

### Task 8: SlashMenu + composer autocomplete

**Files:**
- Create: `src/renderer/src/components/SlashMenu.jsx`
- Modify: `src/renderer/src/components/SessionView.jsx`
- Modify: `src/renderer/src/index.css`

- [ ] **Step 1: Create `src/renderer/src/components/SlashMenu.jsx`**

```jsx
// Autocomplete dropdown for slash commands, rendered above the composer.
// onMouseDown (not onClick) so picking an item doesn't blur the textarea.
export default function SlashMenu({ items, selected, onPick }) {
  if (!items.length) return null
  return (
    <div className="slash-menu">
      {items.map((c, i) => (
        <button
          key={c.name + ':' + c.source}
          className={'slash-item' + (i === selected ? ' selected' : '')}
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(c)
          }}
        >
          <span className="slash-name">{c.name}</span>
          <span className="slash-desc">{c.description}</span>
          <span className={'slash-src slash-src-' + c.source}>{c.source}</span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `SessionView.jsx`**

Add import:

```js
import SlashMenu from './SlashMenu'
```

Add state inside `SessionView` (next to the existing `draft` state):

```js
const [commands, setCommands] = useState([])
const [slashIndex, setSlashIndex] = useState(0)
const [slashDismissed, setSlashDismissed] = useState(false)
```

Fetch commands when the open session changes (place with the other `useEffect`s — note `sessionId` is already defined above them):

```js
// Slash commands are cwd-dependent (project commands), so refetch per session.
useEffect(() => {
  if (!detail || detail.ok === false) return
  const cwd = detail.firstCwd || detail.cwd
  window.flux.commands.list(cwd).then((res) => {
    if (res && res.ok) setCommands(res.commands)
  })
}, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps
```

Add the derived menu state after the effects (before `submit`):

```js
// Menu shows while the draft is just "/name-being-typed" (no whitespace yet).
const slashFilter = /^\/\S*$/.test(draft) ? draft : null
const slashItems =
  slashFilter && !slashDismissed
    ? commands.filter((c) => c.name.startsWith(slashFilter)).slice(0, 8)
    : []
const slashSel = Math.max(0, Math.min(slashIndex, slashItems.length - 1))

const completeSlash = (c) => {
  setDraft(c.name + ' ') // trailing space closes the menu (regex no longer matches)
  setSlashIndex(0)
}
```

Reset the selection when the filter changes — add this `useEffect` with the others:

```js
useEffect(() => {
  setSlashIndex(0)
  setSlashDismissed(false)
}, [slashFilter])
```

Replace the existing `onKeyDown` with:

```js
const onKeyDown = (e) => {
  if (slashItems.length) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSlashIndex((i) => Math.min(i + 1, slashItems.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSlashIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault()
      completeSlash(slashItems[slashSel])
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setSlashDismissed(true)
      return
    }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}
```

(UX note: while the menu is open, Enter completes the highlighted command; a second Enter — menu now closed because of the trailing space — sends.)

In the composer JSX, wrap the textarea in a relative container and add the menu:

```jsx
<div className="sv-composer">
  <div className="composer-mid">
    {slashItems.length > 0 && (
      <SlashMenu items={slashItems} selected={slashSel} onPick={completeSlash} />
    )}
    <textarea
      className="composer-input"
      placeholder="Message this session…  (Enter to send · Shift+Enter for newline · / for commands)"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      rows={1}
      disabled={sendState === 'running'}
    />
  </div>
  <button
    className="composer-send"
    onClick={submit}
    disabled={sendState === 'running' || !draft.trim()}
  >
    {sendState === 'running' ? '…' : 'Send'}
  </button>
</div>
```

- [ ] **Step 3: Styles — append to `src/renderer/src/index.css`**

```css
/* ---- slash-command autocomplete -------------------------------------- */
.composer-mid {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.slash-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  right: 0;
  max-height: 260px;
  overflow-y: auto;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.4);
  z-index: 30;
  display: flex;
  flex-direction: column;
}
.slash-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 7px 12px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  color: var(--text);
  font-size: 12.5px;
}
.slash-item:hover,
.slash-item.selected {
  background: var(--bg-hover);
}
.slash-name {
  font-weight: 600;
  color: var(--accent);
  white-space: nowrap;
}
.slash-desc {
  flex: 1;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slash-src {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-faint);
}
.slash-src-project { color: var(--accent); }
```

- [ ] **Step 4: Build + manual verification**

Run: `npm run build`
Expected: success.

Run: `npm run preview`, open a past session, type `/` in the composer.
Expected: the menu lists commands filtered as you type; ↑/↓ move the highlight; Tab/Enter complete; Esc dismisses; sending `/status` (or any command) gets a reply in the timeline (it executes via `claude --resume`). Close the app.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SlashMenu.jsx src/renderer/src/components/SessionView.jsx src/renderer/src/index.css
git commit -m "feat: slash-command autocomplete in the session composer"
```

---

### Task 9: Parser image extraction — TDD (+ live ring strip)

**Files:**
- Test: `tests/parser-images.test.js` (create)
- Modify: `src/main/parser.js`
- Modify: `src/main/live.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/parser-images.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { parseSessionFile } = require('../src/main/parser')

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function writeSession(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-parse-'))
  const file = path.join(dir, 'session.jsonl')
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return file
}

function imgBlock(data = PNG_B64) {
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data } }
}

test('direct image block in a user message becomes an image timeline item', () => {
  const file = writeSession([
    {
      type: 'user',
      timestamp: '2026-06-09T10:00:00Z',
      message: { content: [imgBlock(), { type: 'text', text: 'what is this?' }] }
    }
  ])
  const s = parseSessionFile(file, { timeline: true })
  const img = s.timeline.find((t) => t.kind === 'image')
  assert.ok(img)
  assert.strictEqual(img.mediaType, 'image/png')
  assert.strictEqual(img.data, PNG_B64)
  assert.strictEqual(s.counts.image, 1)
})

test('image nested in tool_result content is extracted; text excludes base64', () => {
  const file = writeSession([
    {
      type: 'user',
      timestamp: '2026-06-09T10:00:01Z',
      message: {
        content: [
          {
            type: 'tool_result',
            content: [{ type: 'text', text: 'screenshot taken' }, imgBlock()]
          }
        ]
      }
    }
  ])
  const s = parseSessionFile(file, { timeline: true })
  const result = s.timeline.find((t) => t.kind === 'tool_result')
  assert.strictEqual(result.text, 'screenshot taken')
  assert.ok(!result.text.includes(PNG_B64.slice(0, 20)))
  const img = s.timeline.find((t) => t.kind === 'image')
  assert.ok(img)
  assert.strictEqual(img.data, PNG_B64)
})

test('oversized image becomes a truncated placeholder without data', () => {
  const huge = 'A'.repeat(2_000_001)
  const file = writeSession([
    { type: 'user', message: { content: [imgBlock(huge)] } }
  ])
  const s = parseSessionFile(file, { timeline: true })
  const img = s.timeline.find((t) => t.kind === 'image')
  assert.strictEqual(img.truncated, true)
  assert.strictEqual(img.data, undefined)
})

test('non-base64 image sources are ignored', () => {
  const file = writeSession([
    {
      type: 'user',
      message: { content: [{ type: 'image', source: { type: 'url', url: 'https://x/y.png' } }] }
    }
  ])
  const s = parseSessionFile(file, { timeline: true })
  assert.ok(!s.timeline.find((t) => t.kind === 'image'))
  assert.strictEqual(s.counts.image, 0)
})

test('string tool_result content still renders as before', () => {
  const file = writeSession([
    {
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'plain output' }] }
    }
  ])
  const s = parseSessionFile(file, { timeline: true })
  const result = s.timeline.find((t) => t.kind === 'tool_result')
  assert.strictEqual(result.text, 'plain output')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — image timeline items not found / `counts.image` undefined.

- [ ] **Step 3: Implement in `src/main/parser.js`**

Add constants after `MAX_TEXT`:

```js
const MAX_IMAGE_B64 = 2_000_000 // ~1.5 MB decoded; bigger images become placeholders
const MAX_IMAGES = 40 // per parse — a screenshot-heavy session can't bloat the IPC payload
```

In `freshModel`, change the `counts` line to include images:

```js
counts: { user: 0, assistant: 0, toolUse: 0, toolResult: 0, thinking: 0, system: 0, image: 0, total: 0 },
```

Add the image helper after `walkContent`:

```js
/** Push an image content block as a timeline item (with size/count caps). */
function pushImage(block, model, timeline, ts) {
  const src = block && block.source
  if (!src || src.type !== 'base64' || typeof src.data !== 'string') return
  model.counts.image++
  if (!timeline) return
  const mediaType = src.media_type || 'image/png'
  if (src.data.length > MAX_IMAGE_B64 || model.counts.image > MAX_IMAGES) {
    timeline.push({ kind: 'image', ts, truncated: true, mediaType })
    return
  }
  timeline.push({ kind: 'image', ts, mediaType, data: src.data })
}
```

In `walkContent`'s `switch (block.type)`, add an `image` case and replace the `tool_result` case:

```js
      case 'image':
        pushImage(block, model, timeline, ts)
        break
      case 'tool_result': {
        model.counts.toolResult++
        const inner = Array.isArray(block.content) ? block.content : null
        if (timeline) {
          const text = inner
            ? truncate(
                inner
                  .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
                  .map((b) => b.text)
                  .join('\n'),
                600
              )
            : preview(block.content)
          timeline.push({ kind: 'tool_result', ts, isError: !!block.is_error, text })
        }
        if (inner) {
          for (const b of inner) {
            if (b && b.type === 'image') pushImage(b, model, timeline, ts)
          }
        }
        break
      }
```

- [ ] **Step 4: Strip image payloads from the live ring in `src/main/live.js`**

The tracker re-sends its `recent` ring every 1.5 s tick; raw base64 there would be
megabytes per tick. In `_emit`, change the `recent:` line to:

```js
      recent: this.timeline
        ? this.timeline
            .slice(-MAX_RECENT)
            .map((it) => (it.kind === 'image' && it.data ? { ...it, data: undefined, truncated: true } : it))
        : []
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (21 tests)

- [ ] **Step 6: Commit**

```bash
git add tests/parser-images.test.js src/main/parser.js src/main/live.js
git commit -m "feat: parse image content blocks into timeline items (size-capped)"
```

---

### Task 10: Timeline image rendering + Lightbox

**Files:**
- Create: `src/renderer/src/components/Lightbox.jsx`
- Modify: `src/renderer/src/components/SessionView.jsx`
- Modify: `src/renderer/src/index.css`

- [ ] **Step 1: Create `src/renderer/src/components/Lightbox.jsx`**

```jsx
import { useEffect } from 'react'

// Full-size image overlay. Click anywhere or press Esc to close.
export default function Lightbox({ item, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!item) return null
  return (
    <div className="lightbox" onClick={onClose}>
      <img src={`data:${item.mediaType};base64,${item.data}`} alt="session image (full size)" />
    </div>
  )
}
```

- [ ] **Step 2: Render image items in `SessionView.jsx`**

Add import:

```js
import Lightbox from './Lightbox'
```

Add to `KIND_LABEL`:

```js
  image: 'Image'
```

Update `TimelineItem` to take and use an `onImage` callback — replace the whole component with:

```jsx
function TimelineItem({ item, onImage }) {
  const cls = 'tl-item tl-' + item.kind + (item.isError ? ' tl-error' : '')
  return (
    <div className={cls}>
      <div className="tl-gutter">
        <span className="tl-label">{KIND_LABEL[item.kind] || item.kind}</span>
      </div>
      <div className="tl-body">
        {item.kind === 'tool_use' ? (
          <div>
            <span className="tl-tool">{item.toolName}</span>
            {item.toolInput && <pre className="tl-pre">{item.toolInput}</pre>}
          </div>
        ) : item.kind === 'tool_result' ? (
          <pre className="tl-pre tl-dim">{item.text}</pre>
        ) : item.kind === 'image' ? (
          item.truncated ? (
            <div className="tl-img-omitted">🖼 image omitted (too large)</div>
          ) : (
            <img
              className="tl-img"
              src={`data:${item.mediaType};base64,${item.data}`}
              alt="session image"
              onClick={() => onImage && onImage(item)}
            />
          )
        ) : (
          <div className="tl-text">{item.text}</div>
        )}
      </div>
    </div>
  )
}
```

In `SessionView`, add lightbox state (next to the other state):

```js
const [lightbox, setLightbox] = useState(null)
```

Update the timeline map to pass the callback:

```jsx
{(detail.timeline || []).map((item, i) => (
  <TimelineItem key={i} item={item} onImage={setLightbox} />
))}
```

Render the lightbox as the last child inside the root `<div className="session-view">` (after the composer):

```jsx
<Lightbox item={lightbox} onClose={() => setLightbox(null)} />
```

- [ ] **Step 3: Styles — append to `src/renderer/src/index.css`**

```css
/* ---- timeline images + lightbox -------------------------------------- */
.tl-img {
  max-width: min(420px, 100%);
  max-height: 280px;
  border-radius: 8px;
  border: 1px solid var(--border);
  cursor: zoom-in;
  display: block;
}
.tl-img-omitted {
  font-size: 12px;
  color: var(--text-faint);
  font-style: italic;
}
.lightbox {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  cursor: zoom-out;
}
.lightbox img {
  max-width: 92vw;
  max-height: 92vh;
  border-radius: 6px;
  box-shadow: 0 8px 48px rgba(0, 0, 0, 0.6);
}
```

- [ ] **Step 4: Build + manual verification**

Run: `npm run build`
Expected: success.

Run: `npm run preview`, open a session known to contain screenshots/images (any session where Claude read an image or Playwright took a screenshot).
Expected: thumbnails render inline; clicking opens the full-size lightbox; Esc closes it.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Lightbox.jsx src/renderer/src/components/SessionView.jsx src/renderer/src/index.css
git commit -m "feat: render session images inline with click-to-zoom lightbox"
```

---

### Task 11: Image stash IPC (outgoing images, main side)

**Files:**
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

- [ ] **Step 1: Stash handler + cleanup in `src/main/index.js`**

Add after the commands handler:

```js
// ---- Outgoing image stash ---------------------------------------------------
// A pasted/attached image is written to a temp file; the composer references
// its path in the prompt so the resumed claude can Read it. Best-effort
// cleanup on quit.
const stashedImages = []
ipcMain.handle('image:stash', (_e, { data, mediaType }) => {
  try {
    const m = /^image\/(png|jpe?g|gif|webp)$/.exec(mediaType || '')
    const ext = m ? m[1].replace('jpeg', 'jpg') : 'png'
    const file = path.join(
      os.tmpdir(),
      'flux-img-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.' + ext
    )
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    stashedImages.push(file)
    return { ok: true, file }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
```

Add the cleanup hook near the other `app.on(...)` handlers at the bottom:

```js
app.on('will-quit', () => {
  for (const f of stashedImages) {
    try {
      fs.unlinkSync(f)
    } catch {
      /* already gone */
    }
  }
})
```

(`path`, `fs`, and `os` are already required at the top of `index.js`.)

- [ ] **Step 2: Preload bridge in `src/preload/index.js`**

Add after the `commands` namespace:

```js
  image: {
    stash: (args) => ipcRenderer.invoke('image:stash', args)
  }
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat: image:stash IPC writes pasted images to temp files"
```

---

### Task 12: Composer attach + paste + send

**Files:**
- Modify: `src/renderer/src/components/SessionView.jsx`
- Modify: `src/renderer/src/index.css`

- [ ] **Step 1: Attachment state + handlers in `SessionView.jsx`**

Add state (next to the other state declarations):

```js
const [attachment, setAttachment] = useState(null) // { file, name }
const fileInputRef = useRef(null)
```

Add handlers (before `submit`):

```js
// Read an image File/Blob → base64 → stash to a temp file via main process.
const stashImage = (fileObj) => {
  const reader = new FileReader()
  reader.onload = () => {
    const data = String(reader.result).split(',')[1]
    window.flux.image.stash({ data, mediaType: fileObj.type || 'image/png' }).then((res) => {
      if (res && res.ok) setAttachment({ file: res.file, name: fileObj.name || 'pasted image' })
    })
  }
  reader.readAsDataURL(fileObj)
}

const onPaste = (e) => {
  for (const it of e.clipboardData.items) {
    if (it.type.startsWith('image/')) {
      e.preventDefault()
      const f = it.getAsFile()
      if (f) stashImage(f)
      return
    }
  }
}
```

Replace `submit` with (the attachment path is appended as a Read-able file reference because `claude --resume -p` takes a text prompt):

```js
const submit = () => {
  const text = draft.trim()
  if ((!text && !attachment) || sendState === 'running') return
  let msg = text
  if (attachment) {
    msg =
      (text ? text + '\n\n' : '') +
      '[The user attached an image. Read this file to view it: ' + attachment.file + ']'
  }
  totalAtSend.current = totalCount
  setPending(text || '🖼 (image)')
  setDraft('')
  setAttachment(null)
  autoFollow.current = true
  setShowJump(false)
  onSend(msg)
}
```

- [ ] **Step 2: Final composer JSX**

Replace the entire `<div className="sv-composer">…</div>` block (this is the final
combined form including Task 8's slash menu):

```jsx
<div className="sv-composer">
  <button
    className="composer-attach"
    title="Attach image"
    onClick={() => fileInputRef.current && fileInputRef.current.click()}
    disabled={sendState === 'running'}
  >
    📎
  </button>
  <input
    ref={fileInputRef}
    type="file"
    accept="image/*"
    style={{ display: 'none' }}
    onChange={(e) => {
      const f = e.target.files && e.target.files[0]
      if (f) stashImage(f)
      e.target.value = ''
    }}
  />
  <div className="composer-mid">
    {attachment && (
      <div className="composer-chip">
        🖼 {attachment.name}
        <button className="chip-x" onClick={() => setAttachment(null)} title="Remove attachment">
          ✕
        </button>
      </div>
    )}
    {slashItems.length > 0 && (
      <SlashMenu items={slashItems} selected={slashSel} onPick={completeSlash} />
    )}
    <textarea
      className="composer-input"
      placeholder="Message this session…  (Enter to send · Shift+Enter for newline · / for commands · paste images)"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      rows={1}
      disabled={sendState === 'running'}
    />
  </div>
  <button
    className="composer-send"
    onClick={submit}
    disabled={sendState === 'running' || (!draft.trim() && !attachment)}
  >
    {sendState === 'running' ? '…' : 'Send'}
  </button>
</div>
```

- [ ] **Step 3: Styles — append to `src/renderer/src/index.css`**

```css
/* ---- composer attachments -------------------------------------------- */
.composer-attach {
  background: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 15px;
  padding: 6px 9px;
  align-self: flex-end;
}
.composer-attach:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.composer-attach:disabled {
  opacity: 0.5;
  cursor: default;
}
.composer-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  margin-bottom: 6px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elev);
  font-size: 11.5px;
  color: var(--text-dim);
}
.chip-x {
  background: none;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 11px;
  padding: 0 2px;
}
.chip-x:hover { color: var(--text); }
```

- [ ] **Step 4: Build + manual verification**

Run: `npm run build`
Expected: success.

Run: `npm run preview`:
1. Open a past session, screenshot something (Win+Shift+S), Ctrl+V in the composer.
   Expected: a "🖼 pasted image" chip appears.
2. Send with a question like "what's in this image?".
   Expected: claude's reply (referencing the image content) streams into the timeline.
3. Try the 📎 button with an image file.
   Expected: chip appears; ✕ removes it.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SessionView.jsx src/renderer/src/index.css
git commit -m "feat: paste/attach images in composer, sent as Read-able temp files"
```

---

### Task 13: README + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

In the scripts table, add a row:

```markdown
| `npm test` | run unit tests (Node built-in test runner) |
```

In the Roadmap section, under the existing checked items, add:

```markdown
- [x] **Plan usage:** live 5-hour and weekly limit gauges (the same data as `/usage`)
      in the topbar and at the top of every session, with reset countdowns.
- [x] **Slash commands:** `/`-triggered autocomplete in the session composer
      (builtins + your custom `~/.claude/commands` + project commands).
- [x] **Images:** session images render inline with a click-to-zoom lightbox;
      paste or attach an image in the composer to send it.
```

Remove the now-done "Render images embedded in tool results" line from "Possible next steps".

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS — all tests green (21).

- [ ] **Step 3: Full build**

Run: `npm run build`
Expected: all three bundles succeed.

- [ ] **Step 4: Smoke screenshots (real app, real IPC)**

Run (PowerShell, one at a time):

```powershell
$env:FLUX_SMOKE_SHOT = "C:\tmp\flux-final-terminal.png"; npm run preview
Remove-Item Env:FLUX_SMOKE_SHOT
$env:FLUX_SMOKE_SHOT = "C:\tmp\flux-final-session.png"; $env:FLUX_SMOKE_VIEW = "session"; npm run preview
Remove-Item Env:FLUX_SMOKE_SHOT; Remove-Item Env:FLUX_SMOKE_VIEW
```

Expected: both print `FLUX_SMOKE_SHOT_OK`. Inspect both PNGs:
- terminal shot: usage gauges visible in the topbar (or the sign-in notice).
- session shot: detailed usage block in the header; timeline renders.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: README scripts + roadmap for usage/slash/images features"
```

---

## Notes for the implementer

- **Never read `~/.claude/.credentials.json` from your own shell** — the runtime app reads
  it, tests inject fake paths. If a sandbox denial occurs anyway, stop and ask the user.
- `src/main/*` is CommonJS (`require`); `src/renderer/*` is ESM/JSX. Don't mix.
- Renderer changes can't be unit-tested (no DOM test runner in this project — intentional);
  the verification is `npm run build` + the FLUX_SMOKE_SHOT screenshot harness + the manual
  checks written in each task.
- The dev loop (`npm run dev`) has HMR if you prefer it for the manual verification steps,
  but close any running Flux instance first — the PTY and session watchers are singletons.
