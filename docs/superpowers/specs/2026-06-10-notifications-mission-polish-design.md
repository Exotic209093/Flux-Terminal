# Notifications & Mission Control polish — design

**Date:** 2026-06-10
**Status:** approved (James) — ready to plan. Polish pass over Milestones A (watcher+notifications) and B (Mission Control), both already merged to main.

## Goal

Make the notification + Mission Control features trustworthy and inspectable: verify the signals actually fire, tune the best-effort error detection against a real transcript, let the user test notifications on demand, add a notification history, and sharpen the Mission Control cards.

## Decisions (confirmed with James)

- **Thresholds stay fixed** at their tuned defaults (30s long-turn, 90s blocked, 90% usage). No settings UI for them — only wording is refined. (Can expose later if they feel wrong.)
- **Notification history is in-memory only** (clears on quit). A bounded ring of the last 50 delivered notices.

## Scope (4 areas)

### 1. Notifications: verify + tune
- **Error detection:** locate a real errored/interrupted transcript under `~/.claude/projects`, inspect its actual record shape, and expand `parser.isErrorRecord()` to match — adding a test case built from the real shape. Today's three markers (`isApiErrorMessage`, `type:result+is_error`, `type:system+subtype:error`) are an untested guess; keep them and add whatever real markers are found.
- **Wording:** refine `notify.titleFor()` — turn-finished includes elapsed time (e.g. "✓ Done in 2m"); error/blocked include the project name in the body. Keep it terse.
- **Live verification (manual):** drive a real >30s tracked session and confirm the toast/badge fires once; confirm a blocked/error case if reproducible. The test button (area 3) makes this instant.

### 2. Mission Control: states + cards
- **Exact cost:** stop using the coarse main-side `estimateCostUsd`. Add `usage` (the `{input,output,cacheRead,cacheCreation}` shape) to the monitor record and the card DTO; compute cost in `MissionCard` via the existing renderer `pricing.js` `estimateCost(usage, model)` — the same numbers the live bar shows. Drop `costUsd` from the card (or keep as ignored). `monitor.estimateCostUsd` is removed.
- **Filter row:** a small segmented control above the grid — **All · Needs you · Running** — filtering the rendered groups. Default All.
- **Manual refresh:** a ⟳ button that re-calls `missioncontrol:list`.
- Empty-state text unchanged ("No active sessions in the last 24h.").

### 3. Notification settings UX (the ⚙ popover)
- **"Send test notification" button:** fires a synthetic notice through the real `Notifier` via a `test()` method that bypasses mute, suppression, AND coalescing so it ALWAYS shows (it's an explicit user action) — using the `turnFinished` mode setting so the user sees their configured style. New `notify:test` IPC. (It still records to history with mode `'test'`.)
- **Master mute toggle (do-not-disturb):** `notify.muted` boolean in `settings.js`; when true, `Notifier.deliver` short-circuits (no toast/badge/sound, but history still records as "muted"? No — when muted, deliver returns before recording; keep simple: muted = nothing happens). A checkbox at the top of the popover.

### 4. Notification history
- `notify.js` keeps a bounded ring (`MAX_HISTORY = 50`) of delivered notices `{type, sessionId, title, ts, mode}` (mode = 'toast'|'badge'). `getHistory()` returns a copy. On each delivery, push + invoke an injected `onHistory(entry)` callback.
- Main: `notify:history` IPC (get) + push `notify:history-add` (from `onHistory`).
- Renderer: a **🔔 bell** in the topbar control cluster with an unread count badge; clicking opens a dropdown panel listing recent notices (type icon + title + relative time), newest first; clicking an entry opens that session (reuse the `notify:open-session` → App `openSession` path); opening the panel clears the unread count.

## Architecture (additive)

- `src/main/parser.js` — extend `isErrorRecord` marker set (+ test).
- `src/main/notify.js` — add `history` ring + `getHistory()` + `onHistory` callback; add `test()` (or handle a `__test__` notice that skips suppression/coalescing); honor `settings.notify.muted`; refine `titleFor`.
- `src/main/settings.js` — add `notify.muted` (default false) to DEFAULTS + merge.
- `src/main/monitor.js` — include `usage` in the record + remove `estimateCostUsd`; `missioncontrol.js` `composeCards` includes `usage` (+ keep `model`), drops `costUsd`.
- `src/main/index.js` + `src/preload/index.js` — IPC: `notify:test`, `notify:history`, pushed `notify:history-add`; wire `notifier.onHistory`.
- Renderer: `SettingsPopover.jsx` (+ test button, + mute), new `NotificationBell.jsx` (topbar panel), `MissionControl.jsx`/`MissionCard.jsx` (filter, refresh, pricing-based cost), `App.jsx` (render bell; wire history + open-from-bell), `index.css` (bell/panel/filter styles).

## Testing

- `parser.isErrorRecord` — add the real-shape marker case (unit).
- `notify.js` — history ring bounded to 50 + newest-first + `onHistory` fired; `test()` bypasses suppression/coalescing; `muted` short-circuits delivery (unit, extend `tests/notify.test.js`).
- `settings.js` — `muted` round-trips (extend tests).
- `missioncontrol.js` — card carries `usage`; `cardsChanged` still detects changes (extend tests).
- Renderer (no unit tests per repo convention): build + dev smoke screenshots for the bell panel, the filter row, and exact cost; manual live-session verification for the real notification path.

## Non-goals

- No configurable thresholds, no per-event sound, no quiet-hours schedule, no persisted history, no email/mobile push. Mute is a simple on/off.
