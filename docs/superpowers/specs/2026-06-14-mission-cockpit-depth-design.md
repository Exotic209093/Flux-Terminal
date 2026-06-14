# Mission Control Cockpit Depth — design

**Date:** 2026-06-14
**Sub-project:** #6 of the power-user program.
**Goal:** Finish the triage cockpit — age badges (how long a session has needed you), TodoWrite progress chips on cards, and Snooze (per-session notification suppression).
**Status:** design approved (autonomous run). ntfy/Pushover push **moved to #8** (remote-notification cluster).

## Decisions

- **Age badge** = time since a session entered a needs-you status (error/blocked), tracked in the monitor (`attnSince`), surfaced on the card DTO, rendered on the card.
- **TodoWrite chips:** the parser currently only keeps a truncated `toolInput` string. Add a structured `lastTodos` capture (the most recent TodoWrite's `input.todos`) to the parser model → monitor record → card DTO → a compact "✓ done/total" chip.
- **Snooze** is a runtime action (not a persisted setting): `Notifier.snooze(sessionId, minutes)` suppresses delivery for that session until the deadline. Exposed via IPC + a card button. **Open** already works (card click + toast click).
- **Deferred / flagged:** Interrupt-from-card (only Flux-spawned `ClaudeRunner` children are interruptible; external claude processes aren't) — not built. OS-level toast action buttons (Electron `Notification.actions` is macOS-only; Windows needs toast XML) — actions live in-app instead.

## Changes

### Parser — `src/main/parser.js`
- `freshModel`: add `lastTodos: null`.
- `walkContent` tool_use case: when `block.name === 'TodoWrite'` and `Array.isArray(block.input?.todos)`, set `model.lastTodos = block.input.todos.slice(0, 50).map(t => ({ content: truncate(t.content, 200), status: t.status }))`. Additive; `counts` unchanged.

### Monitor — `src/main/monitor.js`
- In the parse block, set `rec.todos = parsed.lastTodos || null`.
- After the attention block, track `attnSince`: `const needsYou = rec.hasError || rec.blocked; if (needsYou && !rec.attnSince) rec.attnSince = now; else if (!needsYou) rec.attnSince = null`.
- Add `attnSince: null`, `todos: null` to the `_ensure` record defaults.

### Mission Control DTO — `src/main/missioncontrol.js`
- `composeCards`: add `attnSince: r.attnSince || null` and `todos: r.todos || null` to each card.
- `cardsChanged`: also flip when the todo signature changes (done/total) or `attnSince` changes, so the UI refreshes.

### Card UI — `src/renderer/src/components/MissionCard.jsx`
- For needs-you cards (`attnSince` set), render an age badge: "needs you {rel(attnSince)}".
- If `todos`, render a compact chip: "✓ {done}/{total}" (done = todos with `status==='completed'`), with a title listing the in-progress item.
- Add a Snooze button (😴 30m) that stops the card click from opening (stopPropagation) and calls `window.flux.notify.snooze(card.sessionId, 30)`.

### Notifier — `src/main/notify.js`
- Add `this.snoozed = new Map()` (sessionId → untilMs) and `snooze(sessionId, minutes)`.
- In `deliver`, after the mute check: `const until = this.snoozed.get(notice.sessionId); if (until && this.now() < until) return`.

### IPC + preload
- `ipcMain.handle('notify:snooze', (_e, { sessionId, minutes }) => { notifier.snooze(sessionId, minutes); return { ok: true } })`.
- preload: `notify.snooze: (sessionId, minutes) => ipcRenderer.invoke('notify:snooze', { sessionId, minutes })`.

## Verification

- Unit: parser `lastTodos` extraction; `composeCards` includes `attnSince`/`todos`; `cardsChanged` flips on todo/attn change; `Notifier` snooze suppresses then resumes after the deadline (injected `now`).
- Build: `npm run build`.
- Manual: a session needing you shows an age badge; a session with a todo list shows progress; snoozing a card stops its toasts for 30m.

## Files

- Edited: `src/main/parser.js`, `src/main/monitor.js`, `src/main/missioncontrol.js`, `src/main/notify.js`, `src/main/index.js` (snooze IPC), `src/preload/index.js` (snooze), `src/renderer/src/components/MissionCard.jsx`, `src/renderer/src/index.css`.
- Tests: extend `tests/parser-goldmine.test.js` (or a new `tests/parser-todos.test.js`), `tests/missioncontrol.test.js`, `tests/notify.test.js`.
