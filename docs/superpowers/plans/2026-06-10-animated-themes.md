# Animated Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Midnight as the default theme and add four animated themes (Aurora, Nebula, Synthwave, Matrix) with a "balanced glass" treatment — a fixed animated background that shows through translucent, blurred UI panels while the terminal stays opaque — plus a settings toggle and a reduced-motion fallback.

**Architecture:** Themes stay data-driven in `lib/themes.js` (CSS-variable maps); an `animated` flag plus a new `data-anim` attribute on `<html>` gates the effects. A single `<ThemeBackground>` layer renders the moving background (CSS for Aurora/Nebula/Synthwave; a throttled `<canvas>` for Matrix). CSS keyed off `[data-theme]` / `[data-anim="on"]` paints the background and switches panels to glass. A renderer-only `localStorage` pref (`flux.animations`) toggles it, defaulting off under `prefers-reduced-motion`.

**Tech Stack:** React 19 renderer, plain CSS (custom properties, keyframes, `backdrop-filter`), Canvas 2D, `node:test` for the pure-logic units. No new dependencies.

---

## File Structure

- `src/renderer/src/lib/themes.js` — **modify**: add `aurora` + `nebula` themes, `animated:true` on the four animated themes, `--glass-panel` var per animated theme, new `isAnimated()` / `shouldAnimate()` exports, and a `motion` option on `applyTheme()`.
- `src/renderer/src/lib/appearance.js` — **create**: animation on/off preference (`resolveAnimations` pure resolver, `loadAnimations`, `saveAnimations`, `prefersReducedMotion`).
- `src/renderer/src/components/ThemeBackground.jsx` — **create**: the fixed background layer; renders nebula stars / synthwave sun+grid / matrix canvas; owns the Matrix rain animation.
- `src/renderer/src/index.css` — **modify**: `.theme-bg` base + per-theme visuals + keyframes, `[data-anim="on"]` glass surfaces, reduced-motion media query.
- `src/renderer/src/App.jsx` — **modify**: own the `animations` toggle state, render `<ThemeBackground>`, pass `motion` to `applyTheme`, thread toggle props to `ControlBar`.
- `src/renderer/src/components/ControlBar.jsx` — **modify**: pass `animations` + `onToggleAnimations` through to `SettingsPopover`.
- `src/renderer/src/components/SettingsPopover.jsx` — **modify**: add the "Background animation" on/off control.
- `tests/themes.test.js` — **create**.
- `tests/appearance.test.js` — **create**.

---

### Task 1: Theme data + `isAnimated`/`shouldAnimate` + `applyTheme(motion)`

