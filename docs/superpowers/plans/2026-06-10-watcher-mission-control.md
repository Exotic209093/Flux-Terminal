# Watcher + Notifications (A) and Mission Control (B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flux tells James when a Claude Code session needs him (auto-detect any active session anywhere → OS notification on long-turn-finished / error / blocked / usage-limit), and gives him a one-glance "which session needs me?" grid across all projects.

**Architecture:** One new **background `SessionMonitor`** (main process) scans `~/.claude/projects`, incrementally re-parses recently-active session files, and produces per-session *records*. Those records feed two consumers that share the monitor: a **pure attention state machine** (`attention.js`) whose events drive a **delivery module** (`notify.js`) for Milestone A, and a **pure card composer** (`missioncontrol.js`) for Milestone B. Settings live in a small JSON store (`settings.js`). The existing single-session `LiveTracker`/`LivePanel` (depth view of the foreground session) is left **unchanged** — the monitor is purely additive (breadth view).

**Tech Stack:** Electron 42 (main + preload + React renderer via electron-vite), Node built-in test runner (`node --test`), existing `parser.js` primitives, `electron.Notification` + `BrowserWindow.setOverlayIcon/flashFrame` for OS signals.

---

## Deviations from the original specs (deliberate, spec B invites "adapt to what merged")

1. **Spec A names `autoattach.js` and says "extend live.js's registry."** `live.js` is single-session, not a registry. Instead of retrofitting it (risky — it powers the working live panel), this plan adds an **independent `monitor.js`** that scans all sessions read-only. The foreground `LiveTracker` stays as-is.
2. **Spec A: auto-attached sessions "show in the live UI with an auto origin marker."** The live UI is a single slot. Auto-attached/background sessions surface in **Mission Control** instead (the natural multi-session home, built in this same plan), carrying `origin: 'auto'`. The single `LivePanel` is untouched.
3. **Spec B: push "changed sessions only", debounced ~1s.** Replaced with: push the full composed card list **at most once per monitor tick (3s)** and **only when the cards changed** (`cardsChanged` pure compare). For a few dozen cards this is simpler and equivalent; the per-session diffing is unneeded complexity (YAGNI).
4. **`turn:error` detection is best-effort** (spec already says so). We add a small, documented `isErrorRecord()` marker set to `parser.js` and a manual verification task to tune it against a real errored transcript.

These keep both milestones faithful to intent while matching the code that actually shipped.

---

## File Structure

**New (main):**
- `src/main/settings.js` — `SettingsStore`: schema-versioned JSON read/write-through cache (notification prefs). Reused later by Milestone E.
- `src/main/attention.js` — PURE state machine: `observe()` (turn finished/error/blocked) + `observeUsage()` (threshold). No fs/timers; caller injects `ts`.
- `src/main/monitor.js` — `SessionMonitor`: scans projects, re-parses active files, maintains per-session records, feeds attention, composes+pushes cards. Injectable deps for tests.
- `src/main/notify.js` — `Notifier`: maps attention events → toast/badge/sound per settings, with focus/open-session suppression + per-session coalescing. Injectable `Notification`/window.
- `src/main/missioncontrol.js` — PURE `composeCards()` + `cardsChanged()`.

**New (renderer):**
- `src/renderer/src/components/SettingsPopover.jsx` — notification settings panel (4× three-way + sound checkbox).
- `src/renderer/src/components/MissionControl.jsx` — the grid view.
- `src/renderer/src/components/MissionCard.jsx` — one session card.

**Modified:**
- `src/main/parser.js` — add `errorCount` to the model + `isErrorRecord()` (exported); shared by the live tail for free.
- `src/main/index.js` — instantiate settings/monitor/notify in `whenReady`; add IPC handlers; lifecycle teardown.
- `src/preload/index.js` — add `settings`, `notify`, `missioncontrol` bridges.
- `src/renderer/src/components/ControlBar.jsx` — add a ⚙ gear button that toggles `SettingsPopover`.
- `src/renderer/src/App.jsx` — Mission tab + `Ctrl+M`; handle `notify:open-session`; report open-session id for suppression.
- `src/renderer/src/index.css` — `--alert` token + mission-control / settings-popover styles.

**New tests:** `tests/settings.test.js`, `tests/parser-errors.test.js`, `tests/attention.test.js`, `tests/monitor.test.js`, `tests/notify.test.js`, `tests/missioncontrol.test.js`.

**Shippable checkpoints:** end of **Phase 7** = Milestone A complete and usable on its own. End of **Phase 9** = Milestone B complete.

---

## Conventions for every task

- Tests are CommonJS, `node:test` + `node:assert`, mirroring `tests/usage.test.js`. Run a single file with: `node --test tests/<name>.test.js`. Run all with `npm test`.
- All new pure logic takes an injected `now`/`ts` (ms number) — never call `Date.now()` inside pure functions, exactly like `UsagePoller`.
- Commit after each task with the message shown in its final step.

---

## Phase 1 — Settings store

### Task 1: `SettingsStore`

**Files:**
- Create: `src/main/settings.js`
- Test: `tests/settings.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/settings.test.js
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { SettingsStore, DEFAULTS } = require('../src/main/settings')

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-settings-'))
  return path.join(dir, 'settings.json')
}

test('missing file yields defaults (deep clone, not shared)', () => {
  const s = new SettingsStore(path.join(os.tmpdir(), 'flux-nope', 'x.json'))
  assert.deepStrictEqual(s.get().notify, DEFAULTS.notify)
  s.get().notify.sound = true // mutate the returned copy
  assert.strictEqual(s.get().notify.sound, false) // defaults untouched
})

test('setNotify persists and round-trips through a new instance', () => {
  const file = tmpFile()
  const s = new SettingsStore(file)
  s.setNotify('turnFinished', 'toast')
  s.setNotify('sound', true)
  const reloaded = new SettingsStore(file)
  assert.strictEqual(reloaded.get().notify.turnFinished, 'toast')
  assert.strictEqual(reloaded.get().notify.sound, true)
})

test('setNotify rejects unknown keys and bad modes', () => {
  const s = new SettingsStore(tmpFile())
  assert.throws(() => s.setNotify('bogus', 'toast'))
  assert.throws(() => s.setNotify('turnError', 'sideways'))
  s.setNotify('sound', false) // boolean key accepts boolean
  assert.throws(() => s.setNotify('sound', 'toast'))
})

test('corrupt file falls back to defaults without throwing', () => {
  const file = tmpFile()
  fs.writeFileSync(file, '{not json')
  const s = new SettingsStore(file)
  assert.deepStrictEqual(s.get().notify, DEFAULTS.notify)
})

test('unknown future keys in file are merged under known defaults', () => {
  const file = tmpFile()
  fs.writeFileSync(file, JSON.stringify({ version: 1, notify: { turnError: 'badge' }, futureThing: 7 }))
  const s = new SettingsStore(file)
  assert.strictEqual(s.get().notify.turnError, 'badge') // honored
  assert.strictEqual(s.get().notify.blocked, 'toast') // default filled in
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/settings.test.js`
Expected: FAIL — `Cannot find module '../src/main/settings'`.

- [ ] **Step 3: Implement `settings.js`**

```js
// src/main/settings.js
const fs = require('fs')
const path = require('path')

// Notification preferences. Three-way per event (toast | badge | off) + a sound
// boolean. Defaults match the approved Milestone A table: routine = badge,
// "needs you" = toast, sound off.
const MODES = ['toast', 'badge', 'off']
const EVENT_KEYS = ['turnFinished', 'turnError', 'blocked', 'usageThreshold']

const DEFAULTS = {
  version: 1,
  notify: {
    turnFinished: 'badge',
    turnError: 'toast',
    blocked: 'toast',
    usageThreshold: 'toast',
    sound: false
  }
}

function clone(o) {
  return JSON.parse(JSON.stringify(o))
}

class SettingsStore {
  constructor(file) {
    this.file = file
    this.data = clone(DEFAULTS)
    this._load()
  }

  _load() {
    let raw
    try {
      raw = fs.readFileSync(this.file, 'utf-8')
    } catch {
      return // no file yet → keep defaults
    }
    try {
      const parsed = JSON.parse(raw)
      // Merge known keys over defaults; ignore unknown/legacy fields.
      this.data = clone(DEFAULTS)
      if (parsed && typeof parsed.notify === 'object') {
        for (const k of EVENT_KEYS) {
          if (MODES.includes(parsed.notify[k])) this.data.notify[k] = parsed.notify[k]
        }
        if (typeof parsed.notify.sound === 'boolean') this.data.notify.sound = parsed.notify.sound
      }
    } catch {
      this.data = clone(DEFAULTS) // corrupt → defaults
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
    } catch {
      /* best-effort; in-memory cache still authoritative this session */
    }
  }

  /** A fresh deep copy so callers can't mutate the cache. */
  get() {
    return clone(this.data)
  }

  setNotify(key, value) {
    if (key === 'sound') {
      if (typeof value !== 'boolean') throw new Error('sound must be boolean')
      this.data.notify.sound = value
    } else if (EVENT_KEYS.includes(key)) {
      if (!MODES.includes(value)) throw new Error('invalid mode: ' + value)
      this.data.notify[key] = value
    } else {
      throw new Error('unknown setting key: ' + key)
    }
    this._save()
    return this.get()
  }
}

module.exports = { SettingsStore, DEFAULTS, MODES, EVENT_KEYS }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/settings.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/settings.js tests/settings.test.js
git commit -m "feat(settings): schema-versioned notification settings store with TDD"
```

