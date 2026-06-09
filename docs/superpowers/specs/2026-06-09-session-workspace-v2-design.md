# Session Workspace v2 — Design

Date: 2026-06-09
Status: Approved

A cohesive upgrade to Flux Terminal's session/chat experience, in four phases:

1. **Full slash-command set** in the composer (with terminal-only marking).
2. **Chat upgrade** — start new chats in the rich UI, a topbar model switcher, and interrupt.
3. **Subagent sub-views** — see the subagents a session spins off, their status, and what they're doing.
4. **Topbar control cluster** — active model + switcher, running-agent count, remote-control toggle.

The live **terminal stays exactly as it is** — it remains the live-streaming surface. This work
enriches the *non-terminal* surfaces (the session timeline/composer and the topbar).

---

## Background: how the app works today

- **Electron + React.** Main (`src/main/*`, CommonJS) owns the PTY, session JSONL parsing
  (`parser.js`), live tailing (`live.js`), skills, slash-command listing (`commands.js`), the
  usage poller (`usage.js`), and IPC. Renderer (`src/renderer/src/*`) is React, talking over the
  `window.flux` contextBridge (`preload/index.js`).
- **Messaging a session** runs `claude --resume <id> -p` with the prompt on stdin
  (`session:send` in `index.js`), from the session's creation cwd. The reply lands in the JSONL
  and the file-watcher streams it back into `SessionView`'s timeline.
