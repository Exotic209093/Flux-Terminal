# Milestone E — Terminal quality-of-life: tabs, split, profiles, scrollback search

**Date:** 2026-06-10
**Status:** approved direction; DEPENDS ON Milestone B (Mission Control) being merged —
it reshapes top-level layout. Implementor: read the as-landed layout in `App.jsx`
before starting and adapt.

## Goal

Make the terminal half of Flux competitive with a daily-driver terminal:
multiple shells, side-by-side panes, saved launch profiles, scrollback search.

## Scope (deliberately bounded)

1. **Tabs** — multiple independent PTY sessions in the terminal pane area. Tab bar:
   title (process/cwd-derived, renameable on double-click), close ×, + button.
   Ctrl+T new, Ctrl+W close (confirm if process running), Ctrl+Tab cycle.
2. **Split** — a tab can split once: vertical or horizontal, two panes max per tab
   (YAGNI; the data model — a tab holds 1–2 panes — should not preclude more later).
   Focus follows click; Alt+Arrow moves focus. Drag divider to resize (persist ratio).
3. **Profiles** — named launch configs `{ name, shell, args, cwd, color? }` stored in
   the settings store (use Milestone A's `settings.js` if landed, else create the
   same module per its spec). The + button long-press/dropdown lists profiles;
   default profile for plain +. Seed: "PowerShell (here)", "claude (tracked)" —
   the latter reuses the existing tracked-launch flow.
4. **Scrollback search** — `@xterm/addon-search` (official addon, allowed new dep):
   Ctrl+F overlay per pane with next/prev, case toggle, match highlight.

## Architecture

- `pty.js` / `pty:spawn` already key streams by id — verify and extend so N PTYs
  coexist; each pane owns one PTY id. Kill PTY on pane/tab close (no orphan
  conhost.exe). On app quit, kill all.
- Renderer: `TerminalPane.jsx` becomes `TerminalWorkspace.jsx` (tab bar + layout)
  containing `TerminalPane` instances (one xterm each). Only the visible tab's
  panes render/fit; background tabs keep PTYs alive and buffer output (xterm
  instances stay mounted but hidden — cheaper than serialize/restore).
- Resize: refit on tab switch, divider drag, and window resize (existing fit addon).
- State: tabs/splits/active ids in React state; layout + profiles persisted to
  settings; **do not** restore dead PTYs on app restart — restore tab *profiles*
  (fresh shells in saved cwds) v1.

## Testing

- Tab/split reducer logic (open/close/split/focus-move/next-tab) as a pure reducer →
  unit tests for every transition incl. closing the focused pane of a split.
- Profile store round-trip; title derivation.
- PTY lifecycle: spawn N, close one, assert kill called for the right id (fake pty).
- Manual smoke: `npm run smoke` still passes; app boots with restored tabs.

## Non-goals

- No detachable windows, no pane zoom, no >2 panes per tab, no session restore of
  live shell contents, no tmux-style persistence.