---

## Phase 2 — Parser error markers

### Task 2: `errorCount` + `isErrorRecord`

**Files:**
- Modify: `src/main/parser.js` (add field to `freshModel`, count in `applyEvent`, export helper)
- Test: `tests/parser-errors.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/parser-errors.test.js
const test = require('node:test')
const assert = require('node:assert')
const { isErrorRecord, freshModel, applyEvent } = require('../src/main/parser')

test('isErrorRecord matches the documented best-effort markers', () => {
  assert.strictEqual(isErrorRecord({ isApiErrorMessage: true }), true)
  assert.strictEqual(isErrorRecord({ type: 'result', is_error: true }), true)
  assert.strictEqual(isErrorRecord({ type: 'system', subtype: 'error' }), true)
  assert.strictEqual(isErrorRecord({ type: 'assistant' }), false)
  assert.strictEqual(isErrorRecord({ type: 'result', is_error: false }), false)
  assert.strictEqual(isErrorRecord(null), false)
})

test('applyEvent increments errorCount on error records only', () => {
  const m = freshModel(null)
  applyEvent({ type: 'assistant', message: { content: [] } }, m, null)
  assert.strictEqual(m.errorCount, 0)
  applyEvent({ isApiErrorMessage: true }, m, null)
  applyEvent({ type: 'result', is_error: true }, m, null)
  assert.strictEqual(m.errorCount, 2)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/parser-errors.test.js`
Expected: FAIL — `isErrorRecord is not a function` and `m.errorCount` is `undefined`.

- [ ] **Step 3: Edit `parser.js`**

In `freshModel()` add the field next to `parseErrors` (around `src/main/parser.js:77`):

```js
    parseErrors: 0,
    errorCount: 0, // best-effort count of error/failure records (attention.js consumes deltas)
    lineCount: 0
```

Add this helper above `applyEvent` (after `freshModel`, around `src/main/parser.js:81`):

```js
/**
 * Best-effort: does this record look like a turn/API error/failure?
 * The Claude Code JSONL schema drifts, so this is a tunable marker set, not a
 * contract — verify against a real errored transcript (see plan Phase 6 manual step).
 */
function isErrorRecord(o) {
  if (!o || typeof o !== 'object') return false
  if (o.isApiErrorMessage === true) return true
  if (o.type === 'result' && o.is_error === true) return true
  if (o.type === 'system' && o.subtype === 'error') return true
  return false
}
```

In `applyEvent()`, add the count immediately after `model.lineCount++` (around `src/main/parser.js:84`):

```js
function applyEvent(o, model, timeline) {
  model.lineCount++
  if (isErrorRecord(o)) model.errorCount++
```

Update the exports line at the bottom (`src/main/parser.js:248`):

```js
module.exports = { parseSessionFile, parseLine, freshModel, applyEvent, finalize, isErrorRecord }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/parser-errors.test.js tests/parser-images.test.js`
Expected: PASS, and the existing parser-images tests still pass (no regression).

- [ ] **Step 5: Commit**

```bash
git add src/main/parser.js tests/parser-errors.test.js
git commit -m "feat(parser): best-effort errorCount + isErrorRecord for attention detection"
```

---

## Phase 3 — Attention state machine (pure)

### Task 3: turn finished / error / blocked

**Files:**
- Create: `src/main/attention.js`
- Test: `tests/attention.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/attention.test.js
const test = require('node:test')
const assert = require('node:assert')
const {
  createAttentionState, observe, createUsageState, observeUsage,
  MIN_TURN_MS, BLOCKED_MS
} = require('../src/main/attention')

// obs = { ts, mtimeMs, userCount, assistantCount, errorCount }
function obs(ts, mtimeMs, u, a, e = 0) {
  return { ts, mtimeMs, userCount: u, assistantCount: a, errorCount: e }
}

test('first observation only establishes a baseline (no events)', () => {
  const s = createAttentionState()
  const ev = observe(s, obs(1000, 1000, 3, 3, 0))
  assert.deepStrictEqual(ev, [])
})

test('a long turn emits turn:finished; a short one does not', () => {
  const s = createAttentionState()
  observe(s, obs(0, 0, 0, 0)) // baseline
  observe(s, obs(1000, 1000, 1, 0)) // user msg → turn opens at ts=1000
  const ev = observe(s, obs(1000 + MIN_TURN_MS + 1, 5000, 1, 1)) // assistant closes, long
  assert.strictEqual(ev.length, 1)
  assert.strictEqual(ev[0].type, 'turn:finished')

  // short turn: open and close within MIN_TURN_MS
  const s2 = createAttentionState()
  observe(s2, obs(0, 0, 0, 0))
  observe(s2, obs(1000, 1000, 1, 0))
  const ev2 = observe(s2, obs(1000 + 5000, 2000, 1, 1))
  assert.deepStrictEqual(ev2, [])
})

test('error record during an open turn emits turn:error once and closes the turn', () => {
  const s = createAttentionState()
  observe(s, obs(0, 0, 0, 0))
  observe(s, obs(1000, 1000, 1, 0)) // turn open
  const ev = observe(s, obs(2000, 1500, 1, 0, 1)) // error appears
  assert.strictEqual(ev.length, 1)
  assert.strictEqual(ev[0].type, 'turn:error')
  // a later assistant message must NOT also fire turn:finished (turn already closed)
  const ev2 = observe(s, obs(3000 + MIN_TURN_MS, 1600, 1, 1, 1))
  assert.deepStrictEqual(ev2, [])
})

test('blocked fires once when an open turn goes silent past BLOCKED_MS', () => {
  const s = createAttentionState()
  observe(s, obs(0, 0, 0, 0))
  observe(s, obs(1000, 1000, 1, 0)) // turn open, last write ts=1000
  const quiet = observe(s, obs(1000 + BLOCKED_MS + 1, 1000, 1, 0)) // mtime unchanged
  assert.strictEqual(quiet.length, 1)
  assert.strictEqual(quiet[0].type, 'blocked')
  const again = observe(s, obs(1000 + BLOCKED_MS + 5000, 1000, 1, 0)) // still quiet
  assert.deepStrictEqual(again, []) // once per turn
})

test('a write (mtime change) resets the blocked clock', () => {
  const s = createAttentionState()
  observe(s, obs(0, 0, 0, 0))
  observe(s, obs(1000, 1000, 1, 0))
  observe(s, obs(1000 + 60000, 2000, 1, 0)) // wrote at 61s → clock resets
  const ev = observe(s, obs(1000 + 60000 + 60000, 2000, 1, 0)) // 60s more silence < BLOCKED_MS
  assert.deepStrictEqual(ev, [])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/attention.test.js`
Expected: FAIL — `Cannot find module '../src/main/attention'`.

- [ ] **Step 3: Implement `attention.js` (turn logic)**