- **Slash commands** come from `commands.js` (a small static `BUILTINS` list + custom commands
  from `~/.claude/commands` and the project's `.claude/commands`), surfaced by `SlashMenu` in the
  composer.
- **Topbar** (`App.jsx`) holds the view tabs and the `UsageBar` (5h/weekly gauges).
- **Vite build gotcha:** every `src/main/*.js` module must be registered as a rollup input in
  `electron.vite.config.mjs`, or the app builds clean but crashes at boot with
  "Cannot find module './x'".

### Verified facts this design relies on

- **Subagents are recorded.** Each session folder has a `subagents/` subdirectory containing
  `agent-<agentId>.jsonl` files (sidechain transcripts). Each carries `agentId`, parent
  `sessionId`, `isSidechain: true`, `entrypoint` (`"sdk-cli"` for Task-spawned), `cwd`,
  `gitBranch`, `timestamp`, and standard message lines. The **first user message is the spawn
  prompt** — usable as a label. Status is derivable from file mtime (fresh = running on a live
  session) and the last entry.
- **`claude -p` print mode** runs interactive built-ins as no-ops (`/clear`, `/agents`,
  `/config`, `/login`, `/model`, …) but expands **custom commands** and a few built-ins
  (`/compact`) normally. New chats work via `claude -p --session-id <uuid>`, after which the
  file is a normal resumable session.
- `claude` accepts `--model <id>` alongside `-p` / `--resume`.

---

## Phase 1 — Full slash-command set

### `src/main/commands.js`

- Replace the small `BUILTINS` array with the **full curated Claude Code built-in set**
  (~30+ commands). Each entry gains an `interactive` flag: `true` = only meaningful in an
  interactive session (no-op via `claude -p`), `false` = works via `-p`.
- Shape per command: `{ name, description, source: 'builtin'|'user'|'project', interactive }`.
  Custom commands (user/project) are always `interactive: false` (they expand as prompts).
- The concrete list is enumerated in the implementation plan; examples:
  - `interactive: false` (sendable in chat): `/compact`, custom commands, `/cost`-style readouts
    that still print.
  - `interactive: true` (terminal-only): `/clear`, `/agents`, `/config`, `/login`, `/logout`,
    `/mcp`, `/permissions`, `/hooks`, `/vim`, `/model` (superseded by the switcher),
    `/remote-control` (superseded by the toggle button), `/terminal-setup`, etc.

### `src/renderer/src/components/SlashMenu.jsx`

- Render a subtle **"terminal"** badge + tooltip on `interactive: true` items.
- Selecting an interactive-only command does **not** send; it shows a one-line hint
  ("Run this in the Terminal tab"). For `/model` the hint points to the topbar switcher.
- `interactive: false` commands complete + send exactly as today.

---

## Phase 2 — Chat upgrade (new chat + model switcher + interrupt)

### New chat

- A **"+ New chat"** action in the sidebar opens a blank `SessionView` (no `detail` yet) with a
  composer and a header showing the working folder.
- **Working folder:** defaults to the user's home directory, with a **folder-picker button**
  in the new-chat header (Electron `dialog.showOpenDialog`, directories only). The chosen cwd is
  used for the spawn.
- **First send:** new IPC `session:new({ message, cwd, model })` — main generates a uuid, spawns
  `claude -p --session-id <uuid> --model <model>` from `cwd`, writes the prompt to stdin. On
  success the new `agent`/session JSONL exists; the renderer opens + watches it as a normal
  session (same path as `openSession`), and the ai-title fills in once generated.
- Subsequent sends in that chat use the existing `session:send` (now model-aware).

### Model switcher

- `src/renderer/src/lib/models.js` — the selectable model list (id + label), reusing
  `pricing.js`/`format.js` knowledge (Fable 5, Opus 4.8/4.7/4.6, Sonnet 4.6, Haiku 4.5).
- `src/renderer/src/components/ModelPicker.jsx` — a topbar dropdown. Selection persisted in
  `localStorage` (mirroring the theme pattern), default = a sensible current model.
- `session:new` and `session:send` both accept a `model` and pass `--model <id>` to `claude`.

### Interrupt

- While a chat turn is running, the composer's **Send** button becomes **Stop**.
- New IPC `session:interrupt` kills the tracked child (`sendChild.kill()`), and emits a
  `session:sendstatus` of `interrupted`; the UI marks the turn interrupted (distinct from error).
- No-op if no child is running.

---

## Phase 3 — Subagent sub-views

### `src/main/subagents.js`

- `listSubagents(sessionFilePath)` — locate the session's `subagents/` dir, parse each
  `agent-*.jsonl` with the shared `parseSessionFile` (timeline optional), and return:
  ```
  [{
    agentId, label,                 // label = first line of the spawn prompt, truncated
    status: 'running'|'done'|'error',
    counts, usage, firstTs, lastTs
  }]
  ```
- `readSubagent(sessionFilePath, agentId)` — full parse incl. timeline for drill-in.
- **Status:** `running` if the session is live-tracked *and* the agent file mtime is fresh
  (< ~10s); `error` if the last entry indicates failure; else `done`. Historical sessions →
  `done` (never `running`).
- Register in `electron.vite.config.mjs`.

### IPC + live updates

- `subagents:list` (invoke, by session file) and `subagent:read` (invoke, file + agentId).
- The live tracker (`live.js`) additionally watches the live session's `subagents/` dir and
  includes a `subagents: { running, total }` summary in its `live:update` snapshot. Base64 /
  large fields are not shipped in the summary (counts + labels + status only).

### UI — `src/renderer/src/components/SubagentPanel.jsx`

- A collapsible **"Subagents (N)"** section in `SessionView` (below the header), listing each
  subagent with status dot (running ● / done ✓ / error ⚠) and label.
- Clicking a subagent drills into its timeline, reusing `TimelineItem` rendering (inline expand
  or a side panel). Works for live and past sessions.

---

## Phase 4 — Topbar control cluster + remote toggle

`src/renderer/src/components/ControlBar.jsx`, placed in the topbar beside `UsageBar`:

```
[ ◆ Opus 4.8 ▾ ]   [ ▶ 2 agents ]   [ ⊙ Remote ]   [ 5h ▓░ 47% · Week ▓░ 35% ⟳ ]
   ModelPicker         agents badge     remote toggle        existing UsageBar
```

- **Agents badge:** running-subagent count from the live `live:update` summary; click → switch to
  the live-tracked session's view and scroll to its Subagent panel. Hidden when zero.
- **Remote toggle:** writes `/remote-control\r` to the live terminal PTY (`window.flux.pty.write`),
  flips a local optimistic on/off pill, and is **disabled** when no live `claude` is running
  (tracked via the existing live/PTY state). Tooltip states it just fires the command and can't
  read true state.
- The **ModelPicker** from Phase 2 lives here as the leftmost element.

---

## File structure

**New**
- `src/main/subagents.js` — subagent discovery/parsing.
- `src/renderer/src/lib/models.js` — selectable model list.
- `src/renderer/src/components/ModelPicker.jsx`
- `src/renderer/src/components/SubagentPanel.jsx`
- `src/renderer/src/components/ControlBar.jsx`

**Changed**
- `src/main/commands.js` — full list + `interactive` flags.
- `src/main/index.js` — `session:new`, `session:interrupt`, `subagents:list`, `subagent:read`;
  model passthrough on sends; folder-picker dialog handler.
- `src/preload/index.js` — bridge the new IPC.
- `src/main/live.js` — watch the live session's `subagents/` dir; add the summary to snapshots.
- `src/renderer/src/components/SessionView.jsx` — new-chat mode, interrupt button, SubagentPanel.
- `src/renderer/src/components/SlashMenu.jsx` — terminal badges + non-send hint.
- `src/renderer/src/App.jsx` — "+ New chat" entry, ControlBar in topbar, model state.
- `electron.vite.config.mjs` — register `subagents.js`.

Keep new renderer units small and focused; `SessionView.jsx` already carries a lot, so the
subagent UI and control bar are separate components rather than inline additions.

---

## Error handling

- New chat with a non-existent cwd → reuse the existing cwd-exists check, surface a clear error.
- `subagents/` dir missing → empty list, no crash.
- `session:interrupt` with no running child → no-op.
- Remote toggle when no live `claude` → button disabled.
- Model selection persisted in `localStorage`; unknown/empty → fall back to the default model.
- Subagent file mid-write (truncated last line) → tolerated by the existing defensive parser.

---

## Testing

- **Unit (`node --test`):**
  - `commands.js`: full list present; each entry has a boolean `interactive`; custom commands are
    `interactive: false`; precedence (project > user > builtin) preserved.
  - `subagents.js`: over a fixture `subagents/` dir — labels derived from the spawn prompt,
    status (running via fresh-mtime+live flag, done, error), counts/usage aggregated, missing dir
    → `[]`.
  - `models.js`: list shape (id + label) and default resolution.
- **UI:** `npm run build` + `FLUX_SMOKE_SHOT` screenshots (slash badges, new-chat composer,
  subagent panel, control bar) + manual checks: start a new chat, interrupt a turn, open a
  session with subagents and drill in, switch model + send, toggle remote control with a live
  `claude` running.

## Phasing

One spec; the implementation plan splits into the four phases above, each shipping working,
testable software:

1. Full slash commands (+ badges) — self-contained.
2. Chat upgrade — model switcher (topbar dropdown, persisted, wired to sends), new chat, interrupt.
3. Subagent discovery (main + IPC + live summary) + subagent views (UI) + running-agents badge data.
4. Control cluster UI — ModelPicker placement, agents badge, remote-control toggle.

## Out of scope (v2)

- True live token-streaming chat in the UI (the terminal remains the streaming surface).
- Reading real remote-control on/off state (optimistic local indicator only).
- Changing the model of an already-running interactive terminal session.
- Editing/creating slash commands from the UI.
