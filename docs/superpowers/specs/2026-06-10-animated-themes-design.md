# Animated themes — design

**Date:** 2026-06-10
**Status:** designed (awaiting plan + implementation)

## Goal

Keep **Midnight** as the default theme, and add visually impressive **animated** themes alongside the existing static ones. The animation should feel premium ("balanced glass"): a moving background that glows gently through translucent UI panels, while keeping the terminal crisp and never forcing motion on users who don't want it.

## Decisions (confirmed with James)

- **Theme set (7 total):**
  - **Static (unchanged):** Midnight (default), Nord, Dracula.
  - **Animated:** Aurora (new), Nebula (new), Synthwave (upgrade of existing static `synthwave`), Matrix (upgrade of existing static `matrix`). Existing keys `synthwave`/`matrix` are reused so saved preferences keep resolving.
- **Reach = "balanced glass":** animated background fills the window; sidebar/topbar/headers/cards/composer/modals become subtly translucent + blurred so motion shows through. **The terminal viewport stays fully opaque** for text crispness and xterm performance.
- **Never forced:** an "Background animation" On/Off toggle in the ⚙ settings popover (persisted to `localStorage`). `prefers-reduced-motion: reduce` defaults animation **off**, falling back to a *static* version of each theme's gradient.
- **No new dependencies:** CSS for Aurora/Nebula/Synthwave; a small hand-rolled canvas for Matrix rain.

## Architecture

### Theme model (`src/renderer/src/lib/themes.js`)

Each theme keeps its `vars` map (the CSS custom properties). Add:
- `animated: true` on aurora/nebula/synthwave/matrix (absent/false on midnight/nord/dracula).
- New `aurora` and `nebula` theme entries; richer `vars` for the upgraded `synthwave`/`matrix`.
- `themeColors(key)` gains entries for the new themes (xterm bg/fg/cursor). Terminal background is the theme's **opaque** `--bg`.
- New helper `isAnimated(key)` → boolean (pure, easy to unit test).

`applyTheme(key, { motion })` continues to set the CSS variables and `data-theme` attribute, and now also sets `data-anim="on"` on `<html>` when `isAnimated(key) && motion` (else `"off"`).

### Background layer (`src/renderer/src/components/ThemeBackground.jsx`)

A single component rendered once behind the app shell. The layer element is `position: fixed; inset: 0; z-index: -1; pointer-events: none; aria-hidden`. It renders, based on the active theme:
- aurora → empty layer (CSS gradients do everything).
- nebula → empty layer + a handful of `<span class="star">` children (CSS twinkle).
- synthwave → `<div class="sun">` + `<div class="grid">` children (CSS).
- matrix → a `<canvas>` plus a `MatrixRain` controller.
- non-animated themes → renders nothing meaningful (layer hidden via CSS when `data-anim="off"`).

**Matrix canvas:** classic falling-glyph rain drawn on `requestAnimationFrame`, throttled to ~24fps, density capped, and **paused** when `document.hidden` or the window is blurred, and when animation is off / reduced-motion. Resizes with the window. Mounts only while the matrix theme is active.

### Glass surfaces (`src/renderer/src/index.css`)

- `.theme-bg` base + per-theme visuals keyed by `[data-theme="aurora|nebula|synthwave|matrix"] .theme-bg { … }`, with their `@keyframes` (aurora drift, nebula drift + star twinkle, synthwave sun-pulse + grid-scroll, matrix handled by canvas).
- When `html[data-anim="on"]`:
  - `.theme-bg` is shown.
  - Surface elements (`.sidebar`, `.topbar`, `.sv-header`, `.session-card`, `.sv-composer`, `.big-stat`, `.stats-panel`, `.skill-card`, `.mcard`, modals/popovers, etc.) use **glass variables** — a translucent background (e.g. `--glass-panel: rgba(...)` derived per theme) + `backdrop-filter: blur(~10px)`.
  - `.terminal-host` / xterm viewport stays opaque (`--bg`).
- When `html[data-anim="off"]` (default for static themes, reduced-motion, or toggle off): `.theme-bg` is hidden or shows a **static** gradient; surfaces stay solid exactly as today. Existing themes (Midnight/Nord/Dracula) are visually unchanged.
- `@media (prefers-reduced-motion: reduce)`: disable all `@keyframes`-driven motion; keep static gradients.

### Animation toggle

- Renderer-only visual preference stored in `localStorage` (`flux.animations`, default derived from `prefers-reduced-motion`). Loaded alongside the theme.
- Surfaced as an On/Off control in the existing `SettingsPopover.jsx` (the ⚙ popover). Toggling updates `data-anim` live and re-applies the theme.
- `App.jsx` owns the `animations` state, renders `<ThemeBackground theme={theme} animated={animations} />`, and passes `motion` into `applyTheme`.

## Files touched

- `src/renderer/src/lib/themes.js` — new/upgraded themes, `animated` flag, `themeColors` entries, `isAnimated`, `applyTheme` motion arg.
- `src/renderer/src/components/ThemeBackground.jsx` — **new**; the background layer + Matrix canvas.
- `src/renderer/src/App.jsx` — render `<ThemeBackground>`, own the `animations` toggle state, wire `data-anim`.
- `src/renderer/src/components/SettingsPopover.jsx` — add the animation On/Off control.
- `src/renderer/src/index.css` — `.theme-bg` visuals + keyframes + `[data-anim="on"]` glass surfaces + reduced-motion.

## Performance

- Aurora/Nebula/Synthwave use only `transform`, `opacity`, `background-position` → GPU-composited, cheap. Modest blur radius (~10px); `will-change` used sparingly.
- Matrix canvas throttled to ~24fps, density capped, paused when hidden/blurred → negligible idle cost.
- Terminal viewport never gets `backdrop-filter` → xterm rendering unaffected.

## Testing / verification

1. **Unit tests** (`node --test`): `themes.js` — every theme has the required `vars` keys; `isAnimated` returns the right boolean per theme; `themeColors` returns bg/fg/cursor for all themes including new ones. All existing tests still green.
2. **Build** succeeds (`npm run build`).
3. **Visual verification** via the smoke harness on the built app: screenshot each animated theme (Aurora/Nebula/Synthwave/Matrix) confirming the glass surfaces + background render and the terminal stays legible; confirm Midnight/Nord/Dracula are visually unchanged; confirm the toggle Off and reduced-motion produce a static, readable result.

## Non-goals

- No per-theme custom fonts, no sound, no user-authored themes/theme editor.
- No animation behind the terminal viewport (immersive mode was not chosen).
- No changes to the existing notification/mission/usage features beyond the surfaces picking up glass styling automatically.