```js
// src/main/attention.js
// PURE attention state machine. No fs, no timers, no Date.now(): the caller
// injects wall-clock ms as obs.ts. Turn duration uses observation wall-clock
// (not transcript timestamps) so clock skew in the file can't fool us.

const MIN_TURN_MS = 30_000 // turns shorter than this never notify (turn:finished)
const BLOCKED_MS = 90_000 // open turn + no file writes for this long => blocked
const USAGE_THRESHOLD = 90 // window utilization % that triggers usage:threshold

function createAttentionState() {
  return {
    started: false,
    lastUserCount: 0,
    lastAssistantCount: 0,
    lastErrorCount: 0,
    turnOpen: false,
    turnOpenedAt: 0,
    lastMtime: 0,
    lastWriteTs: 0,
    blockedEmitted: false,
    errorEmitted: false
  }
}

/**
 * Feed one observation; returns an array of attention events (possibly empty),
 * mutating `state`. obs = { ts, mtimeMs, userCount, assistantCount, errorCount }.
 */
function observe(state, obs) {
  const events = []
  const ts = obs.ts

  // First observation = baseline only. Never fire on pre-existing history.
  if (!state.started) {
    state.started = true
    state.lastUserCount = obs.userCount
    state.lastAssistantCount = obs.assistantCount
    state.lastErrorCount = obs.errorCount
    state.lastMtime = obs.mtimeMs
    state.lastWriteTs = ts
    return events
  }

  // A write (mtime changed) resets the blocked clock.
  if (obs.mtimeMs !== state.lastMtime) {
    state.lastMtime = obs.mtimeMs
    state.lastWriteTs = ts
  }

  // New user message → a turn opened.
  if (obs.userCount > state.lastUserCount) {
    state.turnOpen = true
    state.turnOpenedAt = ts
    state.blockedEmitted = false
    state.errorEmitted = false
  }

  // New error record while a turn is open → turn:error (once), closes the turn.
  if (obs.errorCount > state.lastErrorCount && state.turnOpen && !state.errorEmitted) {
    events.push({ type: 'turn:error', ts })
    state.errorEmitted = true
    state.turnOpen = false
  }

  // New assistant message closing an open turn → turn:finished if long enough.
  if (obs.assistantCount > state.lastAssistantCount && state.turnOpen) {
    const durationMs = ts - state.turnOpenedAt
    if (durationMs >= MIN_TURN_MS) events.push({ type: 'turn:finished', ts, durationMs })
    state.turnOpen = false
  }

  // Blocked: turn still open, no writes for BLOCKED_MS (once per turn).
  if (state.turnOpen && !state.blockedEmitted && ts - state.lastWriteTs >= BLOCKED_MS) {
    events.push({ type: 'blocked', ts, idleMs: ts - state.lastWriteTs })
    state.blockedEmitted = true
  }

  state.lastUserCount = obs.userCount
  state.lastAssistantCount = obs.assistantCount
  state.lastErrorCount = obs.errorCount
  return events
}

// ---- Usage thresholds (separate, from UsagePoller windows) -------------------
const USAGE_WINDOWS = ['fiveHour', 'sevenDay', 'sevenDayOpus', 'sevenDaySonnet']

function createUsageState() {
  return {} // windowKey -> { resetsAt, fired }
}

/**
 * Given normalized usage windows ({ utilization, resetsAt } each), emit one
 * usage:threshold per window per reset cycle when utilization crosses 90%.
 */
function observeUsage(state, windows, ts) {
  const events = []
  if (!windows) return events
  for (const key of USAGE_WINDOWS) {
    const w = windows[key]
    if (!w || typeof w.utilization !== 'number') continue
    const resetsAt = w.resetsAt || null
    if (!state[key] || state[key].resetsAt !== resetsAt) {
      state[key] = { resetsAt, fired: false } // new window cycle → re-arm
    }
    const slot = state[key]
    if (w.utilization >= USAGE_THRESHOLD && !slot.fired) {
      events.push({ type: 'usage:threshold', ts, window: key, utilization: w.utilization, resetsAt })
      slot.fired = true
    }
  }
  return events
}

module.exports = {
  createAttentionState, observe, createUsageState, observeUsage,
  MIN_TURN_MS, BLOCKED_MS, USAGE_THRESHOLD, USAGE_WINDOWS
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/attention.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/attention.js tests/attention.test.js
git commit -m "feat(attention): pure turn finished/error/blocked state machine with TDD"
```

### Task 4: usage threshold events

**Files:**
- Test: `tests/attention.test.js` (append)

- [ ] **Step 1: Append the failing test**

```js
test('usage:threshold fires once per window per reset cycle', () => {
  const us = createUsageState()
  const w = (u, resetsAt) => ({ fiveHour: { utilization: u, resetsAt }, sevenDay: null, sevenDayOpus: null, sevenDaySonnet: null })
  assert.deepStrictEqual(observeUsage(us, w(50, 'R1'), 1), [])
  const ev = observeUsage(us, w(91, 'R1'), 2)
  assert.strictEqual(ev.length, 1)
  assert.strictEqual(ev[0].type, 'usage:threshold')
  assert.strictEqual(ev[0].window, 'fiveHour')
  assert.deepStrictEqual(observeUsage(us, w(95, 'R1'), 3), []) // same cycle → silent
  const ev2 = observeUsage(us, w(95, 'R2'), 4) // new reset boundary → re-arms
  assert.strictEqual(ev2.length, 1)
})

test('observeUsage tolerates null windows', () => {
  assert.deepStrictEqual(observeUsage(createUsageState(), null, 1), [])
})
```

- [ ] **Step 2: Run to verify it passes** (the impl from Task 3 already covers this)

Run: `node --test tests/attention.test.js`
Expected: PASS (7 tests). If it fails, fix `observeUsage` in `attention.js`, not the test.

- [ ] **Step 3: Commit**

```bash
git add tests/attention.test.js
git commit -m "test(attention): usage threshold once-per-cycle coverage"
```

---

## Phase 4 — Session monitor

### Task 5: `SessionMonitor` with injectable deps

**Files:**
- Create: `src/main/monitor.js`
- Test: `tests/monitor.test.js`

The monitor is the only fs/timer glue, but it accepts injected `deps` (`listFiles`, `parseFile`, `countSub`, `now`) so the engine is unit-testable without a real `~/.claude` tree — the same pattern `UsagePoller` uses for `fetchUsage`.

- [ ] **Step 1: Write the failing test**

```js
// tests/monitor.test.js
const test = require('node:test')
const assert = require('node:assert')
const { SessionMonitor, isRecentlyActive } = require('../src/main/monitor')

test('isRecentlyActive compares mtime against now within window', () => {
  assert.strictEqual(isRecentlyActive(1000, 1000 + 5000, 10000), true)
  assert.strictEqual(isRecentlyActive(1000, 1000 + 20000, 10000), false)
})

// A scripted fake world: each "tick" the test advances `now` and mutates files.
function makeWorld() {
  return {
    now: 0,
    files: [], // [{ sessionId, file, projectDir, projectApprox, mtimeMs }]
    parsed: {} // file -> parse result
  }
}

function monitorFor(world, sinks) {
  return new SessionMonitor({
    now: () => world.now,
    tickMs: 1000,
    activeWindowMs: 60000,
    recentWindowMs: 24 * 3600 * 1000,
    listFiles: () => world.files,
    parseFile: (file) => world.parsed[file],
    countSub: () => ({ running: 0, total: 0 }),
    getOpenSessionId: () => null,
    onAttention: sinks.onAttention,
    onCards: sinks.onCards
  })
}

test('a long turn across ticks produces a turn:finished attention event', () => {
  const world = makeWorld()
  const attn = []
  const cards = []
  const mon = monitorFor(world, { onAttention: (e) => attn.push(e), onCards: (c) => cards.push(c) })

  const file = '/p/s1.jsonl'
  const base = { sessionId: 's1', file, projectDir: 'p', projectApprox: 'C:\\p' }
  world.files = [{ ...base, mtimeMs: 0 }]
  world.parsed[file] = { ok: true, sessionId: 's1', cwd: 'C:\\p', title: 't', models: ['claude-x'],
    counts: { user: 0, assistant: 0 }, usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    errorCount: 0, timeline: [], lastTimestamp: null }

  mon._tick() // baseline

  world.now = 1000
  world.files = [{ ...base, mtimeMs: 1000 }]
  world.parsed[file] = { ...world.parsed[file], counts: { user: 1, assistant: 0 } } // turn opens
  mon._tick()

  world.now = 1000 + 31000
  world.files = [{ ...base, mtimeMs: 30000 }]
  world.parsed[file] = { ...world.parsed[file], counts: { user: 1, assistant: 1 } } // closes, long
  mon._tick()

  const finished = attn.filter((e) => e.event.type === 'turn:finished')
  assert.strictEqual(finished.length, 1)
  assert.strictEqual(finished[0].sessionId, 's1')
  assert.ok(cards.length >= 1) // cards pushed when state changed
})

test('idle (beyond recent window) sessions are pruned from cards', () => {
  const world = makeWorld()
  const cards = []
  const mon = monitorFor(world, { onAttention: () => {}, onCards: (c) => { cards.length = 0; cards.push(...c) } })
  const file = '/p/old.jsonl'
  world.parsed[file] = { ok: true, sessionId: 'old', cwd: 'C:\\p', title: 'old', models: [],
    counts: { user: 1, assistant: 1 }, usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    errorCount: 0, timeline: [], lastTimestamp: null }
  world.now = 100 * 24 * 3600 * 1000
  world.files = [{ sessionId: 'old', file, projectDir: 'p', projectApprox: 'C:\\p', mtimeMs: 0 }] // ancient
  mon._tick()
  assert.strictEqual(cards.length, 0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/monitor.test.js`
Expected: FAIL — `Cannot find module '../src/main/monitor'`.

- [ ] **Step 3: Implement `monitor.js`**

