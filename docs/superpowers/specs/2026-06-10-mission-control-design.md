# Milestone B — Mission Control (all-sessions grid)

**Date:** 2026-06-10
**Status:** approved direction; DEPENDS ON Milestone A (attention states) being merged.
Implementor: read `2026-06-10-watcher-notifications-design.md` and the **as-landed**
`src/main/attention.js` / `live.js` APIs before starting; adapt to what actually merged.

## Goal

One glance answers "which of my sessions needs me?" A grid view of all currently
active + recently active sessions across every project.

## UX

- New top-level view "Mission Control" alongside the existing Sidebar views
  (sessions / skills / stats). Entry: topbar button + keyboard shortcut (Ctrl+M).
- Card per session, grouped: **Needs you** (blocked/error) → **Running** → **Idle /
  recently finished** (last 24h). Within groups, most-recent-activity first.
- Card contents: project name + folder, session title/first-user-line, status chip
  (running / needs you / idle / finished), live cost so far, model, running-subagent
  count (reuse `countSubagents`), last assistant snippet (1–2 lines), relative time.
- Click card → open that session in SessionView (existing navigation).
- Needs-you cards get the theme's alert accent; the view consumes the same attention
  events Milestone A emits (no duplicate detection logic in the renderer).

## Architecture

- Main: `missioncontrol:list` IPC handler — composes existing pieces:
  `sessions:list` metadata + live tracker registry (running/tracked state, costs) +
  attention state per session (from A) + `countSubagents`. Returns one array of
  card DTOs; renderer does no cross-source joining.
- Push updates: reuse the live tracker tick — when any tracked session updates or an
  attention event fires, push `missioncontrol:update` (debounced ~1s) with fresh DTOs
  for changed sessions only.
- Renderer: `components/MissionControl.jsx` + small card component. No new state
  libraries — same useState/useEffect patterns as LivePanel.

## Testing

- DTO composition: pure function `composeCards(sessions, liveRegistry, attention,
  subagentCounts)` → unit tests for grouping, ordering, status precedence
  (error > blocked > running > idle > finished).
- Debounce/changed-only push logic factored pure and tested with injected clock.

## Non-goals

- No drag/drop, no kanban columns editing, no multi-window. Read-only dashboard +
  click-through.
- Don't redesign Sidebar; Mission Control is an additional view, not a replacement.
