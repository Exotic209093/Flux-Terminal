# Milestone A — "Flux watches for you": auto-attach + notifications

**Date:** 2026-06-10
**Status:** approved (ordering + toast/badge split approved by James; details delegated)

## Goal

Flux should tell James when a session needs him instead of him watching the app.
Two halves that share machinery:

1. **Auto-attach** — any `claude` session that becomes active on disk (started from a
   plain terminal, VS Code, anywhere) is detected and tracked live, exactly like
   button-launched ones.
2. **Notifications** — OS-level signals when a tracked session changes state:
   - **turn finished** (assistant reply completed after a long run) → quiet: tray
     overlay badge + optional sound
   - **error / turn failed** → Windows toast
   - **blocked waiting on input** (best-effort heuristic) → Windows toast
   - **usage limit threshold crossed** (5h or weekly window ≥ 90%) → Windows toast

Toasts for "needs you", badge for routine — per-event setting can override.

## Architecture

### Auto-attach (main process)

- New module `src/main/autoattach.js`. Watch `~/.claude/projects/` (one
  `fs.watch` per project dir, plus a periodic rescan fallback ~15s for robustness —
  fs.watch on Windows is flaky for nested dirs).
- A session is **active** when its `.jsonl` mtime changed within the last 60s and it
  is not already tracked by `live.js`.
- On activation: attach the existing live tracker (reuse `live.js` — the same
  byte-offset incremental tail used by `live:track`). Emit `live:autoattached` to the
  renderer so the session shows in the live UI with an "auto" origin marker.
- On inactivity (no writes for 5 min) or session file end: detach, emit update.
- Must not double-track sessions launched via the existing button (`live:track`).
  `live.js` owns a single registry of tracked session ids; autoattach consults it.

### Event detection (main process)

- New module `src/main/attention.js`: consumes tracker updates (parsed JSONL deltas)
  and derives events with a small state machine per session:
  - `turn:finished` — a user message opened a turn; the closing assistant message
    arrives AND turn wall-time ≥ 30s (configurable). Short turns never notify.
  - `turn:error` — terminal error markers in the stream (API error events,
    `interrupted`/failure result records — reuse parser's classification from the
    recent interrupt work).
  - `blocked` — turn open + no file writes for ≥ 90s while the underlying process
    still appears alive. Best-effort; ship behind a default-on setting, document the
    heuristic. If transcript shows an explicit permission-request record, use it.
  - `usage:threshold` — from the existing `UsagePoller`: a window crossing ≥ 90%
    (fire once per window per reset cycle).
- Each event: `{ type, sessionId, project, title, body, ts }`.

### Delivery (main process)

- New module `src/main/notify.js`:
  - **Toast**: Electron `new Notification({ title, body })` — works on Windows 11
    natively. Clicking focuses the Flux window and opens that session (send
    `notify:open-session` to renderer).
  - **Badge**: `win.setOverlayIcon()` with a count/dot + `flashFrame(true)` option;
    clear when window focused.
  - **Sound**: optional, off by default (use `shell.beep()` — no audio asset needed).
  - **Suppression**: no toast/badge if the Flux window is focused AND that session's
    view is open. No notification storms: per-session 10s coalescing window.
- Settings: `userData/settings.json` (new tiny settings module `src/main/settings.js`,
  read/write-through cache, schema-versioned). Per event type: `toast | badge | off`.
  Renderer settings UI: small section in the existing ControlBar/topbar popover —
  keep minimal (four rows of three-way choice + sound checkbox).

### IPC additions

- `notify:settings:get` / `notify:settings:set`
- `live:autoattached` (main → renderer push, same channel family as existing live events)
- `notify:open-session` (main → renderer push)

## Testing

- `attention.js` is pure logic → unit-test the state machine hard (turn open/close,
  threshold timing with injected clock, coalescing, once-per-window usage events).
- `autoattach.js`: factor activity-decision logic (`shouldAttach(file, mtime, registry)`)
  pure and test it; the fs.watch glue stays thin.
- `notify.js`: inject a fake Notification/BrowserWindow; assert suppression rules.
- No tests for Electron Notification rendering itself.

## Non-goals

- No mobile/remote push, no email. Local OS notifications only.
- No notification history view (the badge clears on focus; that's it).
- Don't rebuild live.js — extend its registry minimally.