```js
// src/main/monitor.js
const sessionsMod = require('./sessions')
const parserMod = require('./parser')
const subagentsMod = require('./subagents')
const { createAttentionState, observe } = require('./attention')
const { composeCards, cardsChanged } = require('./missioncontrol')

const TICK_MS = 3000
const ACTIVE_WINDOW_MS = 60_000 // file written this recently => "active" (drive attention)
const RECENT_WINDOW_MS = 24 * 3600 * 1000 // shown in Mission Control
const MAX_CARDS = 40
const FINISHED_HOLD_MS = 5 * 60_000 // how long an error stays "unacked" without a new turn

function isRecentlyActive(mtimeMs, now, windowMs) {
  return now - mtimeMs <= windowMs
}

/** Last assistant-text snippet from a parsed timeline (1–2 lines). */
function snippetOf(parsed) {
  const tl = parsed && parsed.timeline
  if (!Array.isArray(tl)) return ''
  for (let i = tl.length - 1; i >= 0; i--) {
    const it = tl[i]
    if (it && it.kind === 'text' && it.text) return it.text.split('\n').slice(0, 2).join(' ').slice(0, 160)
  }
  return ''
}

function lastRoleOf(parsed) {
  const tl = parsed && parsed.timeline
  if (!Array.isArray(tl) || !tl.length) return null
  const last = tl[tl.length - 1]
  return last.kind === 'user' ? 'user' : 'assistant'
}

class SessionMonitor {
  constructor(opts = {}) {
    this.now = opts.now || Date.now
    this.tickMs = opts.tickMs || TICK_MS
    this.activeWindowMs = opts.activeWindowMs || ACTIVE_WINDOW_MS
    this.recentWindowMs = opts.recentWindowMs || RECENT_WINDOW_MS
    this.listFiles = opts.listFiles || sessionsMod.listSessionFiles
    this.parseFile = opts.parseFile || ((file) => parserMod.parseSessionFile(file, { timeline: true }))
    this.countSub = opts.countSub || ((file) => subagentsMod.countSubagents(file, { live: true }))
    this.getOpenSessionId = opts.getOpenSessionId || (() => null)
    this.onAttention = opts.onAttention || (() => {})
    this.onCards = opts.onCards || (() => {})
    this.records = new Map() // sessionId -> record
    this.lastCards = null
    this.timer = null
  }

  start() {
    if (this.timer) return
    this._tick()
    this.timer = setInterval(() => this._tick(), this.tickMs)
    if (this.timer.unref) this.timer.unref()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  _ensure(meta) {
    let rec = this.records.get(meta.sessionId)
    if (!rec) {
      rec = {
        sessionId: meta.sessionId,
        file: meta.file,
        project: meta.projectApprox,
        cwd: meta.projectApprox,
        title: meta.sessionId.slice(0, 8),
        model: null,
        costUsd: 0,
        subagents: { running: 0, total: 0 },
        lastSnippet: '',
        lastActivityMs: meta.mtimeMs,
        lastRole: null,
        hasError: false,
        blocked: false,
        turnOpen: false,
        origin: 'auto',
        _mtime: -1,
        _attn: createAttentionState()
      }
      this.records.set(meta.sessionId, rec)
    }
    return rec
  }

  _tick() {
    const now = this.now()
    const files = this.listFiles().filter((f) => isRecentlyActive(f.mtimeMs, now, this.recentWindowMs))
    const recent = files.slice(0, MAX_CARDS)
    const seen = new Set()

    for (const meta of recent) {
      seen.add(meta.sessionId)
      const rec = this._ensure(meta)
      const active = isRecentlyActive(meta.mtimeMs, now, this.activeWindowMs)
      // Re-parse only when the file grew/changed, or first time.
      if (meta.mtimeMs !== rec._mtime) {
        rec._mtime = meta.mtimeMs
        const parsed = this.parseFile(meta.file)
        if (parsed && parsed.ok !== false) {
          rec.title = parsed.title || rec.title
          rec.cwd = parsed.cwd || rec.cwd
          rec.model = (parsed.models && parsed.models[0]) || rec.model
          rec.costUsd = estimateCostUsd(parsed.usage, rec.model)
          rec.lastSnippet = snippetOf(parsed)
          rec.lastRole = lastRoleOf(parsed)
          rec.lastActivityMs = meta.mtimeMs
          rec._parsedCounts = { user: parsed.counts.user, assistant: parsed.counts.assistant }
          rec._errorCount = parsed.errorCount || 0
        }
        rec.subagents = safe(() => this.countSub(meta.file), { running: 0, total: 0 })
      }

      // Drive attention only for active sessions (cheap: counts already parsed).
      if (active && rec._parsedCounts) {
        const events = observe(rec._attn, {
          ts: now,
          mtimeMs: meta.mtimeMs,
          userCount: rec._parsedCounts.user,
          assistantCount: rec._parsedCounts.assistant,
          errorCount: rec._errorCount || 0
        })
        for (const event of events) {
          if (event.type === 'turn:error') { rec.hasError = true; rec._errorAt = now }
          this.onAttention({ sessionId: rec.sessionId, project: rec.project, title: rec.title, event })
        }
        // standing status derived from the live attention state
        rec.turnOpen = rec._attn.turnOpen
        rec.blocked = rec._attn.turnOpen && rec._attn.blockedEmitted
        if (rec._attn.turnOpen && rec.hasError) rec.hasError = false // a new turn clears the alert
      }
      if (rec.hasError && rec._errorAt && now - rec._errorAt > FINISHED_HOLD_MS) rec.hasError = false
    }

    // Prune records that dropped out of the recent window.
    for (const id of [...this.records.keys()]) if (!seen.has(id)) this.records.delete(id)

    const cards = composeCards([...this.records.values()], now)
    if (cardsChanged(this.lastCards, cards)) {
      this.lastCards = cards
      this.onCards(cards)
    }
  }

  /** Current cards on demand (for the missioncontrol:list IPC). */
  cards() {
    return composeCards([...this.records.values()], this.now())
  }
}

function safe(fn, fallback) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

// Cost from usage. Reuse the renderer's pricing table? No — that's renderer-side.
// Keep a tiny self-contained estimate here so the monitor stays main-only and
// testable. Mirrors pricing.js intent: tokens × per-Mtoken rate. (Coarse — the
// card shows "~$x"; exact cost lives in the live panel.)
const APPROX_PER_MTOK = { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 }
function estimateCostUsd(usage, _model) {
  if (!usage) return 0
  const u = usage
  const c =
    ((u.input || 0) * APPROX_PER_MTOK.input +
      (u.output || 0) * APPROX_PER_MTOK.output +
      (u.cacheRead || 0) * APPROX_PER_MTOK.cacheRead +
      (u.cacheCreation || 0) * APPROX_PER_MTOK.cacheCreation) /
    1_000_000
  return Math.round(c * 100) / 100
}

module.exports = { SessionMonitor, isRecentlyActive, snippetOf, lastRoleOf, estimateCostUsd }
```

> Note: `monitor.js` requires `./missioncontrol`, built in Phase 8. Phases 4 and 8 must both be merged before the monitor runs; the monitor *unit tests* in this task stub nothing from missioncontrol that isn't pure, so create a minimal `missioncontrol.js` now if running this task in isolation — but the recommended order builds Phase 8 right after Phase 4's logic is settled. **To keep tests green in this task, do Phase 8 Task 11 (`composeCards`/`cardsChanged`) BEFORE running this task's tests.** (They are tiny and pure.) The execution order below reflects this.

- [ ] **Step 2 (revised): create `missioncontrol.js` first** — jump to Phase 8 Task 11, implement `composeCards`/`cardsChanged`, return here.

- [ ] **Step 3: Run the monitor test to verify it passes**

Run: `node --test tests/monitor.test.js`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add src/main/monitor.js tests/monitor.test.js
git commit -m "feat(monitor): background SessionMonitor feeding attention + cards (injectable deps, TDD)"
```

---

## Phase 5 — Notification delivery

### Task 6: `Notifier` (mapping, suppression, coalescing)

**Files:**
- Create: `src/main/notify.js`
- Test: `tests/notify.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/notify.test.js
const test = require('node:test')
const assert = require('node:assert')
const { Notifier, titleFor } = require('../src/main/notify')

function fakeWin() {
  return {
    focused: false,
    overlay: null,
    flashed: false,
    isFocused() { return this.focused },
    isDestroyed() { return false },
    setOverlayIcon(img, desc) { this.overlay = desc },
    flashFrame(b) { this.flashed = b },
    focus() { this.focused = true },
    webContents: { send() {} }
  }
}

function fakeNotificationFactory(sink) {
  return class FakeNotification {
    constructor(opts) { this.opts = opts; sink.created.push(opts) }
    show() { sink.shown.push(this.opts) }
    on() {}
  }
}

const SETTINGS = { notify: { turnFinished: 'badge', turnError: 'toast', blocked: 'toast', usageThreshold: 'toast', sound: false } }

function makeNotifier(world) {
  return new Notifier({
    getWindow: () => world.win,
    getSettings: () => world.settings,
    getOpenSessionId: () => world.openId,
    NotificationImpl: fakeNotificationFactory(world.sink),
    beep: () => world.beeps++,
    now: () => world.now
  })
}

function world() {
  return { win: fakeWin(), settings: JSON.parse(JSON.stringify(SETTINGS)), openId: null, now: 0, beeps: 0,
    sink: { created: [], shown: [] } }
}

test('toast event shows a Notification', () => {
  const w = world()
  makeNotifier(w).deliver({ sessionId: 's', title: 'My sesh', event: { type: 'turn:error' } })
  assert.strictEqual(w.sink.shown.length, 1)
  assert.match(w.sink.shown[0].title, /error/i)
})

