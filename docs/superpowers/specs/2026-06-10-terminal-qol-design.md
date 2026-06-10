# Milestone E — Terminal quality-of-life: tabs, split, profiles, scrollback search

**Date:** 2026-06-10
**Status:** implemented 2026-06-10 (see `docs/superpowers/plans/2026-06-10-terminal-qol.md`). Tabs, two-pane split, profiles + restore, and per-pane scrollback search shipped; PTY bridge reworked to an id-keyed PtyManager.

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

## Implementation decisions (as-landed, 2026-06-10)

Confirmed with James after reading the shipped code:

1. **PTY bridge must be reworked (mandatory).** The spec assumed `pty:spawn` keyed
   streams by id — it does NOT. Today `index.js` holds one `ptyProc`; `pty:spawn` kills
   the previous one and `pty:data`/`pty:exit` carry no id. Introduce a testable
   `ptyManager` (main) holding `Map<id, pty>` with `spawn({id,cwd,shell,cols,rows})`,
   `write(id,data)`, `resize(id,size)`, `kill(id)`, `killAll()`. IPC + preload become
   id-addressed (`pty:data`/`pty:exit` carry `{id,…}`; renderer filters by its pane id).
   `pty:kill` added. App-quit kills all.
2. **Tracked-claude live bar stays docked above the tabs** (James's choice). The
   `LivePanel` remains at the top of the new `TerminalWorkspace`; "Launch tracked claude"
   becomes the seeded **"claude (tracked)"** profile that opens a tab, writes
   `claude --session-id <uuid>` to that tab's PTY, and starts the existing single
   `LiveTracker`. One tracked session at a time (unchanged).
3. **Restore tabs on launch** (James's choice) as FRESH shells in saved cwds (no
   scrollback restore); no saved layout → one default "PowerShell (here)" tab. Layout
   persisted debounced on change.
4. **Extend `settings.js`** (vs a new store) to also hold `profiles[]` and the persisted
   `workspace` layout, under the same versioned schema with their own getters/setters.
5. **Tab/pane state is a pure reducer** in `src/renderer/src/lib/workspace.js`:
   `{ tabs:[{id,title,panes:[{id,ptyId,profileId}],splitDir,ratio,activePaneId}], activeTabId }`.
   Unit-tested for every transition (new/close tab, split, close pane incl. the focused
   pane of a split, focus-move, next-tab cycle, setRatio, rename).
6. **Components:** `TerminalPane.jsx` refactored to `{ptyId,profile,active,theme}` (owns one
   PTY + its scrollback search); new `TerminalWorkspace.jsx` owns the reducer, renders
   docked LivePanel → tab bar (title, ×, dbl-click rename, + with profile dropdown) →
   active tab's pane layout (split = flex row/col + draggable divider, ratio persisted);
   background tabs stay mounted-but-hidden so PTYs keep running.
7. **Build order (shippable checkpoints):** ① ptyManager rework (single tab still works)
   → ② tabs + TerminalWorkspace shell *(tabs shippable)* → ③ split panes → ④ profiles +
   restore → ⑤ scrollback search (`@xterm/addon-search`).
