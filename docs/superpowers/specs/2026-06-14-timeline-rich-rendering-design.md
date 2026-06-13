# Timeline Performance + Rich Rendering — design

**Date:** 2026-06-14
**Sub-project:** #4 of the power-user program (`2026-06-13-power-user-program.md`).
**Goal:** Make long-session timelines fast and readable — virtualized, memoized, markdown + syntax-highlighted, collapsible thinking, per-item timestamps — and a never-blocking composer that queues sends and never eats a draft.
**Status:** design approved 2026-06-14 (react-virtuoso + react-markdown/remark-gfm/rehype-highlight; keep draft in SessionView).

## Decisions

- **Virtualization: `react-virtuoso`.** Variable item heights, `followOutput` (auto-scroll), `atBottomStateChange` (↓ jump button), `scrollToIndex` (search-jump). Replaces the manual `scrollToBottom`/`onScroll`/`querySelectorAll` logic, which breaks once items aren't all in the DOM.
- **Markdown: `react-markdown` + `remark-gfm`**; **syntax: `rehype-highlight`** (highlight.js, synchronous) + a dark hljs theme. Safe under the existing CSP (no `innerHTML`).
- **Keep `draft` state in `SessionView`.** With virtualization (only ~15 items mount) + `React.memo` on `TimelineItem`, keystrokes no longer trigger a timeline re-render storm, so the audit's "move draft into Composer" refactor is unnecessary (the slash/prompt/template logic all reads `draft` — relocating it is risk without benefit).

## Components

### Rendering
- New `src/renderer/src/components/Markdown.jsx` — wraps `react-markdown` with `remark-gfm` + `rehype-highlight`; renders links via the existing window-open-deny policy (links are inert text, or open externally through a guarded handler — for v1 render as plain anchors that the CSP/`setWindowOpenHandler` already neutralize). Used for `text`/`user` item bodies.
- `TimelineItem` (in SessionView.jsx) → extracted to its own memoized component file `src/renderer/src/components/TimelineItem.jsx`, `React.memo`'d. Changes: `text`/`user` bodies render through `<Markdown>`; `thinking` renders collapsible (collapsed by default, click to expand); a per-item timestamp (`item.ts`, formatted) shown in the gutter. tool_use/tool_result/image unchanged (diff rendering is #5).

### Virtualization
- The timeline list in `SessionView` becomes a `<Virtuoso>`:
  - `data={detail.timeline}`, `itemContent={(i, item) => <TimelineItem item={item} flash={i===flashIdx} onImage={setLightbox} />}`.
  - `followOutput="smooth"` + an `atBottomStateChange` handler set `showJump`/`autoFollow` (replaces `onScroll` math).
  - A `virtuosoRef`; the search-jump effect calls `virtuosoRef.current.scrollToIndex({ index, align:'center', behavior:'smooth' })` and sets `flashIdx` (replaces `querySelectorAll('.tl-item')[idx]`).
  - The pending bubble / working / error rows render in Virtuoso's `Footer` so they stay below the list and auto-scroll.
  - `SubagentPanel`'s small list stays a plain map (subagent transcripts are short) but uses the enriched `TimelineItem`.

### Composer (never-blocking + queue)
- New pure `src/renderer/src/lib/composerQueue.js` — a reducer over `{ queue: [] }`: `enqueue(state, msg)`, `dequeue(state)` → `{ state, msg }`, `peek`. Unit-tested.
- `SessionView`: stop disabling the textarea while running; `submit()` — if `sendState==='running'`, `enqueue` the message and clear the draft; else send. A flush effect: when `sendState` transitions to a non-running terminal state (`done`/null) and the queue is non-empty, dequeue and send the next. **Draft preserved on failure:** keep the just-sent text in a ref; if `sendState` becomes `'error'` and the draft is empty, restore it.
- The Stop button still interrupts; sending while running shows queued-count feedback ("2 queued").

### Terminal shortcut scoping
- `TerminalWorkspace`: the window `keydown` handler takes an `active` prop (App passes `view==='terminal'`) and early-returns when not active, so terminal shortcuts don't fire from the session/mission/etc. views. Ctrl+W closes the tab directly (remove the blocking `window.confirm`).
- `TerminalPane`: add `term.attachCustomKeyEventHandler` returning `false` for the app-shortcut combos (Ctrl+T/W/Tab, Ctrl+Shift+E/O, Alt+Arrows) so a focused xterm doesn't also send them to the shell.

## Dependencies (added)

`react-virtuoso`, `react-markdown`, `remark-gfm`, `rehype-highlight` (+ highlight.js CSS theme). All MIT. Desktop bundle, so size is fine.

## Verification

- Unit: `composerQueue.js` reducer (enqueue/dequeue/peek/empty).
- Build: `npm run build` succeeds (new deps bundle).
- Smoke: `FLUX_SMOKE_VIEW=session` screenshots the rich, virtualized timeline; manual check of auto-scroll, ↓ jump, search-jump-to-hit, collapsible thinking, queued sends, and that terminal shortcuts no longer fire from the session view.
- No JSX test runner — UI verified via build + smoke + manual, consistent with the codebase.

## Out of scope

Diff/structuredPatch rendering and the files-touched tab (#5 — the parser data is already there from #3). Cinema replay (#13, needs this virtualization).

## Files

- New: `src/renderer/src/components/Markdown.jsx`, `src/renderer/src/components/TimelineItem.jsx`, `src/renderer/src/lib/composerQueue.js`, `tests/composerQueue.test.js`.
- Edited: `src/renderer/src/components/SessionView.jsx` (Virtuoso, composer queue, import TimelineItem/Markdown), `src/renderer/src/components/TerminalWorkspace.jsx` (active gate, Ctrl+W), `src/renderer/src/components/TerminalPane.jsx` (attachCustomKeyEventHandler), `src/renderer/src/App.jsx` (pass `active` to TerminalWorkspace), `src/renderer/src/index.css` (markdown/thinking/ts styles + hljs theme import), `package.json` (deps).