**Files:**
- Modify: `src/renderer/src/lib/themes.js`
- Test: `tests/themes.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/themes.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')

const REQUIRED_VARS = ['--bg', '--bg-panel', '--bg-elev', '--bg-hover', '--border',
  '--text', '--text-dim', '--text-faint', '--accent', '--accent-2', '--accent-glow']
const ANIMATED = ['aurora', 'nebula', 'synthwave', 'matrix']
const STATIC = ['midnight', 'nord', 'dracula']

test('every theme has a name and all required CSS vars', async () => {
  const { THEMES } = await import('../src/renderer/src/lib/themes.js')
  for (const key of [...STATIC, ...ANIMATED]) {
    const t = THEMES[key]
    assert.ok(t, `theme ${key} exists`)
    assert.strictEqual(typeof t.name, 'string')
    for (const v of REQUIRED_VARS) {
      assert.strictEqual(typeof t.vars[v], 'string', `${key} has ${v}`)
    }
  }
})

test('animated themes carry --glass-panel and the animated flag; static ones do not', async () => {
  const { THEMES, isAnimated } = await import('../src/renderer/src/lib/themes.js')
  for (const key of ANIMATED) {
    assert.strictEqual(isAnimated(key), true, `${key} animated`)
    assert.strictEqual(typeof THEMES[key].vars['--glass-panel'], 'string', `${key} glass var`)
  }
  for (const key of STATIC) {
    assert.strictEqual(isAnimated(key), false, `${key} not animated`)
  }
  assert.strictEqual(isAnimated('does-not-exist'), false)
})

test('shouldAnimate requires both an animated theme and motion enabled', async () => {
  const { shouldAnimate } = await import('../src/renderer/src/lib/themes.js')
  assert.strictEqual(shouldAnimate('aurora', true), true)
  assert.strictEqual(shouldAnimate('aurora', false), false)
  assert.strictEqual(shouldAnimate('midnight', true), false)
})

test('themeColors returns bg/fg/cursor for every theme', async () => {
  const { THEMES, themeColors } = await import('../src/renderer/src/lib/themes.js')
  for (const key of Object.keys(THEMES)) {
    const c = themeColors(key)
    assert.match(c.background, /^#|rgb/, `${key} bg`)
    assert.match(c.foreground, /^#|rgb/, `${key} fg`)
    assert.match(c.cursor, /^#|rgb/, `${key} cursor`)
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `isAnimated`/`shouldAnimate` are not exported and `aurora`/`nebula` themes don't exist yet.

- [ ] **Step 3: Add the new themes + flags + helpers**

In `src/renderer/src/lib/themes.js`, add `animated: true` and a `--glass-panel` var to the existing `synthwave` and `matrix` entries, and add two new entries to the `THEMES` object (place after `dracula`, before `matrix`):

```js
  aurora: {
    name: 'Aurora',
    animated: true,
    vars: {
      '--bg': '#06110f',
      '--bg-panel': '#0a1a16',
      '--bg-elev': '#0e241e',
      '--bg-hover': '#143029',
      '--border': '#163a31',
      '--text': '#d7f5ec',
      '--text-dim': '#7fb8a9',
      '--text-faint': '#4f8073',
      '--accent': '#5eead4',
      '--accent-2': '#a78bfa',
      '--accent-glow': 'rgba(94, 234, 212, 0.4)',
      '--glass-panel': 'rgba(6, 26, 22, 0.55)'
    }
  },
  nebula: {
    name: 'Nebula',
    animated: true,
    vars: {
      '--bg': '#070612',
      '--bg-panel': '#0c0a1d',
      '--bg-elev': '#141128',
      '--bg-hover': '#1d1838',
      '--border': '#241f44',
      '--text': '#e6e3ff',
      '--text-dim': '#9a93c8',
      '--text-faint': '#635c8f',
      '--accent': '#8b9cff',
      '--accent-2': '#d68bff',
      '--accent-glow': 'rgba(139, 156, 255, 0.4)',
      '--glass-panel': 'rgba(12, 10, 29, 0.55)'
    }
  },
```

For the existing `synthwave` entry, add `animated: true,` after `name:` and add `'--glass-panel': 'rgba(31, 20, 48, 0.5)'` to its `vars`. For the existing `matrix` entry, add `animated: true,` after `name:` and add `'--glass-panel': 'rgba(8, 18, 8, 0.55)'` to its `vars`.

Then add these exports (after the `THEMES` object, before `applyTheme`):

```js
export function isAnimated(key) {
  return !!(THEMES[key] && THEMES[key].animated)
}

export function shouldAnimate(key, motion) {
  return isAnimated(key) && !!motion
}
```

- [ ] **Step 4: Update `applyTheme` to set `data-anim`**

Replace the existing `applyTheme` with:

```js
export function applyTheme(key, { motion = true } = {}) {
  const theme = THEMES[key] || THEMES.midnight
  const root = document.documentElement
  for (const [k, v] of Object.entries(theme.vars)) {
    root.style.setProperty(k, v)
  }
  root.setAttribute('data-theme', key)
  root.setAttribute('data-anim', shouldAnimate(key, motion) ? 'on' : 'off')
}
```

(`themeColors` is unchanged — it already reads `--bg`/`--text`/`--accent` generically, so the new themes work automatically.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS (all suites, including the pre-existing ones — total goes up by 4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/themes.js tests/themes.test.js
git commit -m "feat(themes): add Aurora/Nebula + animated flag + data-anim"
```

---

### Task 2: Animation preference (`appearance.js`)

