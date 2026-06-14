# Visual Reactivity + Ambient Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Scenes react to live tokens/sec + errors with a global `--pulse`; a live cost odometer; WebAudio event cues.

**Architecture:** Pure `lib/reactivity.js` (smoothing + speed scaling); scene engine gains `setReactivity`; `ThemeBackground` feeds it from live snapshots; `Odometer` + `lib/audio.js` add ambient flourishes.

**Tech Stack:** Canvas-2D, WebAudio, React, node:test.

**Spec:** `docs/superpowers/specs/2026-06-14-visual-reactivity-design.md`

**Test command:** `npm test`. Build: `npm run build`. `src/renderer/src/lib/` is ESM (tests use dynamic import()); `settings.js` is CommonJS. Engine/scenes/audio/JSX are build-verified; pure helpers + settings are unit-tested.

---

## Task 1: reactivity helpers + scene-engine + scene responses

**Files:**
- Create: `src/renderer/src/lib/reactivity.js`, `tests/reactivity.test.js`
- Modify: `src/renderer/src/lib/scene-engine.js`, `src/renderer/src/lib/scenes/{aurora,nebula,synthwave,matrix}.js`

- [ ] **Step 1: Write the failing test**

Create `tests/reactivity.test.js`:

```js
const { test, describe, before } = require('node:test')
const assert = require('node:assert')

describe('reactivity', () => {
  let tokensPerSecFrom, reactiveSpeed
  before(async () => {
    ;({ tokensPerSecFrom, reactiveSpeed } = await import('../src/renderer/src/lib/reactivity.js'))
  })
  test('tokensPerSecFrom computes rate, guards zero/negative', () => {
    assert.strictEqual(tokensPerSecFrom(0, 1000, 100, 2000), 100) // 100 tokens / 1s
    assert.strictEqual(tokensPerSecFrom(0, 0, 100, 2000), 0) // no prevTs
    assert.strictEqual(tokensPerSecFrom(200, 1000, 100, 2000), 0) // token count went down -> 0
    assert.strictEqual(tokensPerSecFrom(0, 2000, 100, 2000), 0) // dt<=0
  })
  test('reactiveSpeed scales base up to ~3x, never below base', () => {
    assert.strictEqual(reactiveSpeed(10, 0), 10)
    assert.ok(reactiveSpeed(10, 1000) <= 30 && reactiveSpeed(10, 1000) >= 25)
    assert.ok(reactiveSpeed(10, 25) > 10)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/reactivity.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement reactivity.js**

Create `src/renderer/src/lib/reactivity.js`:

```js
// Pure helpers for activity-reactive visuals.
function tokensPerSecFrom(prevTokens, prevTs, tokens, ts) {
  if (!prevTs || !ts || ts <= prevTs) return 0
  const dt = (ts - prevTs) / 1000
  const dTok = Math.max(0, (tokens || 0) - (prevTokens || 0))
  return dt > 0 ? dTok / dt : 0
}

function reactiveSpeed(base, tokensPerSec) {
  const t = Math.max(0, tokensPerSec || 0)
  return base * (1 + Math.min(2, t / 50)) // up to 3x at ~100+ tok/s
}

export { tokensPerSecFrom, reactiveSpeed }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/reactivity.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: scene-engine — reactivity**

Read `src/renderer/src/lib/scene-engine.js`. Add a reactivity field + setter and pass it to draw:
- Near the other state: `let reactivity = { tokensPerSec: 0, flare: 0 }`.
- Add inside the returned API: `setReactivity(next) { reactivity = { ...reactivity, ...(next || {}) } }`.
- In the `frame(t)` loop, change `scene.draw(t, dim)` → `scene.draw(t, dim, reactivity)`.

- [ ] **Step 6: Scenes react**

Edit each `src/renderer/src/lib/scenes/*.js` `draw` to accept `(t, dim, reactivity = {})`:
- `matrix.js`: import `reactiveSpeed` from `../reactivity`; advance drops by `reactiveSpeed(1, reactivity.tokensPerSec)` instead of `drops[i]++` (i.e. `drops[i] += reactiveSpeed(1, reactivity.tokensPerSec)`), and shorten the ~42ms throttle proportionally is optional — keep throttle, just speed the drop step.
- `aurora.js` + `synthwave.js`: when `reactivity.flare > 0`, boost brightness — e.g. add `reactivity.flare` to band alpha / draw a brief radial flare near the sun. Keep subtle.
- `nebula.js`: raise shooting-star frequency with activity — reduce `nextShoot` interval when `reactivity.tokensPerSec > 0`.
Keep all reads defensive (`(reactivity || {}).tokensPerSec || 0`).