test('badge event sets overlay + flash, no toast', () => {
  const w = world()
  makeNotifier(w).deliver({ sessionId: 's', title: 'x', event: { type: 'turn:finished' } })
  assert.strictEqual(w.sink.shown.length, 0)
  assert.ok(w.win.overlay)
  assert.strictEqual(w.win.flashed, true)
})

test('off mode delivers nothing', () => {
  const w = world()
  w.settings.notify.turnError = 'off'
  makeNotifier(w).deliver({ sessionId: 's', title: 'x', event: { type: 'turn:error' } })
  assert.strictEqual(w.sink.shown.length, 0)
  assert.strictEqual(w.win.overlay, null)
})

test('suppressed when window focused AND that session is open', () => {
  const w = world()
  w.win.focused = true
  w.openId = 's'
  makeNotifier(w).deliver({ sessionId: 's', title: 'x', event: { type: 'turn:error' } })
  assert.strictEqual(w.sink.shown.length, 0)
  // a DIFFERENT open session does not suppress
  w.openId = 'other'
  makeNotifier(w).deliver({ sessionId: 's', title: 'x', event: { type: 'turn:error' } })
  assert.strictEqual(w.sink.shown.length, 1)
})

test('coalesces repeat events for the same session within 10s', () => {
  const w = world()
  const n = makeNotifier(w)
  n.deliver({ sessionId: 's', title: 'x', event: { type: 'turn:error' } })
  w.now = 5000
  n.deliver({ sessionId: 's', title: 'x', event: { type: 'turn:error' } }) // within 10s → dropped
  assert.strictEqual(w.sink.shown.length, 1)
  w.now = 11000
  n.deliver({ sessionId: 's', title: 'x', event: { type: 'turn:error' } }) // window passed
  assert.strictEqual(w.sink.shown.length, 2)
})

