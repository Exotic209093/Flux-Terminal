# Visual Reactivity + Ambient Layer — design

**Date:** 2026-06-14
**Sub-project:** #11 of the power-user program (Phase 3 of the visuals arc).
**Goal:** Make the visuals respond to live activity (scenes react to tokens/sec + errors; a global `--pulse`), plus ambient identity flourishes — a live cost odometer and WebAudio event cues.
**Status:** approved (autonomous run). Builds on #9's scene engine.

## Decisions

- **Reactivity feed:** the scene engine gains `setReactivity({ tokensPerSec, flare })`; `draw(t, dim, reactivity)` passes it to scenes. `ThemeBackground` derives `tokensPerSec` (smoothed) from successive live snapshots and raises `flare` briefly on a live error, then feeds the engine and sets a global `--pulse` CSS var.
- **Scene responses:** Matrix rain speed scales with tokens/sec; Aurora brightness + Synthwave sun flare on error/activity; Nebula shooting-star rate rises with activity. Each scene reads `reactivity` defensively (idle defaults when absent).
- **Cost odometer:** the live cost number animates (rolling tween from previous to current) instead of snapping.
- **WebAudio cues:** a tiny synthesized blip on notified events (turn-finished/error/blocked), gated by a new `audio.enabled` setting (default off). Reuses the existing `notify:history-add` event stream; AudioContext created lazily on first user gesture.
- **Deferred / flagged:** always-on-top HUD mini-window (separate BrowserWindow — heavier window management) and screensaver mode (idle-triggered fullscreen scene). Both are good follow-ups; out of scope here to keep #11 cohesive.

## Changes

### Scene engine + scenes
- `scene-engine.js`: hold a `reactivity` object (`{ tokensPerSec: 0, flare: 0 }`); `setReactivity(next)` merges it; the rAF loop passes it as the 3rd arg to `scene.draw(t, dim, reactivity)`.
- `scenes/*.js`: `draw(t, dim, reactivity = {})` reads `reactivity.tokensPerSec`/`flare` defensively — Matrix advances drops faster at higher tokens/sec; Aurora/Synthwave brighten/flare with `flare`; Nebula raises shooting-star frequency with activity. Pure helper `reactiveSpeed(base, tokensPerSec)` extracted + unit-tested.

### Live feed — `ThemeBackground.jsx` + `App.jsx`
- `App` passes the `live` snapshot to `ThemeBackground`.
- `ThemeBackground`: a small `lib/reactivity.js` pure helper computes smoothed `tokensPerSec` from `(prevTokens, prevTs, tokens, ts)`; raise `flare` to 1 on a new error and decay it; call `engine.setReactivity(...)` and set `document.documentElement.style.setProperty('--pulse', value)` on each live update (throttled). Idle/no-live → zero reactivity, `--pulse: 0`.

### Cost odometer — `src/renderer/src/components/Odometer.jsx` (new)
- Animates a numeric value from its previous render to the new one over ~400ms (rAF tween), formatted via the existing `formatUSD`. Used in `LivePanel` for the live cost (replacing the static `formatUSD` render).

### WebAudio cues — `src/renderer/src/lib/audio.js` (new) + settings + App
- `audio.js`: `playCue(type)` lazily creates a shared `AudioContext` and plays a short tone (distinct pitch/length per `turn:finished`/`turn:error`/`blocked`); no-op if unsupported.
- `settings.js`: `DEFAULTS.audio = { enabled: false }`; `_load` merge; `setByPath` route `audio.*`.
- `App.jsx`: subscribe to `window.flux.notify.onHistoryAdd`; if `settings.audio.enabled`, `playCue(entry.type)`.
- `AppearanceSection.jsx`: a "Sound cues (in-app)" toggle writing `audio.enabled`.

## Verification

- Unit: `reactiveSpeed` (scenes), `lib/reactivity.js` `tokensPerSecFrom` (smoothing/zero-guards), settings `audio` round-trip + invalid throw.
- Build: `npm run build`.
- Manual: run a tracked claude session → rain speeds up with output, `--pulse`-driven glow breathes, sun/aurora flare on an error; cost odometer rolls; enable Sound cues → a blip on turn-finished/error.

## Files

- New: `src/renderer/src/lib/reactivity.js`, `src/renderer/src/lib/audio.js`, `src/renderer/src/components/Odometer.jsx`, `tests/reactivity.test.js`, `tests/settings-audio.test.js`.
- Edited: `src/renderer/src/lib/scene-engine.js`, `src/renderer/src/lib/scenes/{aurora,nebula,synthwave,matrix}.js`, `src/renderer/src/components/ThemeBackground.jsx`, `src/renderer/src/App.jsx`, `src/renderer/src/components/LivePanel.jsx`, `src/renderer/src/components/settings/AppearanceSection.jsx`, `src/main/settings.js`.