- [ ] **Step 7: Build + commit**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3 && node --test tests/reactivity.test.js`
Expected: build succeeds; tests pass.

```bash
git add src/renderer/src/lib/reactivity.js tests/reactivity.test.js src/renderer/src/lib/scene-engine.js src/renderer/src/lib/scenes
git commit -m "feat(visual): scene reactivity (tokens/sec speed, error flare) + helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: ThemeBackground feeds live → reactivity + --pulse

**Files:**
- Modify: `src/renderer/src/components/ThemeBackground.jsx`, `src/renderer/src/App.jsx`

- [ ] **Step 1: App passes live to ThemeBackground**

In `src/renderer/src/App.jsx`, where `<ThemeBackground theme={theme} animated={animated} />` is rendered, add `live={live}` (the existing `live` state from `window.flux.live.onUpdate`).

- [ ] **Step 2: ThemeBackground reactivity effect**

In `src/renderer/src/components/ThemeBackground.jsx`:
- Import `{ tokensPerSecFrom } from '../lib/reactivity'`.
- Accept `live` in props: `export default function ThemeBackground({ theme, animated, live })`.
- Add refs: `const prevRef = useRef({ tokens: 0, ts: 0 })` and `const flareRef = useRef(0)`.
- Add an effect keyed on `[live]`:

```jsx
  useEffect(() => {
    const e = engineRef.current
    if (!e) return
    const u = live && live.usage
    const tokens = u ? (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheCreation || 0) : 0
    const ts = Date.now()
    const prev = prevRef.current
    const tps = tokensPerSecFrom(prev.tokens, prev.ts, tokens, ts)
    prevRef.current = { tokens, ts }
    if (live && (live.state === 'error' || live.hasError)) flareRef.current = 1
    else flareRef.current = Math.max(0, flareRef.current - 0.15)
    e.setReactivity({ tokensPerSec: tps, flare: flareRef.current })
    const pulse = Math.min(1, tps / 80)
    document.documentElement.style.setProperty('--pulse', String(pulse.toFixed(3)))
  }, [live])
```

(`Date.now()` is fine in the renderer.) Leave the existing create/setScene effects unchanged.

- [ ] **Step 3: Build + commit**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3`
Expected: build succeeds.

```bash
git add src/renderer/src/components/ThemeBackground.jsx src/renderer/src/App.jsx
git commit -m "feat(visual): feed live tokens/sec + error flare into scenes + --pulse var

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Live cost odometer

**Files:**
- Create: `src/renderer/src/components/Odometer.jsx`
- Modify: `src/renderer/src/components/LivePanel.jsx`

- [ ] **Step 1: Create Odometer.jsx**

```jsx
import { useEffect, useRef, useState } from 'react'
import { formatUSD } from '../lib/pricing'

// Tweens a numeric value to its new target over ~400ms (rolling cost).
export default function Odometer({ value }) {
  const [display, setDisplay] = useState(value || 0)
  const fromRef = useRef(value || 0)
  const rafRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    const to = value || 0
    if (from === to) return
    const start = performance.now()
    const dur = 400
    cancelAnimationFrame(rafRef.current)
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur)
      setDisplay(from + (to - from) * p)
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value])
  return <span className="odometer">{formatUSD(display)}</span>
}
```

- [ ] **Step 2: Use it in LivePanel**

Read `src/renderer/src/components/LivePanel.jsx`. Where it renders the live cost via `formatUSD(...)` (the static cost), replace that with `<Odometer value={cost} />` (import Odometer; `cost` is the same numeric value currently passed to `formatUSD`).

- [ ] **Step 3: Build + commit**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3`
Expected: build succeeds.

```bash
git add src/renderer/src/components/Odometer.jsx src/renderer/src/components/LivePanel.jsx
git commit -m "feat(visual): animated live cost odometer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: WebAudio cues + settings toggle

**Files:**
- Create: `src/renderer/src/lib/audio.js`, `tests/settings-audio.test.js`
- Modify: `src/main/settings.js`, `src/renderer/src/App.jsx`, `src/renderer/src/components/settings/AppearanceSection.jsx`

- [ ] **Step 1: Write the failing settings test**