**Files:**
- Create: `src/renderer/src/lib/appearance.js`
- Test: `tests/appearance.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/appearance.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')

test('resolveAnimations: explicit pref wins, else defaults to !reducedMotion', async () => {
  const { resolveAnimations } = await import('../src/renderer/src/lib/appearance.js')
  assert.strictEqual(resolveAnimations('1', true), true)   // user forced on
  assert.strictEqual(resolveAnimations('0', false), false) // user forced off
  assert.strictEqual(resolveAnimations(null, false), true) // no pref, motion ok
  assert.strictEqual(resolveAnimations(null, true), false) // no pref, reduced motion
  assert.strictEqual(resolveAnimations('', true), false)   // unknown -> default path
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `appearance.js` does not exist.

- [ ] **Step 3: Create the module**

Create `src/renderer/src/lib/appearance.js`:

```js
// Renderer-only "background animation" preference. Stored in localStorage as
// '1'/'0'; absent means "follow the OS reduced-motion setting".
const STORAGE_KEY = 'flux.animations'

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// Pure resolver so the default logic is unit-testable. `saved` is '1' | '0' | null.
export function resolveAnimations(saved, reducedMotion) {
  if (saved === '1') return true
  if (saved === '0') return false
  return !reducedMotion
}

export function loadAnimations() {
  let saved = null
  try {
    saved = localStorage.getItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  return resolveAnimations(saved, prefersReducedMotion())
}

export function saveAnimations(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/appearance.js tests/appearance.test.js
git commit -m "feat(themes): animation on/off preference helper"
```

---

### Task 3: `ThemeBackground` component (incl. Matrix canvas)

**Files:**
- Create: `src/renderer/src/components/ThemeBackground.jsx`

No unit test (renderer component, per repo convention — verified visually in Task 6).

- [ ] **Step 1: Create the component**

Create `src/renderer/src/components/ThemeBackground.jsx`:

```jsx
import { useEffect, useRef } from 'react'
import { isAnimated } from '../lib/themes'

// Fixed star positions for the Nebula theme (left, top, animation-delay).
const STARS = [
  ['12%', '18%', '0s'], ['28%', '9%', '0.6s'], ['44%', '24%', '1.2s'],
  ['61%', '13%', '0.3s'], ['77%', '28%', '1.5s'], ['88%', '16%', '0.9s'],
  ['20%', '54%', '1.1s'], ['38%', '69%', '0.4s'], ['67%', '61%', '1.7s'],
  ['83%', '73%', '0.8s'], ['52%', '84%', '1.3s'], ['9%', '78%', '0.2s']
]

// Classic falling-glyph "Matrix rain" on a canvas. Throttled to ~24fps and
// paused while the window is hidden so it costs nothing in the background.
function useMatrixRain(canvasRef, enabled) {
  useEffect(() => {
    if (!enabled) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const FONT = 14
    const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺ0123456789ABCDEF'
    let cols = 0
    let drops = []
    let raf = 0
    let last = 0
    let running = true

    const resize = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      cols = Math.max(1, Math.floor(canvas.width / FONT))
      drops = Array.from({ length: cols }, () => Math.random() * (canvas.height / FONT))
    }

    const frame = (t) => {
      if (!running) return
      raf = requestAnimationFrame(frame)
      if (t - last < 42) return // ~24fps
      last = t
      ctx.fillStyle = 'rgba(5, 10, 5, 0.16)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#39ff14'
      ctx.font = FONT + 'px monospace'
      for (let i = 0; i < cols; i++) {
        const ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
        ctx.fillText(ch, i * FONT, drops[i] * FONT)
        if (drops[i] * FONT > canvas.height && Math.random() > 0.975) drops[i] = 0
        drops[i]++
      }
    }

    const onVisibility = () => {
      running = !document.hidden
      if (running) raf = requestAnimationFrame(frame)
    }

    resize()
    raf = requestAnimationFrame(frame)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [canvasRef, enabled])
}

export default function ThemeBackground({ theme, animated }) {
  const canvasRef = useRef(null)
  const matrixOn = theme === 'matrix' && animated && isAnimated(theme)
  useMatrixRain(canvasRef, matrixOn)

  // CSS (via html[data-anim]) hides this layer entirely when animation is off,
  // so we can always render it; structural children are theme-specific.
  return (
    <div className="theme-bg" aria-hidden="true">
      {theme === 'nebula' &&
        STARS.map(([left, top, delay], i) => (
          <span className="star" key={i} style={{ left, top, animationDelay: delay }} />
        ))}
      {theme === 'synthwave' && (
        <>
          <div className="sun" />
          <div className="grid" />
        </>
      )}
      {theme === 'matrix' && <canvas ref={canvasRef} className="matrix-canvas" />}
    </div>
  )
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds (no import/syntax errors). The component isn't rendered yet, so no visual change.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ThemeBackground.jsx
git commit -m "feat(themes): ThemeBackground layer + matrix rain canvas"
```

---

### Task 4: CSS — background visuals, glass surfaces, reduced-motion

**Files:**
- Modify: `src/renderer/src/index.css` (append a new section at end of file)

No unit test (verified visually in Task 6).

- [ ] **Step 1: Append the animated-theme stylesheet**

Add to the end of `src/renderer/src/index.css`:

```css
/* ---- Animated themes (balanced glass) ----------------------------------- */
:root { --glass-panel: rgba(14, 19, 32, 0.55); --glass-scrim: rgba(0, 0, 0, 0.22); }

/* Fixed background layer, hidden unless an animated theme is active + motion on. */
.theme-bg { display: none; position: fixed; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; }
html[data-anim="on"] .theme-bg { display: block; }

/* Let the fixed layer show through the app frame; terminal stays opaque (below). */
html[data-anim="on"] body,
html[data-anim="on"] #root,
html[data-anim="on"] .app-shell,
html[data-anim="on"] .main-pane,
html[data-anim="on"] .pane-slot,
html[data-anim="on"] .session-view,
html[data-anim="on"] .stats-view,
html[data-anim="on"] .skills-view,
html[data-anim="on"] .mission { background: transparent; }

/* Faint scrim on scrollable content areas so text stays readable over motion. */
html[data-anim="on"] .sv-timeline,
html[data-anim="on"] .stats-view,
html[data-anim="on"] .skills-view,
html[data-anim="on"] .mission { background: var(--glass-scrim); }

/* Glass surfaces. */
html[data-anim="on"] .sidebar,
html[data-anim="on"] .topbar,
html[data-anim="on"] .live-panel,
html[data-anim="on"] .sv-header,
html[data-anim="on"] .sv-composer,
html[data-anim="on"] .big-stat,
html[data-anim="on"] .stats-panel,
html[data-anim="on"] .skill-card,
html[data-anim="on"] .mcard,
html[data-anim="on"] .prompt-card,
html[data-anim="on"] .settings-pop,
html[data-anim="on"] .bell-panel {
  background: var(--glass-panel);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

/* Terminal viewport must stay fully opaque — crisp text, no xterm jank. */
html[data-anim="on"] .terminal-host { background: var(--bg); }

/* AURORA */
html[data-theme="aurora"] .theme-bg {
  background:
    radial-gradient(60% 80% at 20% 30%, rgba(94, 234, 212, 0.5), transparent 60%),
    radial-gradient(55% 70% at 82% 60%, rgba(167, 139, 250, 0.5), transparent 60%),
    radial-gradient(70% 60% at 50% 95%, rgba(56, 224, 158, 0.4), transparent 60%), #06110f;
  filter: blur(8px);
  animation: aurora-drift 9s ease-in-out infinite alternate;
}
@keyframes aurora-drift {
  0% { transform: translate3d(-6%, -4%, 0) scale(1.15); }
  100% { transform: translate3d(6%, 5%, 0) scale(1.3); }
}

/* NEBULA */
html[data-theme="nebula"] .theme-bg {
  background:
    radial-gradient(45% 55% at 70% 28%, rgba(214, 139, 255, 0.45), transparent 60%),
    radial-gradient(55% 60% at 28% 72%, rgba(139, 156, 255, 0.4), transparent 62%), #070612;
  background-size: 160% 160%;
  animation: nebula-drift 14s ease-in-out infinite alternate;
}
@keyframes nebula-drift {
  0% { background-position: 0% 0%; }
  100% { background-position: 100% 100%; }
}
.theme-bg .star {
  position: absolute; width: 2px; height: 2px; border-radius: 50%;
  background: #fff; opacity: 0.2; animation: star-tw 2.4s ease-in-out infinite;
}
@keyframes star-tw { 0%, 100% { opacity: 0.2; } 50% { opacity: 1; } }

/* SYNTHWAVE */
html[data-theme="synthwave"] .theme-bg {
  background: linear-gradient(#241038 0%, #3a1c5c 55%, #120a20 100%);
}
.theme-bg .sun {
  position: absolute; left: 50%; top: 30%; width: 220px; height: 220px;
  transform: translate(-50%, -50%); border-radius: 50%;
  background: linear-gradient(#ffd36e, #ff5fa8 60%, #ff4fd8);
  box-shadow: 0 0 80px rgba(255, 79, 216, 0.7);
  animation: sun-pulse 2.6s ease-in-out infinite;
}
@keyframes sun-pulse { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.22); } }
.theme-bg .grid {
  position: absolute; left: -20%; right: -20%; bottom: 0; height: 45%;
  background:
    repeating-linear-gradient(to right, rgba(54, 224, 255, 0.5) 0 1px, transparent 1px 40px),
    repeating-linear-gradient(to bottom, rgba(54, 224, 255, 0.5) 0 1px, transparent 1px 40px);
  transform: perspective(220px) rotateX(62deg); transform-origin: bottom;
  animation: grid-scroll 1.4s linear infinite;
}
@keyframes grid-scroll { from { background-position: 0 0, 0 0; } to { background-position: 0 40px, 0 40px; } }

/* MATRIX (canvas does the rain) */
html[data-theme="matrix"] .theme-bg { background: #050a05; }
.theme-bg .matrix-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }

/* Respect reduced motion: freeze all keyframe motion, keep static gradients. */
@media (prefers-reduced-motion: reduce) {
  .theme-bg, .theme-bg .star, .theme-bg .sun, .theme-bg .grid { animation: none !important; }
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds. (Still no visual change until `<ThemeBackground>` is rendered in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/index.css
git commit -m "feat(themes): animated background + glass-surface CSS"
```

---

### Task 5: Wire up App, ControlBar, SettingsPopover

**Files:**
- Modify: `src/renderer/src/App.jsx`
- Modify: `src/renderer/src/components/ControlBar.jsx`
- Modify: `src/renderer/src/components/SettingsPopover.jsx`

No unit test (verified visually in Task 6).

- [ ] **Step 1: App — import, state, render, props**

In `src/renderer/src/App.jsx`:

(a) Add imports near the other lib imports (after line 13's models import):

```jsx
import ThemeBackground from './components/ThemeBackground'
import { loadAnimations, saveAnimations } from './lib/appearance'
```

(b) Add state next to the `theme` state (after the `const [theme, setThemeState] = useState(loadTheme())` line):

```jsx
  const [animations, setAnimationsState] = useState(loadAnimations())
  const setAnimations = useCallback((on) => {
    saveAnimations(on)
    setAnimationsState(on)
  }, [])
```

(c) Replace the theme effect:

```jsx
  useEffect(() => {
    applyTheme(theme, { motion: animations })
  }, [theme, animations])
```

(d) Render the background layer as the first child of the shell. Change `<div className="app-shell">` to be immediately followed by the layer:

```jsx
    <div className="app-shell">
      <ThemeBackground theme={theme} animated={animations} />
      <Sidebar
```

(e) Pass the toggle into `ControlBar` (add the two props to the existing `<ControlBar ... />`):

```jsx
          <ControlBar
            model={model}
            onModel={setModel}
            agents={live && live.tracking ? live.subagents : null}
            liveActive={!!(live && live.tracking && live.state === 'live')}
            onAgentsClick={() => setView('terminal')}
            ptyId={activePtyId}
            animations={animations}
            onToggleAnimations={setAnimations}
          />
```

- [ ] **Step 2: ControlBar — thread props through to SettingsPopover**

In `src/renderer/src/components/ControlBar.jsx`, add `animations` and `onToggleAnimations` to the destructured props in the function signature, and pass them to the existing `<SettingsPopover ... />`:

```jsx
        {settingsOpen && (
          <SettingsPopover
            onClose={() => setSettingsOpen(false)}
            animations={animations}
            onToggleAnimations={onToggleAnimations}
          />
        )}
```

(The function signature currently destructures props like `{ model, onModel, agents, liveActive, onAgentsClick, ptyId }` — add `, animations, onToggleAnimations` to that list.)

- [ ] **Step 3: SettingsPopover — add the toggle**

In `src/renderer/src/components/SettingsPopover.jsx`, update the signature to `export default function SettingsPopover({ onClose, animations, onToggleAnimations })` and add an Appearance control. Insert this block immediately after the opening `<div className="settings-pop" ...>` and before the `Notifications` title:

```jsx
      <div className="settings-pop-title">Appearance</div>
      <label className="settings-mute">
        <input
          type="checkbox"
          checked={!!animations}
          onChange={(e) => onToggleAnimations(e.target.checked)}
        />
        Background animation
      </label>
```

- [ ] **Step 4: Verify it builds + lints**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.jsx src/renderer/src/components/ControlBar.jsx src/renderer/src/components/SettingsPopover.jsx
git commit -m "feat(themes): wire ThemeBackground + animation toggle into the app"
```

---

### Task 6: Verify (tests, build, per-theme screenshots) + final commit

**Files:** none (verification only)

- [ ] **Step 1: All tests green**

Run: `npm test`
Expected: all suites PASS (existing + the two new files; total = previous 160 + 5 new = 165).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Screenshot each theme on the built app**

Kill any stray Electron first, then capture each theme via the built-in smoke harness (the production app renders over `app://`). Run from the project root in PowerShell, one per theme:

```powershell
Get-Process electron,"Flux Terminal" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$exe = "node_modules\.bin\electron.cmd"
foreach ($t in 'midnight','aurora','nebula','synthwave','matrix') {
  $env:FLUX_SMOKE_THEME = $t
  $env:FLUX_SMOKE_SHOT = "C:\tmp\flux-$t.png"
  & $exe . | Out-Null
}
Remove-Item Env:\FLUX_SMOKE_THEME, Env:\FLUX_SMOKE_SHOT
```

- [ ] **Step 4: Inspect the screenshots**

Read `C:\tmp\flux-midnight.png` (must look identical to before — no glass, solid panels) and `C:\tmp\flux-aurora.png`, `flux-nebula.png`, `flux-synthwave.png`, `flux-matrix.png`. Confirm for each animated theme: the background is visible, panels read as translucent glass, the terminal text stays crisp/legible. If any panel is unreadable, raise the panel's `--glass-panel` alpha (Task 1) or `--glass-scrim` (Task 4) and re-shoot.
Expected: Midnight unchanged; the four animated themes show their effect with readable text.

- [ ] **Step 5: Verify the off / reduced-motion path**

Launch the built app normally (`node_modules\.bin\electron.cmd .`), open the ⚙ settings popover, toggle **Background animation** off, and confirm panels become solid and the background motion stops (and that the choice persists across a relaunch).
Expected: toggle works and persists.

- [ ] **Step 6: Final commit (only if Step 4 required a tuning change)**

```bash
git add -A
git commit -m "fix(themes): tune glass opacity for readability"
```

---

## Self-Review

- **Spec coverage:** theme set incl. Midnight default + Nord/Dracula static + Aurora/Nebula new + Synthwave/Matrix upgraded (Task 1) ✓; balanced glass via `data-anim` + translucent surfaces, terminal opaque (Task 4) ✓; CSS for Aurora/Nebula/Synthwave + canvas Matrix (Tasks 3–4) ✓; toggle in ⚙ popover persisted to localStorage (Tasks 2, 5) ✓; reduced-motion default-off + static fallback (Tasks 2, 4) ✓; no new deps ✓; unit tests for `themes.js` + verification plan (Tasks 1, 6) ✓.
- **Placeholders:** none — every code/CSS block is complete.
- **Type/name consistency:** `isAnimated`/`shouldAnimate`/`applyTheme(key,{motion})` defined in Task 1 and used in Tasks 3 & 5; `resolveAnimations`/`loadAnimations`/`saveAnimations` defined in Task 2 and used in Task 5; `ThemeBackground({theme, animated})` defined in Task 3 and rendered in Task 5; `--glass-panel` defined per theme (Task 1) + fallback in `:root` (Task 4) and consumed by the glass rules (Task 4). Consistent.
- **Note / spec deviation:** the spec said the toggle lives in the gear popover — this plan keeps it there (an "Appearance" section in `SettingsPopover`), threaded App → ControlBar → SettingsPopover.
```
