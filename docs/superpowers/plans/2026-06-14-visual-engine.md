# Visual Engine + Live Re-theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** A Canvas-2D scene engine that makes the animated themes visible behind a semi-transparent terminal, with a live intensity control. (Phase 1+2 of the visuals arc; reactivity is #11.)

**Architecture:** `lib/scene-engine.js` (one rAF loop, DPR, ResizeObserver, visibility-pause, scene registry) + `lib/scenes/{aurora,nebula,synthwave,matrix}.js`; `ThemeBackground.jsx` becomes a single canvas; `TerminalPane` goes semi-transparent via `intensityToAlpha`; settings gain `appearance.intensity`.

**Tech Stack:** Canvas-2D (no deps), React, node:test.

**Spec:** `docs/superpowers/specs/2026-06-11-visual-engine-design.md` (approved with live demos).

**Test command:** `npm test`. Build: `npm run build`. New `lib/*.js` modules are ESM (`export {}`); tests use dynamic `import()`. Engine/scenes are DOM/rAF code → build- + visual-smoke-verified; pure helpers (`intensityToAlpha`, `terminalBg`, settings) are unit-tested. Animated theme keys: `aurora` `nebula` `synthwave` `matrix`; their `--bg`: `#06110f` / `#070612` / `#1a1025` / `#050a05`.

---

## Task 1: Scene engine

**Files:**
- Create: `src/renderer/src/lib/scene-engine.js`

- [ ] **Step 1: Create scene-engine.js**

```js
// One Canvas-2D animation loop shared by all scenes. DPR-aware, paused when the
// document is hidden, and resilient to resize. Scenes are factories registered
// by theme key. No dependencies.

function createEngine(canvas, registry) {
  const ctx = canvas.getContext('2d')
  let scene = null
  let raf = 0
  let running = false
  let dim = { w: 0, h: 0 }

  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    dim = { w, h }
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (scene && scene.resize) scene.resize(dim)
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => size()) : null
  if (ro) ro.observe(canvas)
  else window.addEventListener('resize', size)

  const onVis = () => {
    if (document.hidden) pause()
    else if (scene) start()
  }
  document.addEventListener('visibilitychange', onVis)

  function frame(t) {
    if (!running) return
    raf = requestAnimationFrame(frame)
    if (scene && scene.draw) scene.draw(t, dim)
  }
  function start() {
    if (running || !scene) return
    running = true
    size()
    raf = requestAnimationFrame(frame)
  }
  function pause() {
    running = false
    cancelAnimationFrame(raf)
  }
  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }
  function setScene(key) {
    const factory = registry && registry[key]
    pause()
    clear()
    scene = factory ? factory(ctx) : null
    if (scene) {
      size()
      start()
    }
  }
  function stop() {
    pause()
    clear()
  }
  function destroy() {
    pause()
    if (ro) ro.disconnect()
    else window.removeEventListener('resize', size)
    document.removeEventListener('visibilitychange', onVis)
    scene = null
  }

  return { setScene, start, stop, destroy }
}

export { createEngine }
```

- [ ] **Step 2: Verify it imports (build gate later; quick syntax check now)**

