# Session Archaeology (core) — design

**Date:** 2026-06-14
**Sub-project:** #13 of the power-user program (the XL Archaeology tier, **core slice**).
**Goal:** Surface the archaeology data that's already parsed (#3) and add session export — hooks observability, a context-pressure gauge, and Markdown export — without the heavy visualisation work.
**Status:** approved (autonomous run). The heavier moat features are split into a documented backlog (see end).

## Decisions

- **Hooks panel:** the parser already emits `kind:'hook'` timeline items (hookName/event/status/text from #3). Surface them as a **Hooks (N)** tab in the session header's existing Timeline/Files toggle — a list of hook executions. No new data layer.
- **Context-pressure gauge:** the session header already shows a context-window bar (`lastContextTokens`/`maxCtx`). Add the compaction count (`detail.compactions` from #3) — "compacted N×" — so a user sees how much history has been squeezed. Tiny.
- **Markdown export:** a pure `toMarkdown(detail)` serialiser + an **Export** button that saves via a main `file:saveText` IPC (`dialog.showSaveDialog` + write). Self-contained, unit-tested.

## Changes

### Markdown export
- New `src/renderer/src/lib/exportSession.js` (ESM): `toMarkdown(detail)` → a Markdown string (title, then per-item: user/assistant text, thinking as blockquote, tool_use as a code label, tool_result fenced + capped). Unit-tested.
- Main: `ipcMain.handle('file:saveText', async (_e, { defaultName, content }) => { showSaveDialog → writeFile })` in `index.js`; preload `file.saveText`.
- `SessionView`: an **Export ⭳** button in the header → `toMarkdown(detail)` → `window.flux.file.saveText({ defaultName: <title>.md, content })`.

### Hooks panel
- `SessionView`: extend the existing `mainView` toggle (`'timeline' | 'files'`) with `'hooks'`; the toggle shows **Hooks (N)** when `N = timeline.filter(i => i.kind==='hook').length > 0`. A new `HooksPanel.jsx` renders the hook items (hookName, event, status badge, stdout/text, ts).

### Context-pressure gauge
- `SessionView`: in the `sv-context` block, when `detail.compactions > 0`, append "· compacted {n}×" to the context label (a small `<span className="sv-compactions">`).

## Verification

- Unit: `toMarkdown` (covers user/assistant/thinking/tool items + empty timeline).
- Build: `npm run build`.
- Manual: open a session with hooks → the Hooks tab lists them; a compacted session shows the compaction count; Export saves a readable `.md`.

## Deferred — Archaeology backlog (own follow-up session)

These are the XL "moat" features, deliberately not in this slice (each is L-sized and benefits from focused work):
- **Cinema-mode replay + scrubber** (timeline playback controls; virtualization from #4 is the prereq, done).
- **Fork-from-here** (`claude --resume <id> --fork-session`; needs verifying the `--session-id` flag combo so the forked session id is known/openable).
- **Ask Flux** (`claude -p` over the corpus + a query UI; FTS index from the search work is the substrate).
- **Conversation constellation** (parentUuid tree graph; parser retains `parentUuid` from #3 — needs a graph renderer).
- **Export as self-contained HTML replay** (this slice does Markdown).
- **Session chapters + auto-titles** (heuristics, then optional haiku).
- **Generalised terminal-pane↔session fusion** (auto-link any claude pane to its transcript).

## Files

- New: `src/renderer/src/lib/exportSession.js`, `src/renderer/src/components/HooksPanel.jsx`, `tests/exportSession.test.js`.
- Edited: `src/main/index.js` (file:saveText), `src/preload/index.js` (file.saveText), `src/renderer/src/components/SessionView.jsx` (export button, hooks tab, compactions), `src/renderer/src/index.css`.