test('sound beeps only when enabled', () => {
  const w = world()
  w.settings.notify.sound = true
  makeNotifier(w).deliver({ sessionId: 's', title: 'x', event: { type: 'turn:error' } })
  assert.strictEqual(w.beeps, 1)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/notify.test.js`
Expected: FAIL — `Cannot find module '../src/main/notify'`.

- [ ] **Step 3: Implement `notify.js`**

```js
// src/main/notify.js
// Maps attention events to OS signals per the settings store, with suppression
// (don't nag about the session you're already looking at) and per-session
// coalescing (no storms). All side-effecting deps are injected for testing.

const EVENT_SETTING = {
  'turn:finished': 'turnFinished',
  'turn:error': 'turnError',
  blocked: 'blocked',
  'usage:threshold': 'usageThreshold'
}
const COALESCE_MS = 10_000

function titleFor(notice) {
  const t = notice.title || 'Session'
  switch (notice.event.type) {
    case 'turn:finished':
      return { title: '✓ Turn finished', body: t }
    case 'turn:error':
      return { title: '⚠ Session error', body: t }
    case 'blocked':
      return { title: '⏳ Waiting on you', body: t }
    case 'usage:threshold':
      return { title: '📊 Usage limit near', body: `${notice.event.window} at ${notice.event.utilization}%` }
    default:
      return { title: 'Flux', body: t }
  }
}

class Notifier {
  constructor(opts = {}) {
    this.getWindow = opts.getWindow || (() => null)
    this.getSettings = opts.getSettings || (() => ({ notify: {} }))
    this.getOpenSessionId = opts.getOpenSessionId || (() => null)
    this.NotificationImpl = opts.NotificationImpl
    this.beep = opts.beep || (() => {})
    this.now = opts.now || Date.now
    this.lastDelivered = new Map() // sessionId -> ts
  }

  deliver(notice) {
    const setting = this.getSettings().notify || {}
    const mode = setting[EVENT_SETTING[notice.event.type]] || 'off'
    if (mode === 'off') return

    const win = this.getWindow()
    // Suppress if you're focused on exactly this session already.
    if (win && !win.isDestroyed() && win.isFocused() && this.getOpenSessionId() === notice.sessionId) return

    // Coalesce repeats per session.
    const now = this.now()
    const last = this.lastDelivered.get(notice.sessionId)
    if (last != null && now - last < COALESCE_MS) return
    this.lastDelivered.set(notice.sessionId, now)

    if (mode === 'toast') this._toast(notice)
    else if (mode === 'badge') this._badge()

    if (setting.sound) this.beep()
  }

  _toast(notice) {
    if (!this.NotificationImpl) return
    const { title, body } = titleFor(notice)
    const n = new this.NotificationImpl({ title, body })
    n.on('click', () => {
      const win = this.getWindow()
      if (win && !win.isDestroyed()) {
        if (win.isMinimized && win.isMinimized()) win.restore()
        win.focus()
        win.webContents.send('notify:open-session', { sessionId: notice.sessionId })
      }
    })
    n.show()
  }

  _badge() {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    try {
      win.flashFrame(true)
      // setOverlayIcon needs a nativeImage; a tiny dot is fine. Caller may pass a
      // prebuilt image via getWindow().__fluxDot; otherwise description-only is OK
      // on Win11 (overlay is best-effort, flashFrame is the reliable signal).
      if (win.__fluxDot) win.setOverlayIcon(win.__fluxDot, 'needs attention')
    } catch {
      /* overlay unsupported on this platform — flashFrame already fired */
    }
  }

  /** Called when the window regains focus: clear badge/flash. */
  clear() {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    try {
      win.flashFrame(false)
      win.setOverlayIcon(null, '')
    } catch {
      /* ignore */
    }
  }
}

module.exports = { Notifier, titleFor, COALESCE_MS, EVENT_SETTING }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/notify.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/notify.js tests/notify.test.js
git commit -m "feat(notify): event->toast/badge delivery with suppression + coalescing (TDD)"
```

---

## Phase 6 — Wire Milestone A into main + preload

### Task 7: instantiate settings/monitor/notify + IPC + lifecycle

**Files:**
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

- [ ] **Step 1: Add requires** at the top of `src/main/index.js` (after line 15, the `PromptStore` require):

```js
const { SettingsStore } = require('./settings')
const { SessionMonitor } = require('./monitor')
const { Notifier } = require('./notify')
const { Notification } = require('electron')
```

(`Notification` joins the existing `const { app, BrowserWindow, ipcMain, dialog } = require('electron')` — either extend that destructure or add the line above; do not double-declare.)

- [ ] **Step 2: Add module-level holders** near the other `let` holders (around `src/main/index.js:20`):

```js
let settingsStore = null
let sessionMonitor = null
let notifier = null
let openSessionId = null // which session the renderer currently has open (for not-suppression)
```

- [ ] **Step 3: Add IPC handlers** — place this block next to the other handlers (e.g. after the prompt-library block, around `src/main/index.js:205`):

```js
// ---- Notification settings --------------------------------------------------
ipcMain.handle('settings:get', () => (settingsStore ? settingsStore.get() : null))
ipcMain.handle('settings:setNotify', (_e, { key, value }) => {
  try {
    if (!settingsStore) return { ok: false, error: 'not ready' }
    return { ok: true, settings: settingsStore.setNotify(key, value) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// Renderer tells main which session is open so we don't toast about it while it's focused.
ipcMain.on('notify:setOpenSession', (_e, sessionId) => {
  openSessionId = sessionId || null
})

// ---- Mission Control --------------------------------------------------------
ipcMain.handle('missioncontrol:list', () => {
  try {
    return { ok: true, cards: sessionMonitor ? sessionMonitor.cards() : [] }
  } catch (err) {
    return { ok: false, error: err.message, cards: [] }
  }
})
```

- [ ] **Step 4: Instantiate in `whenReady`.** The existing `whenReady` block (around `src/main/index.js:438-445`) currently sets up `liveTracker` then does:

```js
  usagePoller = new UsagePoller((snap) => emit('usage:update', snap))
  usagePoller.start()
```

Make TWO edits inside `whenReady`:

**(a)** Immediately after `promptStore.seed()` (around `src/main/index.js:436`), add settings + notifier + monitor (order matters — notifier needs `settingsStore`, monitor's attention drives `notifier`):

```js
  settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'))

  notifier = new Notifier({
    getWindow: () => mainWindow,
    getSettings: () => settingsStore.get(),
    getOpenSessionId: () => openSessionId,
    NotificationImpl: Notification,
    beep: () => require('electron').shell.beep()
  })

  sessionMonitor = new SessionMonitor({
    getOpenSessionId: () => openSessionId,
    onAttention: (notice) => notifier.deliver(notice),
    onCards: (cards) => emit('missioncontrol:update', cards)
  })
  sessionMonitor.start()

  // Clear badge/flash when the user comes back to the window.
  mainWindow.on('focus', () => notifier && notifier.clear())
```

**(b)** REPLACE the two existing `usagePoller` lines with this augmented construction (so the usage poll also feeds threshold notifications — `notifier` now exists from edit (a)):

```js
  const { createUsageState, observeUsage } = require('./attention')
  const usageAttn = createUsageState()
  usagePoller = new UsagePoller((snap) => {
    emit('usage:update', snap)
    if (snap && snap.windows && notifier) {
      for (const event of observeUsage(usageAttn, snap.windows, Date.now())) {
        notifier.deliver({ sessionId: 'usage', project: '', title: 'Plan usage', event })
      }
    }
  })
  usagePoller.start()
```

Net result: `settingsStore`, `notifier`, `sessionMonitor` each instantiated once; `usagePoller` constructed once (with the augmented callback) and started once.

- [ ] **Step 5: Lifecycle teardown** — in `app.on('window-all-closed', ...)` (around `src/main/index.js:519`), add next to `usagePoller.stop()`:

```js
  if (sessionMonitor) sessionMonitor.stop()
```

- [ ] **Step 6: Extend the preload bridge** — in `src/preload/index.js`, add to the `flux` object (after the `prompts` block, before the closing `})`):

```js
  ,
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setNotify: (key, value) => ipcRenderer.invoke('settings:setNotify', { key, value })
  },
  notify: {
    setOpenSession: (sessionId) => ipcRenderer.send('notify:setOpenSession', sessionId),
    onOpenSession: (cb) => {
      const listener = (_e, payload) => cb(payload)
      ipcRenderer.on('notify:open-session', listener)
      return () => ipcRenderer.removeListener('notify:open-session', listener)
    }
  },
  missioncontrol: {
    list: () => ipcRenderer.invoke('missioncontrol:list'),
    onUpdate: (cb) => {
      const listener = (_e, cards) => cb(cards)
      ipcRenderer.on('missioncontrol:update', listener)
      return () => ipcRenderer.removeListener('missioncontrol:update', listener)
    }
  }
```

(Ensure exactly one comma joins this to the preceding `prompts: {...}` entry — the leading `,` above assumes `prompts` has no trailing comma.)

- [ ] **Step 7: Verify the app boots with the new wiring**

Run:
```bash
npm run build
```
Expected: build succeeds, **and `out/main/` now contains `settings.js`, `attention.js`, `monitor.js`, `notify.js`, `missioncontrol.js`.** If any is missing, add it to `rollupOptions.input` in `electron.vite.config.mjs` (the build emits each main module as a sibling file; an un-listed `require('./x')` fails at runtime with "Cannot find module './x'").

- [ ] **Step 8: Add the new main modules to the build input** — edit `electron.vite.config.mjs`, extending the `input` map:

```js
          search: resolve('src/main/search.js'),
          prompts: resolve('src/main/prompts.js'),
          settings: resolve('src/main/settings.js'),
          attention: resolve('src/main/attention.js'),
          monitor: resolve('src/main/monitor.js'),
          notify: resolve('src/main/notify.js'),
          missioncontrol: resolve('src/main/missioncontrol.js')
```

- [ ] **Step 9: Boot smoke**

Run:
```bash
npm run build
$env:FLUX_SMOKE_SHOT="C:\tmp\flux-A-boot.png"; npx electron . ; Remove-Item Env:FLUX_SMOKE_SHOT
```
Expected: console prints `FLUX_SMOKE_SHOT_OK ...`; open `C:\tmp\flux-A-boot.png` and confirm the app rendered (no white error screen). The monitor tick is now running in the background.

- [ ] **Step 10: Commit**

```bash
git add src/main/index.js src/preload/index.js electron.vite.config.mjs
git commit -m "feat(watcher): wire settings/monitor/notify + IPC + build inputs (Milestone A)"
```

---

## Phase 7 — Renderer: notification settings + click-to-open  → **Milestone A shippable**

### Task 8: `SettingsPopover` + ⚙ in ControlBar

**Files:**
- Create: `src/renderer/src/components/SettingsPopover.jsx`
- Modify: `src/renderer/src/components/ControlBar.jsx`
- Modify: `src/renderer/src/index.css` (popover styles)

- [ ] **Step 1: Create `SettingsPopover.jsx`**

```jsx
// src/renderer/src/components/SettingsPopover.jsx
import { useEffect, useState } from 'react'

const ROWS = [
  { key: 'turnFinished', label: 'Turn finished (long)' },
  { key: 'turnError', label: 'Error / failed' },
  { key: 'blocked', label: 'Blocked / waiting' },
  { key: 'usageThreshold', label: 'Usage limit ≥ 90%' }
]
const MODES = ['toast', 'badge', 'off']

export default function SettingsPopover({ onClose }) {
  const [notify, setNotify] = useState(null)

  useEffect(() => {
    window.flux.settings.get().then((s) => s && setNotify(s.notify))
  }, [])

  const setMode = (key, value) => {
    window.flux.settings.setNotify(key, value).then((res) => {
      if (res.ok) setNotify(res.settings.notify)
    })
  }

  if (!notify) return null
  return (
    <div className="settings-pop" onMouseLeave={onClose}>
      <div className="settings-pop-title">Notifications</div>
      {ROWS.map((r) => (
        <div className="settings-row" key={r.key}>
          <span className="settings-row-label">{r.label}</span>
          <div className="settings-seg">
            {MODES.map((m) => (
              <button
                key={m}
                className={'seg' + (notify[r.key] === m ? ' on' : '')}
                onClick={() => setMode(r.key, m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      ))}
      <label className="settings-sound">
        <input
          type="checkbox"
          checked={notify.sound}
          onChange={(e) => setMode('sound', e.target.checked)}
        />
        Play a sound
      </label>
    </div>
  )
}
```

- [ ] **Step 2: Add the gear toggle to `ControlBar.jsx`** — replace the component body so it owns popover state. Change the imports and the returned JSX:

```jsx
import { useState, useEffect } from 'react'
import ModelPicker from './ModelPicker'
import SettingsPopover from './SettingsPopover'
```

Inside `ControlBar`, add state:

```js
  const [settingsOpen, setSettingsOpen] = useState(false)
```

And in the returned `<div className="control-bar">`, add before the closing `</div>`:

```jsx
      <div className="settings-anchor">
        <button
          className={'settings-gear' + (settingsOpen ? ' on' : '')}
          onClick={() => setSettingsOpen((o) => !o)}
          title="Notification settings"
        >
          ⚙
        </button>
        {settingsOpen && <SettingsPopover onClose={() => setSettingsOpen(false)} />}
      </div>
```

- [ ] **Step 3: Add popover CSS** to `src/renderer/src/index.css` (append at end):

```css
/* Notification settings popover */
.settings-anchor { position: relative; display: inline-flex; }
.settings-gear { background: none; border: 1px solid var(--border); color: var(--text-dim);
  border-radius: 6px; padding: 2px 8px; cursor: pointer; }
.settings-gear.on, .settings-gear:hover { color: var(--text); border-color: var(--accent); }
.settings-pop { position: absolute; top: 130%; right: 0; z-index: 50; width: 280px;
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: 10px;
  padding: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.45); }
.settings-pop-title { font-weight: 600; margin-bottom: 8px; color: var(--text); }
.settings-row { display: flex; align-items: center; justify-content: space-between; margin: 6px 0; }
.settings-row-label { color: var(--text-dim); font-size: 12px; }
.settings-seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.settings-seg .seg { background: none; border: none; color: var(--text-faint); font-size: 11px;
  padding: 3px 7px; cursor: pointer; }
.settings-seg .seg.on { background: var(--accent); color: var(--bg); }
.settings-sound { display: flex; align-items: center; gap: 6px; margin-top: 10px;
  color: var(--text-dim); font-size: 12px; }
```

- [ ] **Step 4: Manual smoke**

Run:
```bash
npm run build
$env:FLUX_SMOKE_SHOT="C:\tmp\flux-settings.png"; npx electron . ; Remove-Item Env:FLUX_SMOKE_SHOT
```
Then run the app normally (`npm run dev`), click the ⚙ in the topbar, flip "Turn finished" to `toast`, reopen the popover, and confirm it persisted (read-back from `settings.json`). **Look at the screenshot / window** — the gear must render in the control cluster.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SettingsPopover.jsx src/renderer/src/components/ControlBar.jsx src/renderer/src/index.css
git commit -m "feat(watcher): notification settings popover (Milestone A UI)"
```

### Task 9: click-to-open from a toast + report open session

**Files:**
- Modify: `src/renderer/src/App.jsx`

- [ ] **Step 1: Report the open session id to main** — add an effect in `App()` that fires whenever the open session changes. After the existing `live` effect (around `src/renderer/src/App.jsx:46`):

```js
  // Tell main which session is open (+ null when not in a session view) so it can
  // suppress notifications for the session you're actively looking at.
  useEffect(() => {
    const id = view === 'session' ? (detail?.sessionId || selected?.sessionId || null) : null
    window.flux.notify.setOpenSession(id)
  }, [view, detail, selected])
```

- [ ] **Step 2: Handle the toast click** — add another effect:

```js
  // A clicked notification asks us to open that session.
  useEffect(() => {
    return window.flux.notify.onOpenSession(({ sessionId }) => {
      const sess = sessions.find((s) => s.sessionId === sessionId)
      if (sess) openSession(sess)
    })
  }, [sessions, openSession])
```

- [ ] **Step 3: Manual smoke (real notification path)**

Run `npm run dev`. In a *separate* normal terminal, start a real long turn:
```
claude --session-id 11111111-1111-1111-1111-111111111111
```
then give it a task that runs > 30s. With Flux **unfocused** (or on another view), confirm a turn-finished badge/flash appears (per your settings), and that switching "Turn finished" to `toast` produces a toast whose click focuses Flux and opens that session.
Expected: notification fires once (coalesced), click navigates. If nothing fires, check `C:\tmp` logs / DevTools console and the monitor tick (it only treats files written within 60s as "active").

- [ ] **Step 4: Run the full suite + commit**

```bash
npm test
git add src/renderer/src/App.jsx
git commit -m "feat(watcher): open session from notification + suppress focused session (Milestone A complete)"
```

> **Milestone A is now shippable.** Consider merging here (see superpowers:finishing-a-development-branch) before starting B.

---

## Phase 8 — Mission Control composition (pure)

### Task 10 (run as Task 11 dependency): nothing — see Task 11.

### Task 11: `composeCards` + `cardsChanged`

**Files:**
- Create: `src/main/missioncontrol.js`
- Test: `tests/missioncontrol.test.js`

> **Order note:** implement this BEFORE Phase 4 Task 5's test run (the monitor `require`s it). It is pure and standalone.

- [ ] **Step 1: Write the failing test**

```js
// tests/missioncontrol.test.js
const test = require('node:test')
const assert = require('node:assert')
const { composeCards, cardsChanged, statusFor } = require('../src/main/missioncontrol')

function rec(over) {
  return Object.assign({
    sessionId: 's', file: 'f', project: 'p', cwd: 'c', title: 't', model: 'm',
    costUsd: 1, subagents: { running: 0, total: 0 }, lastSnippet: '', lastActivityMs: 1000,
    lastRole: 'assistant', hasError: false, blocked: false, turnOpen: false, origin: 'auto'
  }, over)
}

test('status precedence: error > blocked > running > finished > idle', () => {
  const now = 1000
  assert.strictEqual(statusFor(rec({ hasError: true, blocked: true, turnOpen: true }), now), 'error')
  assert.strictEqual(statusFor(rec({ blocked: true, turnOpen: true }), now), 'blocked')
  assert.strictEqual(statusFor(rec({ turnOpen: true }), now), 'running')
  assert.strictEqual(statusFor(rec({ lastRole: 'assistant', lastActivityMs: now - 1000 }), now), 'finished')
  assert.strictEqual(statusFor(rec({ lastRole: 'assistant', lastActivityMs: now - 99999999 }), now), 'idle')
})

test('composeCards groups + sorts needs-you first, then by recency', () => {
  const now = 10_000
  const cards = composeCards([
    rec({ sessionId: 'idle1', turnOpen: false, lastRole: 'assistant', lastActivityMs: now - 99999999 }),
    rec({ sessionId: 'err1', hasError: true, lastActivityMs: now - 5000 }),
    rec({ sessionId: 'run1', turnOpen: true, lastActivityMs: now - 1000 })
  ], now)
  assert.deepStrictEqual(cards.map((c) => c.sessionId), ['err1', 'run1', 'idle1'])
  assert.strictEqual(cards[0].group, 'needsYou')
  assert.strictEqual(cards[1].group, 'running')
  assert.strictEqual(cards[2].group, 'idle')
})

test('cardsChanged detects status/cost/snippet/subagent/count changes', () => {
  const a = composeCards([rec({ sessionId: 'x', costUsd: 1 })], 1000)
  const b = composeCards([rec({ sessionId: 'x', costUsd: 1 })], 1000)
  assert.strictEqual(cardsChanged(a, b), false)
  assert.strictEqual(cardsChanged(null, b), true)
  assert.strictEqual(cardsChanged(a, composeCards([rec({ sessionId: 'x', costUsd: 2 })], 1000)), true)
  assert.strictEqual(cardsChanged(a, composeCards([rec({ sessionId: 'x', turnOpen: true })], 1000)), true)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/missioncontrol.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `missioncontrol.js`**

```js
// src/main/missioncontrol.js
// PURE: turn monitor records into ordered Mission Control card DTOs. No fs/timers.

const STATUS_RANK = { error: 0, blocked: 1, running: 2, finished: 3, idle: 4 }
const GROUP_OF = { error: 'needsYou', blocked: 'needsYou', running: 'running', finished: 'idle', idle: 'idle' }
const FINISHED_MS = 5 * 60_000

function statusFor(rec, now) {
  if (rec.hasError) return 'error'
  if (rec.blocked) return 'blocked'
  if (rec.turnOpen) return 'running'
  if (rec.lastRole === 'assistant' && now - rec.lastActivityMs < FINISHED_MS) return 'finished'
  return 'idle'
}

function composeCards(records, now) {
  const cards = records.map((r) => {
    const status = statusFor(r, now)
    return {
      sessionId: r.sessionId,
      file: r.file,
      project: r.project,
      cwd: r.cwd,
      title: r.title,
      model: r.model,
      costUsd: r.costUsd,
      subagents: r.subagents || { running: 0, total: 0 },
      lastSnippet: r.lastSnippet || '',
      lastActivityMs: r.lastActivityMs,
      origin: r.origin || 'auto',
      status,
      group: GROUP_OF[status]
    }
  })
  cards.sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.lastActivityMs - a.lastActivityMs
  )
  return cards
}

function cardsChanged(prev, next) {
  if (!prev || prev.length !== next.length) return true
  for (let i = 0; i < next.length; i++) {
    const a = prev[i]
    const b = next[i]
    if (
      a.sessionId !== b.sessionId ||
      a.status !== b.status ||
      a.costUsd !== b.costUsd ||
      a.subagents.running !== b.subagents.running ||
      a.lastSnippet !== b.lastSnippet
    ) {
      return true
    }
  }
  return false
}

module.exports = { composeCards, cardsChanged, statusFor, STATUS_RANK, GROUP_OF, FINISHED_MS }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/missioncontrol.test.js`
Expected: PASS (3 tests). Now also run `node --test tests/monitor.test.js` (Phase 4) — it should pass with this module present.

- [ ] **Step 5: Commit**

```bash
git add src/main/missioncontrol.js tests/missioncontrol.test.js
git commit -m "feat(missioncontrol): pure composeCards + cardsChanged (TDD)"
```

---

## Phase 9 — Renderer: Mission Control view  → **Milestone B shippable**

### Task 12: `MissionCard` + `MissionControl` view

**Files:**
- Create: `src/renderer/src/components/MissionCard.jsx`
- Create: `src/renderer/src/components/MissionControl.jsx`
- Modify: `src/renderer/src/index.css` (grid + card + `--alert` token)

- [ ] **Step 1: Add the alert token + styles** to `src/renderer/src/index.css`. First add `--alert` to `:root` (find the `:root { ... }` block in index.css and add a line; if the variable is theme-driven, add it once in `:root` as a sensible default):

```css
:root { --alert: #f38ba8; } /* needs-you accent; appended default, themes may override */
```

Then append:

```css
/* Mission Control */
.mission { padding: 16px; overflow-y: auto; height: 100%; }
.mission-group-title { color: var(--text-dim); font-size: 12px; text-transform: uppercase;
  letter-spacing: .08em; margin: 14px 4px 8px; }
.mission-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.mcard { background: var(--bg-panel); border: 1px solid var(--border); border-radius: 10px;
  padding: 12px; cursor: pointer; transition: border-color .12s, transform .12s; }
.mcard:hover { transform: translateY(-1px); border-color: var(--accent); }
.mcard.needsYou { border-color: var(--alert); box-shadow: 0 0 0 1px var(--alert) inset; }
.mcard-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.mcard-title { font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
.mcard-chip { font-size: 10px; padding: 2px 7px; border-radius: 999px; flex: none; }
.mcard-chip.error, .mcard-chip.blocked { background: var(--alert); color: var(--bg); }
.mcard-chip.running { background: var(--accent); color: var(--bg); }
.mcard-chip.finished, .mcard-chip.idle { background: var(--bg-hover); color: var(--text-dim); }
.mcard-proj { color: var(--text-faint); font-size: 11px; margin: 2px 0 8px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.mcard-snippet { color: var(--text-dim); font-size: 12px; line-height: 1.35; height: 2.7em;
  overflow: hidden; }
.mcard-meta { display: flex; gap: 10px; margin-top: 8px; color: var(--text-faint); font-size: 11px; }
.mission-empty { color: var(--text-faint); padding: 40px 4px; text-align: center; }
```

- [ ] **Step 2: Create `MissionCard.jsx`**

```jsx
// src/renderer/src/components/MissionCard.jsx
const CHIP_LABEL = { error: 'error', blocked: 'needs you', running: 'running', finished: 'done', idle: 'idle' }

function rel(ms, now) {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.round(s / 60) + 'm ago'
  if (s < 86400) return Math.round(s / 3600) + 'h ago'
  return Math.round(s / 86400) + 'd ago'
}

export default function MissionCard({ card, now, onOpen }) {
  return (
    <div className={'mcard ' + card.group} onClick={() => onOpen(card)}>
      <div className="mcard-top">
        <span className="mcard-title" title={card.title}>{card.title}</span>
        <span className={'mcard-chip ' + card.status}>{CHIP_LABEL[card.status]}</span>
      </div>
      <div className="mcard-proj" title={card.cwd}>{card.cwd || card.project}</div>
      <div className="mcard-snippet">{card.lastSnippet || '—'}</div>
      <div className="mcard-meta">
        <span>${card.costUsd.toFixed(2)}</span>
        {card.model && <span>{card.model.replace(/^claude-/, '')}</span>}
        {card.subagents.running > 0 && <span>▶ {card.subagents.running}</span>}
        <span style={{ marginLeft: 'auto' }}>{rel(card.lastActivityMs, now)}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `MissionControl.jsx`**

```jsx
// src/renderer/src/components/MissionControl.jsx
import { useEffect, useState } from 'react'
import MissionCard from './MissionCard'

const GROUPS = [
  { key: 'needsYou', title: 'Needs you' },
  { key: 'running', title: 'Running' },
  { key: 'idle', title: 'Idle / recently finished' }
]

export default function MissionControl({ onOpenCard }) {
  const [cards, setCards] = useState([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    window.flux.missioncontrol.list().then((res) => {
      if (alive && res.ok) setCards(res.cards)
    })
    const off = window.flux.missioncontrol.onUpdate((next) => setCards(next))
    const tick = setInterval(() => setNow(Date.now()), 5000) // refresh "x ago" labels
    return () => {
      alive = false
      off()
      clearInterval(tick)
    }
  }, [])

  const byGroup = (g) => cards.filter((c) => c.group === g)

  return (
    <div className="mission">
      {cards.length === 0 && <div className="mission-empty">No active sessions in the last 24h.</div>}
      {GROUPS.map((g) => {
        const items = byGroup(g.key)
        if (!items.length) return null
        return (
          <div key={g.key}>
            <div className="mission-group-title">{g.title} · {items.length}</div>
            <div className="mission-grid">
              {items.map((c) => (
                <MissionCard key={c.sessionId} card={c} now={now} onOpen={onOpenCard} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/MissionCard.jsx src/renderer/src/components/MissionControl.jsx src/renderer/src/index.css
git commit -m "feat(missioncontrol): grid view + card components (Milestone B UI)"
```

### Task 13: wire the Mission tab + Ctrl+M + open-card navigation

**Files:**
- Modify: `src/renderer/src/App.jsx`

- [ ] **Step 1: Import the view** at the top of `App.jsx` (with the other component imports):

```js
import MissionControl from './components/MissionControl'
```

- [ ] **Step 2: Open a card** — add a callback in `App()` (after `openSession`, around `src/renderer/src/App.jsx:132`):

```js
  // A Mission Control card carries enough to open the session directly; if it's
  // already in our list use that object, else synthesize the minimum openSession needs.
  const openCard = useCallback(
    (card) => {
      const sess =
        sessions.find((s) => s.sessionId === card.sessionId) ||
        { sessionId: card.sessionId, file: card.file, title: card.title, cwd: card.cwd }
      openSession(sess)
    },
    [sessions, openSession]
  )
```

- [ ] **Step 3: Ctrl+M shortcut** — extend the existing keydown effect (the one handling Ctrl+Shift+F, around `src/renderer/src/App.jsx:53`). Replace its `onKey` body with:

```js
    const onKey = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        setSearchOpen((o) => !o)
      } else if (e.ctrlKey && !e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault()
        setView((v) => (v === 'mission' ? 'terminal' : 'mission'))
      }
    }
```

- [ ] **Step 4: Add the topbar tab** — in the `.topbar`, after the Skills tab button (around `src/renderer/src/App.jsx:253`):

```jsx
          <button
            className={'tab' + (view === 'mission' ? ' active' : '')}
            onClick={() => setView('mission')}
            title="Mission Control — all active sessions (Ctrl+M)"
          >
            🛰 Mission
          </button>
```

- [ ] **Step 5: Render the view** — after the `view === 'skills'` block (around `src/renderer/src/App.jsx:304`):

```jsx
        {view === 'mission' && (
          <div className="pane-slot">
            <MissionControl onOpenCard={openCard} />
          </div>
        )}
```

- [ ] **Step 6: Manual smoke**

Run:
```bash
npm run build
$env:FLUX_SMOKE_SHOT="C:\tmp\flux-mission.png"; $env:FLUX_SMOKE_VIEW="mission"; npx electron . ; Remove-Item Env:FLUX_SMOKE_SHOT; Remove-Item Env:FLUX_SMOKE_VIEW
```

> The smoke harness in `index.js` only knows `stats/session/skills`. Add a `mission` branch to it for this screenshot: in `src/main/index.js` inside the `did-finish-load` handler, add
> `else if (process.env.FLUX_SMOKE_VIEW === 'mission') { await wc.executeJavaScript("[...document.querySelectorAll('.tab')].find((b)=>/Mission/.test(b.textContent))?.click()") }`
> Then rebuild and re-run. **Open `C:\tmp\flux-mission.png` and confirm** the grid renders with grouped cards (or the empty state if nothing ran in 24h). Run the app and press **Ctrl+M** to toggle the view; click a card → it opens that session.

- [ ] **Step 7: Full suite + commit**

```bash
npm test
git add src/renderer/src/App.jsx src/main/index.js
git commit -m "feat(missioncontrol): Mission tab + Ctrl+M + card navigation (Milestone B complete)"
```

---

## Phase 10 — Verification & docs

### Task 14: end-to-end verification + spec status

- [ ] **Step 1: Full test suite green**

Run: `npm test`
Expected: all suites pass (settings, parser-errors, attention, monitor, notify, missioncontrol, plus pre-existing).

- [ ] **Step 2: Real-world attention check (best-effort error tuning)**

Trigger a real long turn, a real "blocked waiting on permission" prompt, and (if reproducible) an errored turn in a tracked session. Confirm each fires the configured signal once. If `turn:error` does NOT fire on a real error, open that session's `.jsonl`, inspect the error record shape, and update `isErrorRecord()` in `parser.js` to match (then re-run `tests/parser-errors.test.js`, adding the real shape as a case).

- [ ] **Step 3: Update spec statuses + README**

In `docs/superpowers/specs/2026-06-10-watcher-notifications-design.md` and `...mission-control-design.md`, change Status to `implemented (<date>)` with a one-line note pointing at this plan and the deviations section. Add two README roadmap checkboxes:

```md
- [x] **Watcher + notifications (Milestone A):** auto-detect any active claude session and
      signal turn-finished / error / blocked / usage-limit via OS toast/badge (configurable ⚙).
- [x] **Mission Control (Milestone B):** all-sessions grid (Ctrl+M) — needs-you / running / idle.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-10-watcher-notifications-design.md docs/superpowers/specs/2026-06-10-mission-control-design.md README.md
git commit -m "docs: mark Milestones A + B implemented; README roadmap"
```

---

## Self-review notes (author)

- **Spec A coverage:** auto-attach (monitor scans all projects, no button needed) ✓; turn-finished/error/blocked/usage events (attention.js) ✓; toast/badge/sound + per-event settings (notify.js + settings.js + SettingsPopover) ✓; suppression + coalescing ✓; click-to-open ✓. Auto-attach "auto origin" surfaces in Mission Control rather than the single live panel (documented deviation #2).
- **Spec B coverage:** all-sessions grid grouped needs-you/running/idle ✓; card contents (project, title, status chip, cost, model, subagent count, snippet, relative time) ✓; Ctrl+M + topbar entry ✓; click-through ✓; alert accent for needs-you ✓; `missioncontrol:list` + debounced `missioncontrol:update` ✓ (debounce = tick cadence + cardsChanged, documented deviation #3); pure `composeCards`/`cardsChanged`/`statusFor` unit-tested ✓.
- **Placeholders:** none — every code step contains full code.
- **Type/name consistency:** `observe(state, obs)` obs fields (`ts/mtimeMs/userCount/assistantCount/errorCount`) are produced identically by the monitor; card DTO fields used by `MissionCard.jsx` (`title/status/group/cwd/project/lastSnippet/costUsd/model/subagents.running/lastActivityMs`) match `composeCards` output; IPC channel names match across `index.js` ↔ `preload` ↔ renderer (`settings:get`, `settings:setNotify`, `notify:setOpenSession`, `notify:open-session`, `missioncontrol:list`, `missioncontrol:update`).
- **Known cost caveat:** `monitor.estimateCostUsd` uses a coarse flat rate (main-process, no renderer pricing import) — the card shows "~$"; exact cost stays in the live panel. Acceptable for a glance view.
