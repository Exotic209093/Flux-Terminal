# Visual engine + visible-everywhere — design

**Date:** 2026-06-11
**Status:** designed (awaiting plan + implementation)

## Goal

Make Flux's animated themes genuinely visible while you work, and replace the thin CSS effects with a richer Canvas-2D engine. This is **Phase 1 + 2** of the visuals arc (visible-everywhere + effects engine). Reactive-to-activity (Phase 3) and new themes (Phase 4) are deferred to their own specs.

Today the animated backgrounds (Aurora/Nebula/Synthwave/Matrix) are barely visible: the terminal viewport is fully opaque and fills the main pane, so motion only shows in the non-terminal views + faintly through the glass sidebar.

## Decisions (confirmed with James, with live demos)

- **Engine:** hand-rolled **Canvas-2D**, no new dependencies (no WebGL/three.js). One full-window canvas behind everything.
- **Four scenes** (approved from live canvas demos):
  - **Aurora** — undulating aurora curtains (additive, sine-displaced ribbons) + rising glowing motes.
  - **Nebula** — parallax starfield (depth + twinkle) + drifting nebula gradients + periodic shooting stars.
  - **Synthwave** — retro sun with scanline cutouts on a glowing horizon, perspective grid with a **single vanishing point** scrolling toward the viewer, starfield above.
  - **Matrix** — code rain with head-glow + trailing fade.
- **Visible everywhere:** the terminal becomes **semi-transparent** so the canvas shows behind it (xterm `allowTransparency: true` + background colour at an alpha). Default **Balanced = 0.76 opacity** (chosen from a readability demo).
- **Intensity setting:** `appearance.intensity` = `subtle | balanced | bold` (default `balanced`) → terminal opacity 0.90 / 0.76 / 0.62. Surfaced in Settings → Appearance.
- Static themes (Midnight/Nord/Dracula) and animations-off / reduced-motion → engine idle, terminal fully opaque (unchanged).

## Architecture

### Scene engine (`src/renderer/src/lib/scene-engine.js`, new)

- `createEngine(canvas)` → `{ setScene(key), start(), stop(), destroy() }`.
- Owns one `requestAnimationFrame` loop, DPR-aware sizing (`devicePixelRatio` capped at 2), and a `ResizeObserver`/`resize` handler that recomputes `dim = {w,h}` in CSS px and re-inits the active scene.
- Pauses the loop when `document.hidden` (visibilitychange) or `stop()` is called; resumes on `start()`.
- Holds a registry mapping theme key → scene factory. `setScene(key)` swaps the active scene (calls the new factory's `create(ctx)` and its `resize(dim)`); an unknown/static key → no scene (clears canvas, stops).

### Scenes (`src/renderer/src/lib/scenes/{aurora,nebula,synthwave,matrix}.js`, new)

Each exports a factory `create(ctx) → { draw(t, dim), resize(dim) }`:
- `create` allocates the scene's state (ribbon configs / star array / grid params / rain columns) in closure.
- `resize(dim)` recomputes size-dependent state (e.g., matrix column count, particle scaling).
- `draw(t, dim)` renders one frame at time `t` (ms). Uses additive compositing (`globalCompositeOperation='lighter'`) for glow, capped particle counts scaled to `dim`, Matrix internally throttled to ~24fps.
- These are the renderers validated in the brainstorm demos (`scenes-canvas.html` / `scenes-synthwave.html`).
- Pure, size-independent helpers (e.g., a star/particle initialiser, colour mixing) are extracted into the scene module's named exports where practical so they can be unit-tested without a DOM.

### `ThemeBackground.jsx` (rewrite)

- Renders a single `<canvas className="theme-bg-canvas" aria-hidden="true">` (the fixed layer).
- `useEffect` keyed on `[theme, animated]`: when `animated && isAnimated(theme)`, create/`start()` the engine with `setScene(theme)`; otherwise `stop()` + clear. Cleanup `destroy()`s the engine.
- Replaces the old CSS-gradient layer + per-theme child divs + matrix-only canvas.

### Visible-everywhere (terminal transparency)

- `lib/appearance.js` gains pure `intensityToAlpha(intensity)`: `subtle→0.90`, `balanced→0.76`, `bold→0.62`, default `0.76` for unknown.
- `TerminalPane.jsx`: pass `allowTransparency: true` to the xterm constructor. Compute the cell background as the theme's `--bg` colour at `intensityToAlpha(intensity)` **when** an animated theme is active and animations are on; otherwise fully opaque (alpha 1). Re-apply when theme/intensity/animations change (the pane already re-themes via `themeColors`). The pane reads `intensity`/`animations`/`theme` from `useSettings()`.
- `themes.js`: add a helper to produce the terminal background — e.g. `terminalBg(themeKey, alpha)` returning an `rgba(...)` from the theme's `--bg` hex. `themeColors(key)` keeps returning opaque values; the alpha is applied in TerminalPane via the new helper so static themes are unaffected.
- `index.css`: remove the per-theme `[data-theme="…"] .theme-bg { … }` gradient rules, the `.star/.sun/.grid/.matrix-canvas` child rules, and their `@keyframes` (now canvas-rendered). Add `.theme-bg-canvas { position:fixed; inset:0; z-index:-1; pointer-events:none; }` shown only under `html[data-anim="on"]`. Remove the `html[data-anim="on"] .terminal-host { background: var(--bg) }` opaque override so the canvas shows behind the terminal; the terminal padding/host uses a transparent or matching faint background. Keep the existing glass-surface + body/#root transparency rules.

### Settings integration

- `src/main/settings.js`: add `intensity` to the `appearance` defaults (`'balanced'`); validate in `setAppearance` (`['subtle','balanced','bold']`); `_load` merges it if valid. (Extends the just-shipped settings store.)
- `settings-context.jsx`: no special handling needed beyond carrying the value; consumers read `settings.appearance.intensity`.
- `components/settings/AppearanceSection.jsx`: add an "Intensity" segmented control (Subtle/Balanced/Bold) under Motion, writing `update('appearance.intensity', val)`.

## Performance + risk

- One canvas, one rAF, DPR ≤ 2, particle counts scaled to canvas area, Matrix throttled, loop paused when hidden/blurred and when animations are off → negligible idle cost.
- **Risk:** `allowTransparency: true` disables xterm's opaque fast path, which can slow heavy terminal scrolling. **Mitigation/verification:** after wiring, stress the terminal (e.g., `dir`/large output) and confirm it stays smooth. **Fallback if it janks:** keep xterm cells opaque and instead composite a semi-transparent `.terminal-host` over the canvas (motion shows through the chrome/padding and behind the panels, not through glyph cells). The intensity control still applies to the host scrim in that fallback.

## Testing / verification

1. **Unit tests** (`node --test`): `intensityToAlpha` (each level + default); `settings.js` `appearance.intensity` validation + v-load-forward; any pure scene-init helper that's extracted. All existing tests stay green.
2. **Build** succeeds (`npm run build`).
3. **Visual:** smoke each animated theme (`FLUX_SMOKE_THEME=aurora|nebula|synthwave|matrix`) on the built app, confirming the scene renders behind the terminal and text stays readable; capture Subtle/Balanced/Bold to confirm the intensity control changes terminal opacity; confirm Midnight/Nord/Dracula are unchanged (opaque, no canvas) and animations-off hides it.
4. Confirm terminal scroll performance with transparency (the risk above); record the result.

## Non-goals

- No reactive-to-activity behaviour (Phase 3) — the loop is a steady animation for now.
- No new themes (Phase 4).
- No WebGL/three.js; no audio reactivity; no per-scene user configuration beyond the global intensity.