Create `tests/settings-audio.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const os = require('os'); const path = require('path')
const { SettingsStore } = require('../src/main/settings')
function tmp() { return path.join(os.tmpdir(), 'flux-aud-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json') }

test('audio.enabled defaults false and round-trips', () => {
  const f = tmp()
  assert.strictEqual(new SettingsStore(f).get().audio.enabled, false)
  const s = new SettingsStore(f); s.setByPath('audio.enabled', true)
  assert.strictEqual(new SettingsStore(f).get().audio.enabled, true)
})
test('invalid audio.enabled throws', () => {
  assert.throws(() => new SettingsStore(tmp()).setByPath('audio.enabled', 'yes'))
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/settings-audio.test.js`
Expected: FAIL.

- [ ] **Step 3: settings.js — audio**

In `src/main/settings.js`: add `audio: { enabled: false },` to `DEFAULTS`; in `_load` add `if (parsed.audio && typeof parsed.audio === 'object' && typeof parsed.audio.enabled === 'boolean') this.data.audio.enabled = parsed.audio.enabled`; add `setAudio(key, value) { if (key === 'enabled') { if (typeof value !== 'boolean') throw new Error('audio.enabled must be boolean'); this.data.audio.enabled = value } else throw new Error('unknown audio key: ' + key); this._save(); return this.get() }`; route in `setByPath`: `if (section === 'audio') return this.setAudio(key, value)`.

- [ ] **Step 4: audio.js**

Create `src/renderer/src/lib/audio.js`:

```js
// Tiny WebAudio event cues. AudioContext created lazily (first call after a
// user gesture). No-op where unsupported.
let ctx = null
function ac() {
  if (ctx) return ctx
  try { ctx = new (window.AudioContext || window.webkitAudioContext)() } catch { ctx = null }
  return ctx
}
const CUES = { 'turn:finished': [660, 0.12], 'turn:error': [220, 0.22], blocked: [440, 0.16] }
function playCue(type) {
  const a = ac()
  const spec = CUES[type]
  if (!a || !spec) return
  try {
    const [freq, dur] = spec
    const o = a.createOscillator()
    const g = a.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, a.currentTime)
    g.gain.exponentialRampToValueAtTime(0.15, a.currentTime + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur)
    o.connect(g)
    g.connect(a.destination)
    o.start()
    o.stop(a.currentTime + dur)
  } catch {
    /* ignore */
  }
}
export { playCue }
```

- [ ] **Step 5: App triggers cues**

In `src/renderer/src/App.jsx`: import `{ playCue } from './lib/audio'`. Add an effect:

```jsx
  useEffect(() => {
    return window.flux.notify.onHistoryAdd((entry) => {
      if (settings.audio && settings.audio.enabled) playCue(entry.type)
    })
  }, [settings.audio])
```

- [ ] **Step 6: AppearanceSection toggle**

In `src/renderer/src/components/settings/AppearanceSection.jsx`, add a row:

```jsx
      <div className="set-row">
        <div className="set-row-l"><span className="set-row-name">Sound cues (in-app)</span><span className="set-row-desc">A soft WebAudio blip on turn-finished / error / blocked.</span></div>
        <input type="checkbox" checked={!!(settings.audio && settings.audio.enabled)} onChange={(e) => update('audio.enabled', e.target.checked)} />
      </div>
```

- [ ] **Step 7: Build + full suite + commit**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3 && npm test 2>&1 | tail -5`
Expected: build succeeds; all tests pass (320 prior + 2 reactivity + 2 settings-audio = 324).

```bash
git add src/renderer/src/lib/audio.js tests/settings-audio.test.js src/main/settings.js src/renderer/src/App.jsx src/renderer/src/components/settings/AppearanceSection.jsx
git commit -m "feat(visual): WebAudio event cues + audio.enabled setting

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** reactivity helpers + engine + scenes → Task 1; live feed + --pulse → Task 2; cost odometer → Task 3; WebAudio cues + setting → Task 4. Always-on-top HUD + screensaver deferred (flagged in spec).

**Placeholder scan:** helpers + engine setter + audio + odometer + settings have full code; scene/ThemeBackground/App/LivePanel/AppearanceSection edits give exact behavior + read points.

**Type/name consistency:** `tokensPerSecFrom`/`reactiveSpeed` tested + used (engine feed/scenes); `setReactivity` added to engine + called by ThemeBackground; `playCue(type)` matches the `notify:history-add` entry `type`; `audio.enabled` validated in settings + read in App/AppearanceSection; `Odometer value=` matches LivePanel's cost.

**Notes for executor:** Tasks 1→2 sequential (2 feeds the engine from Task 1); 3 + 4 independent. Commit after each. Pure helpers + settings unit-tested; scenes/engine/audio/JSX build-verified. Keep scene reactivity reads defensive so static/idle still renders. No push/tag.
```