Run (PowerShell): `cd "C:/Users/james/Projects/Flux Terminal"; node --input-type=module -e "import('./src/renderer/src/lib/scene-engine.js').then(m=>console.log(typeof m.createEngine===''+'function'?'ok':'bad'))"`
Expected: prints `ok` (module parses + exports createEngine). (It won't run the engine — no DOM — just confirms the ESM loads.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/scene-engine.js
git commit -m "feat(visual): Canvas-2D scene engine (rAF loop, DPR, visibility-pause)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: The four scenes

**Files:**
- Create: `src/renderer/src/lib/scenes/aurora.js`, `nebula.js`, `synthwave.js`, `matrix.js`
- Test: `tests/scenes.test.js`

Each scene exports `create(ctx) => { draw(t, dim), resize(dim) }`. Keep particle counts scaled to area; use additive (`'lighter'`) compositing for glow.

- [ ] **Step 1: matrix.js**

```js
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺ0123456789ABCDEF'
const FONT = 14

function create(ctx) {
  let cols = 0
  let drops = []
  let last = 0
  function resize(dim) {
    cols = Math.max(1, Math.floor(dim.w / FONT))
    drops = Array.from({ length: cols }, () => Math.random() * (dim.h / FONT))
  }
  function draw(t, dim) {
    if (t - last < 42) return // ~24fps
    last = t
    ctx.fillStyle = 'rgba(5, 10, 5, 0.18)'
    ctx.fillRect(0, 0, dim.w, dim.h)
    ctx.fillStyle = '#39ff14'
    ctx.font = FONT + 'px monospace'
    for (let i = 0; i < cols; i++) {
      ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], i * FONT, drops[i] * FONT)
      if (drops[i] * FONT > dim.h && Math.random() > 0.975) drops[i] = 0
      drops[i]++
    }
  }
  return { draw, resize }
}

export { create }
```

- [ ] **Step 2: aurora.js**

```js
// Undulating aurora ribbons (additive) + rising motes.
function makeMotes(n, dim) {
  return Array.from({ length: n }, () => ({ x: Math.random() * dim.w, y: Math.random() * dim.h, r: 1 + Math.random() * 2, s: 0.2 + Math.random() * 0.6 }))
}

function create(ctx) {
  let dim = { w: 0, h: 0 }
  let motes = []
  const bands = [
    { color: '94,234,212', y: 0.35, amp: 0.10, speed: 0.00018, k: 1.3 },
    { color: '167,139,250', y: 0.5, amp: 0.13, speed: 0.00012, k: 0.9 },
    { color: '56,189,170', y: 0.62, amp: 0.08, speed: 0.00022, k: 1.7 }
  ]
  function resize(d) { dim = d; motes = makeMotes(Math.max(20, Math.floor(d.w * d.h / 26000)), d) }
  function draw(t, d) {
    dim = d
    ctx.clearRect(0, 0, d.w, d.h)
    ctx.globalCompositeOperation = 'lighter'
    for (const b of bands) {
      ctx.beginPath()
      for (let x = 0; x <= d.w; x += 12) {
        const y = d.h * b.y + Math.sin(x * 0.008 * b.k + t * b.speed) * d.h * b.amp + Math.sin(x * 0.02 + t * b.speed * 2) * 14
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.lineTo(d.w, d.h); ctx.lineTo(0, d.h); ctx.closePath()
      const g = ctx.createLinearGradient(0, d.h * (b.y - b.amp), 0, d.h)
      g.addColorStop(0, `rgba(${b.color},0.22)`); g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g; ctx.fill()
    }
    for (const m of motes) {
      m.y -= m.s; if (m.y < -4) { m.y = d.h + 4; m.x = Math.random() * d.w }
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 7); ctx.fillStyle = 'rgba(180,255,235,0.5)'; ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  }
  return { draw, resize }
}

export { create, makeMotes }
```

- [ ] **Step 3: nebula.js**

```js
// Parallax starfield + drifting nebula blobs + occasional shooting star.
function makeStars(n, dim) {
  return Array.from({ length: n }, () => ({ x: Math.random() * dim.w, y: Math.random() * dim.h, z: 0.3 + Math.random() * 0.7, p: Math.random() * 6.28 }))
}

function create(ctx) {
  let stars = []
  let shoot = null
  let nextShoot = 2000
  function resize(d) { stars = makeStars(Math.max(40, Math.floor(d.w * d.h / 9000)), d) }
  function draw(t, d) {
    ctx.fillStyle = 'rgba(7,6,18,0.4)'; ctx.fillRect(0, 0, d.w, d.h)
    ctx.globalCompositeOperation = 'lighter'
    // nebula blobs
    for (let i = 0; i < 3; i++) {
      const cx = d.w * (0.3 + 0.2 * i) + Math.sin(t * 0.00005 + i) * 60
      const cy = d.h * (0.4 + 0.15 * i) + Math.cos(t * 0.00004 + i) * 40
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, d.w * 0.25)
      g.addColorStop(0, i % 2 ? 'rgba(139,156,255,0.06)' : 'rgba(214,139,255,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g; ctx.fillRect(0, 0, d.w, d.h)
    }
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * 0.003 * s.z + s.p)
      ctx.globalAlpha = tw * s.z
      ctx.fillStyle = '#e6e3ff'; ctx.fillRect(s.x, s.y, s.z * 1.6, s.z * 1.6)
    }
    ctx.globalAlpha = 1
    if (t > nextShoot && !shoot) { shoot = { x: Math.random() * d.w, y: Math.random() * d.h * 0.5, life: 0 }; nextShoot = t + 3000 + Math.random() * 4000 }
    if (shoot) {
      shoot.life += 16; const len = 120
      const x2 = shoot.x + shoot.life * 0.6, y2 = shoot.y + shoot.life * 0.3
      const g = ctx.createLinearGradient(x2 - len, y2 - len * 0.5, x2, y2)
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.9)')
      ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x2 - len, y2 - len * 0.5); ctx.lineTo(x2, y2); ctx.stroke()
      if (shoot.life > 400) shoot = null
    }
    ctx.globalCompositeOperation = 'source-over'
  }
  return { draw, resize }
}

export { create, makeStars }
```

- [ ] **Step 4: synthwave.js**

```js
// Retro sun (scanline cutouts) on a glowing horizon + perspective grid + stars.
function makeStars(n, dim) {
  return Array.from({ length: n }, () => ({ x: Math.random() * dim.w, y: Math.random() * dim.h * 0.55 }))
}

function create(ctx) {
  let stars = []
  function resize(d) { stars = makeStars(Math.max(30, Math.floor(d.w / 12)), d) }
  function draw(t, d) {
    const horizon = d.h * 0.6
    // sky gradient
    let g = ctx.createLinearGradient(0, 0, 0, horizon)
    g.addColorStop(0, '#1a1025'); g.addColorStop(1, '#3a1d4d')
    ctx.fillStyle = g; ctx.fillRect(0, 0, d.w, horizon)
    // stars
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    for (const s of stars) ctx.fillRect(s.x, s.y, 1.5, 1.5)
    // sun
    const cx = d.w / 2, cy = horizon - 60, r = Math.min(120, d.w * 0.12)
    const sg = ctx.createLinearGradient(cx, cy - r, cx, cy + r)
    sg.addColorStop(0, '#ff8a3d'); sg.addColorStop(1, '#ff2fb0')
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.clip()
    ctx.fillStyle = sg; ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    ctx.fillStyle = '#1a1025'
    for (let i = 0; i < 8; i++) { const yy = cy + i * 9 - 4; if (yy > cy - r) ctx.fillRect(cx - r, yy, r * 2, 3 + i) }
    ctx.restore()
    // ground
    ctx.fillStyle = '#160a22'; ctx.fillRect(0, horizon, d.w, d.h - horizon)
    // perspective grid
    ctx.strokeStyle = 'rgba(54,224,255,0.5)'; ctx.lineWidth = 1
    const vp = cx
    for (let i = -10; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(vp + i * 40, horizon); ctx.lineTo(vp + i * 400, d.h); ctx.stroke() }
    const scroll = (t * 0.06) % 40
    for (let y = 0; y < d.h - horizon; y += 4) {
      const yy = horizon + ((y + scroll) * (y + scroll)) / (d.h - horizon)
      if (yy > d.h) break
      ctx.globalAlpha = 0.2 + 0.5 * (yy - horizon) / (d.h - horizon)
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(d.w, yy); ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
  return { draw, resize }
}

export { create, makeStars }
```

- [ ] **Step 5: Pure-helper test**

Create `tests/scenes.test.js`:

```js
const { test, describe, before } = require('node:test')
const assert = require('node:assert')

describe('scene helpers', () => {
  let aurora, nebula
  before(async () => {
    aurora = await import('../src/renderer/src/lib/scenes/aurora.js')
    nebula = await import('../src/renderer/src/lib/scenes/nebula.js')
  })
  test('makeMotes / makeStars produce the requested count within bounds', () => {
    const motes = aurora.makeMotes(10, { w: 100, h: 100 })
    assert.strictEqual(motes.length, 10)
    assert.ok(motes.every((m) => m.x >= 0 && m.x <= 100 && m.y >= 0 && m.y <= 100))
    const stars = nebula.makeStars(15, { w: 200, h: 200 })
    assert.strictEqual(stars.length, 15)
    assert.ok(stars.every((s) => s.z >= 0.3 && s.z <= 1))
  })
})
```

- [ ] **Step 6: Run test + commit**

Run: `node --test tests/scenes.test.js`
Expected: PASS (1 test).

```bash
git add src/renderer/src/lib/scenes tests/scenes.test.js
git commit -m "feat(visual): aurora/nebula/synthwave/matrix Canvas-2D scenes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: intensity helper + terminal bg + settings

**Files:**
- Modify: `src/renderer/src/lib/appearance.js`, `src/renderer/src/lib/themes.js`, `src/main/settings.js`
- Test: `tests/intensity.test.js`, extend `tests/settings-onboarding.test.js` is NOT needed — use a new `tests/settings-intensity.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/intensity.test.js`:

```js
const { test, describe, before } = require('node:test')
const assert = require('node:assert')

describe('intensity + terminalBg', () => {
  let intensityToAlpha, terminalBg
  before(async () => {
    ;({ intensityToAlpha } = await import('../src/renderer/src/lib/appearance.js'))
    ;({ terminalBg } = await import('../src/renderer/src/lib/themes.js'))
  })
  test('intensityToAlpha maps levels + default', () => {
    assert.strictEqual(intensityToAlpha('subtle'), 0.9)
    assert.strictEqual(intensityToAlpha('balanced'), 0.76)
    assert.strictEqual(intensityToAlpha('bold'), 0.62)
    assert.strictEqual(intensityToAlpha('???'), 0.76)
  })
  test('terminalBg returns rgba of the theme --bg at the given alpha', () => {
    assert.strictEqual(terminalBg('matrix', 1), 'rgba(5, 10, 5, 1)') // #050a05
    assert.strictEqual(terminalBg('aurora', 0.5), 'rgba(6, 17, 15, 0.5)') // #06110f
  })
})
```

Create `tests/settings-intensity.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const os = require('os'); const path = require('path')
const { SettingsStore } = require('../src/main/settings')
function tmp() { return path.join(os.tmpdir(), 'flux-int-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json') }

test('appearance.intensity defaults to balanced and round-trips', () => {
  const f = tmp()
  const s = new SettingsStore(f)
  assert.strictEqual(s.get().appearance.intensity, 'balanced')
  s.setByPath('appearance.intensity', 'bold')
  assert.strictEqual(new SettingsStore(f).get().appearance.intensity, 'bold')
})
test('invalid intensity throws', () => {
  assert.throws(() => new SettingsStore(tmp()).setByPath('appearance.intensity', 'loud'))
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/intensity.test.js tests/settings-intensity.test.js`
Expected: FAIL.

- [ ] **Step 3: appearance.js — intensityToAlpha**

In `src/renderer/src/lib/appearance.js`, add and export:

```js
export function intensityToAlpha(intensity) {
  if (intensity === 'subtle') return 0.9
  if (intensity === 'bold') return 0.62
  return 0.76 // balanced / unknown
}
```

- [ ] **Step 4: themes.js — terminalBg + hexToRgba**

In `src/renderer/src/lib/themes.js`, add and export:

```js
export function hexToRgba(hex, alpha) {
  const h = String(hex || '').replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function terminalBg(key, alpha) {
  const t = THEMES[key] || THEMES.midnight
  return hexToRgba(t.vars['--bg'], alpha)
}
```

- [ ] **Step 5: settings.js — appearance.intensity**

In `src/main/settings.js`:
- In `DEFAULTS.appearance`, add `intensity: 'balanced'`.
- Add a constant near `ANIM_MODES`: `const INTENSITY = ['subtle', 'balanced', 'bold']`.
- In `_load`'s appearance merge, add: `if (INTENSITY.includes(a.intensity)) this.data.appearance.intensity = a.intensity`.
- In `setAppearance`, add a branch: `else if (key === 'intensity') { if (!INTENSITY.includes(value)) throw new Error('invalid intensity: ' + value); this.data.appearance.intensity = value }`.

- [ ] **Step 6: Run tests + commit**

Run: `node --test tests/intensity.test.js tests/settings-intensity.test.js tests/settings.test.js tests/appearance.test.js tests/themes.test.js`
Expected: PASS (new + existing).

```bash
git add src/renderer/src/lib/appearance.js src/renderer/src/lib/themes.js src/main/settings.js tests/intensity.test.js tests/settings-intensity.test.js
git commit -m "feat(visual): intensity->alpha, terminalBg, appearance.intensity setting

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire it — ThemeBackground, TerminalPane transparency, intensity control, CSS

**Files:**
- Modify: `src/renderer/src/components/ThemeBackground.jsx`, `src/renderer/src/components/TerminalPane.jsx`, `src/renderer/src/components/settings/AppearanceSection.jsx`, `src/renderer/src/index.css`

- [ ] **Step 1: Rewrite ThemeBackground.jsx to a single canvas**

Replace `src/renderer/src/components/ThemeBackground.jsx` with:

```jsx
import { useEffect, useRef } from 'react'
import { isAnimated } from '../lib/themes'
import { createEngine } from '../lib/scene-engine'
import { create as aurora } from '../lib/scenes/aurora'
import { create as nebula } from '../lib/scenes/nebula'
import { create as synthwave } from '../lib/scenes/synthwave'
import { create as matrix } from '../lib/scenes/matrix'

const REGISTRY = { aurora, nebula, synthwave, matrix }

export default function ThemeBackground({ theme, animated }) {
  const canvasRef = useRef(null)
  const engineRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current) return
    engineRef.current = createEngine(canvasRef.current, REGISTRY)
    return () => { engineRef.current && engineRef.current.destroy(); engineRef.current = null }
  }, [])

  useEffect(() => {
    const e = engineRef.current
    if (!e) return
    if (animated && isAnimated(theme)) e.setScene(theme)
    else e.stop()
  }, [theme, animated])

  return <canvas ref={canvasRef} className="theme-bg-canvas" aria-hidden="true" />
}
```

- [ ] **Step 2: TerminalPane transparency**

Read `src/renderer/src/components/TerminalPane.jsx`. Make these changes:
- Add `allowTransparency: true` to the `new Terminal({...})` options.
- It reads the theme via `themeColors(theme)` (or similar) to set the xterm `theme.background`. Replace the background value so that **when an animated theme is active and animations are on**, it uses `terminalBg(theme, intensityToAlpha(intensity))`; otherwise the opaque `themeColors(theme).background`. Import `terminalBg` from `../lib/themes` and `intensityToAlpha` from `../lib/appearance`.
- Read `intensity`/`animations`/`theme` from `useSettings()` (the pane already consumes theme); ensure the theme-applying effect re-runs when `intensity`/`animations` change so live changes take effect.

Concretely, where the pane builds the xterm theme object, compute:

```js
const animatedBg = animationsOn && isAnimated(theme)
const background = animatedBg ? terminalBg(theme, intensityToAlpha(intensity)) : themeColors(theme).background
```

and pass `background` into the xterm `theme`. (Add `isAnimated` to the themes import.)

- [ ] **Step 3: AppearanceSection — Intensity control**

Read `src/renderer/src/components/settings/AppearanceSection.jsx`. Under the existing Motion control, add an Intensity segmented control:

```jsx
      <div className="set-sec-label">Intensity</div>
      <div className="set-row">
        <div className="set-row-l"><span className="set-row-name">Background intensity</span><span className="set-row-desc">How much the animated scene shows through the terminal.</span></div>
        <div className="set-seg">
          {['subtle', 'balanced', 'bold'].map((v) => (
            <button key={v} className={'set-seg-btn' + ((settings.appearance.intensity || 'balanced') === v ? ' on' : '')} onClick={() => update('appearance.intensity', v)}>{v}</button>
          ))}
        </div>
      </div>
```

(Use the same `useSettings()`/`update` the section already imports.)

- [ ] **Step 4: index.css cleanup + canvas layer**

In `src/renderer/src/index.css`:
- Remove the old per-theme `[data-theme="…"] .theme-bg { … }` gradient rules, the `.star` / `.sun` / `.grid` / `.matrix-canvas` rules, and their `@keyframes` (now canvas-rendered). (Search for `.theme-bg`, `.star`, `.sun`, `.grid`, `.matrix-canvas`.)
- Remove any `html[data-anim="on"] .terminal-host { background: var(--bg) }` opaque override so the canvas shows behind the terminal.
- Add the canvas layer:

```css
.theme-bg-canvas { position: fixed; inset: 0; z-index: -1; pointer-events: none; display: none; }
html[data-anim="on"] .theme-bg-canvas { display: block; }
```

- [ ] **Step 5: Build + full suite + visual smoke**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3 && npm test 2>&1 | tail -5`
Expected: build succeeds; all tests pass (312 prior + 1 scenes + 2 intensity + 2 settings-intensity = 317).

Visual smoke (manual or harness): `FLUX_SMOKE_THEME=synthwave FLUX_SMOKE_SHOT=C:/tmp/flux-sw.png npm run dev` (or preview) and confirm the scene renders behind a semi-transparent terminal and text stays readable; switch intensity Subtle/Bold and confirm the terminal opacity changes; confirm Midnight/Nord/Dracula show no canvas (opaque). Stress the terminal with large output and confirm scrolling stays smooth (the transparency perf risk from the spec) — if it janks, apply the spec's fallback (opaque cells + translucent `.terminal-host` scrim) and note it.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ThemeBackground.jsx src/renderer/src/components/TerminalPane.jsx src/renderer/src/components/settings/AppearanceSection.jsx src/renderer/src/index.css
git commit -m "feat(visual): canvas ThemeBackground + transparent terminal + intensity control

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** scene-engine → Task 1; four scenes → Task 2; intensityToAlpha + terminalBg + settings intensity → Task 3; ThemeBackground rewrite + terminal transparency + intensity control + CSS cleanup → Task 4. Reactivity (Phase 3) deferred to #11; no new themes; no deps.

**Placeholder scan:** scene-engine + scenes + helpers have full code; the TerminalPane/AppearanceSection edits give the exact computation + imports and point at the existing read points (implementer reads those files — they weren't reproduced here because the transparency value is a targeted change to an existing theme-apply path).

**Type/name consistency:** `createEngine(canvas, registry)` matches ThemeBackground; scene `create(ctx)→{draw,resize}` matches the engine's `factory(ctx)` + `scene.resize/draw`; `intensityToAlpha`/`terminalBg`/`hexToRgba` exports match their tests + TerminalPane usage; `appearance.intensity` validated in settings + read by TerminalPane/AppearanceSection.

**Notes for executor:** Tasks 1→2→4 are sequential (4 imports scenes+engine); Task 3 independent. Commit after each. Engine/scenes/wiring are build- + visual-smoke-verified; helpers + settings are unit-tested. Watch the transparency perf risk in Task 4 Step 5 and record the result; the spec's fallback is available if it janks. No push/tag.
```
