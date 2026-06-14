# Tray + Deep Links (+ ntfy push) — design

**Date:** 2026-06-14
**Sub-project:** #8 of the power-user program — **completes Checkpoint B (OSS-download-ready)**.
**Goal:** Background presence (system tray), remote-nudge routing (`flux://` deep links to a session), and optional remote push (ntfy) — the latter reassigned here from #6.
**Status:** approved (autonomous run). Builds on the single-instance lock already shipped in #1.

## Decisions

- **Deep link routes:** `flux://session/<uuid>` → open that session; `flux://mission` → Mission Control. Strict parse (validate UUID). Pure `parseDeepLink` helper.
- **Delivery (Windows-first):** the single-instance `second-instance(argv)` handler (already wired in #1) scans argv for a `flux://` URL; cold start scans `process.argv` on ready; macOS `open-url` handled too. Parsed route → focus window → `deeplink:open` IPC → renderer routes.
- **Protocol registration:** `app.setAsDefaultProtocolClient('flux', …)` at runtime (dev + reinforcement) **and** electron-builder `protocols` so the installer registers it.
- **Tray:** always-present tray icon with a context menu (Show Flux, Quit). Optional **close-to-tray** (`settings.tray.closeToTray`, default off — closing the window then hides instead of quitting; tray Quit truly exits). Default off keeps current behavior; power-users opt in for an always-watching mission control.
- **ntfy push:** optional outbound POST on needs-you events (error/blocked/usage) to a user-configured URL (ntfy topic or generic webhook). Off by default. Not for turn-finished (too noisy).

## Changes

### Deep links
- New `src/main/deeplink.js` — `parseDeepLink(url)` → `{ route:'session', sessionId }` | `{ route:'mission' }` | `null`. Pure, unit-tested.
- `src/main/index.js` — `setAsDefaultProtocolClient` (dev-aware); extend the `second-instance` handler to scan argv → `parseDeepLink` → focus + `emit('deeplink:open', route)`; cold-start scan of `process.argv`; `app.on('open-url')` (macOS). 
- `electron-builder.yml` — add `protocols: { name: 'Flux Terminal', schemes: ['flux'] }`.
- `src/preload/index.js` — `deeplink.onOpen(cb)` listening `deeplink:open`.
- `src/renderer/src/App.jsx` — subscribe: `session` → `openById(sessionId)`; `mission` → `setView('mission')`.

### Tray
- New `src/main/tray.js` — `createTray({ app, getWindow, isQuitting, setQuitting, iconPath })` builds a `Tray` (icon resolution: `build/icon.ico` in dev → `process.resourcesPath` icon → a generated data-URL nativeImage fallback so packaged builds always have one), context menu **Show Flux** (restore+focus) / **Quit** (`setQuitting(true)` + `app.quit()`). Returns the tray.
- `index.js` — create the tray in `whenReady`; a module-level `isQuitting` flag; if `settings.tray.closeToTray`, the window `'close'` handler `preventDefault()` + `hide()` (unless quitting). `before-quit` sets `isQuitting`.

### ntfy push
- `settings.js` — `DEFAULTS.push = { enabled: false, url: '' }` and `DEFAULTS.tray = { closeToTray: false }`; `_load` merges both; `setByPath` routes `push.*` and `tray.*` (with type validation).
- `notify.js` — pure `shouldPush(eventType, pushSettings)` (enabled + url + a needs-you event) and `buildPushMessage(notice)` (`{ title, body }`); `Notifier` takes an injected `httpPost`; in `deliver`, after recording, if `shouldPush` → `httpPost(url, { title, body })` (ntfy: POST body text + `Title` header). Unit-tested with an injected `httpPost`.
- `index.js` — pass `httpPost` (a small `fetch`-based poster) into the `Notifier`.

### Settings UI
- `NotificationsSection.jsx` — add a **Close to tray** toggle (`tray.closeToTray`) and a **Remote push (ntfy)** subsection (enable checkbox + URL text input), all via `update(path, value)`.

## Verification

- Unit: `parseDeepLink` (valid session/mission, bad scheme, bad uuid); `shouldPush`/`buildPushMessage`; `Notifier` posts when configured (injected `httpPost`) and not otherwise; settings `push`/`tray` round-trip via `setByPath`.
- Build: `npm run build`.
- Manual: tray icon appears, Show/Quit work; with close-to-tray on, closing hides; `flux://session/<id>` (via `start flux://session/<id>` after install, or a registered dev client) opens the session; configuring an ntfy URL delivers a push on an error event.

## Out of scope

Pushover-specific API (generic URL covers ntfy + webhooks). Rich tray menus (recent sessions in the tray) — could be a later enhancement / Windows Jump List is #12.

## Files

- New: `src/main/deeplink.js`, `src/main/tray.js`, `tests/deeplink.test.js`, `tests/notify-push.test.js`.
- Edited: `src/main/index.js`, `src/main/notify.js`, `src/main/settings.js`, `src/preload/index.js`, `src/renderer/src/App.jsx`, `src/renderer/src/components/settings/NotificationsSection.jsx`, `electron-builder.yml`, `electron.vite.config.mjs` (rollup inputs: deeplink, tray), plus settings store test extension.
