# Files-Touched Tab + Diff Lens — design

**Date:** 2026-06-14
**Sub-project:** #5 of the power-user program (`2026-06-13-power-user-program.md`).
**Goal:** Turn the `structuredPatch` goldmine (#3) into real inline Edit/Write diffs and a per-session files-touched view, replacing the 600-char JSON; plus parent→subagent drill-in.
**Status:** design approved 2026-06-14 (custom diff renderer, Timeline/Files toggle, gh action deferred).

## Data (already present from #3)

`tool_result` timeline items carry `item.result = { structuredPatch?, filePath?, stdout?, stderr? }` (capped). `structuredPatch` is an array of hunks `{ oldStart, oldLines, newStart, newLines, lines: ['-removed','+added',' context'] }`, or `{ truncated: true }` when oversized. `tool_use` items carry `id`. `listSubagents` returns `toolUseId`.

## Decisions

- **Custom diff renderer**, no new dep. diff2html wants a unified-diff *string*; we already have structured hunks. (`{truncated:true}` → "diff too large to show".)
- **Timeline/Files toggle** in the session header (swaps the main pane) rather than a cramped panel — better for sessions with many edits.
- **Defer the optional `gh` commit/PR action** — needs main-process `gh` execution + its own UI, not core to the diff lens. Revisit later.

## Components

### Diff renderer — `src/renderer/src/components/Diff.jsx`
Renders a `structuredPatch`: for each hunk, a header (`@@ -oldStart +newStart @@`) and its `lines`, classed by prefix (`+` add / `-` del / ` ` context). `{truncated:true}` → a "diff too large" notice. Pure presentational.

### Pure helpers — `src/renderer/src/lib/filesTouched.js`
- `diffStats(patch)` → `{ adds, dels }` (counts `+`/`-` lines across hunks; `{adds:0,dels:0}` for truncated/empty).
- `collectFilesTouched(timeline)` → `[{ filePath, edits: [{ ts, patch, stats }], adds, dels }]`, grouping `tool_result` items that have `result.filePath`, newest-last, with per-file totals. Unit-tested.

### Inline diffs — `TimelineItem.jsx` (tool_result branch)
When `item.result?.structuredPatch` → render a collapsible `filePath` header + `<Diff patch={item.result.structuredPatch} />` (collapsed by default for large diffs). Else keep the existing `<pre>` text. `result.stdout` already shows via the existing text.

### Files-touched view — `src/renderer/src/components/FilesTouched.jsx`
Given `timeline`, calls `collectFilesTouched`; renders a list of files (path + `+adds/-dels` summary), each expandable to its diffs via `<Diff>`. Empty state: "No file edits in this session."

### Session header toggle — `SessionView.jsx`
A segmented control: **Timeline** | **Files (N)** (N = `collectFilesTouched(...).length`). State `mainView` (`'timeline'|'files'`). `'timeline'` renders the Virtuoso; `'files'` renders `<FilesTouched timeline={detail.timeline} />`.

### Parent→subagent drill-in
- `SubagentPanel`: add optional controlled props `openId` + `onOpenId` and an `onList(subagents)` callback (reports its loaded list up without a second fetch). Falls back to internal state when uncontrolled.
- `SessionView`: own `subOpenId` + `subList` state; pass `openId/onOpenId/onList` to `SubagentPanel`. Build `subByToolUseId` (map from `toolUseId` → `agentId`). Pass `subByToolUseId` + `onOpenSubagent` to the timeline `itemContent`.
- `TimelineItem`: for a `tool_use` with `item.id` present in the map, render a "↘ open subagent" button → `onOpenSubagent(agentId)` (sets `subOpenId`, opening that subagent in the panel above).

## Verification

- Unit: `diffStats` and `collectFilesTouched` (fixtures with structuredPatch hunks, truncated patches, multiple files, no-file sessions).
- Build: `npm run build` succeeds.
- Smoke/manual: open a session with edits → tool_result shows colored diffs; the Files toggle lists files with diffs; a Task tool_use shows "open subagent" and opens it.

## Out of scope

`gh` commit/PR (deferred). Cinema replay (#13). Hooks panel / context gauge / constellation (#13 — data is ready from #3).

## Files

- New: `src/renderer/src/components/Diff.jsx`, `src/renderer/src/components/FilesTouched.jsx`, `src/renderer/src/lib/filesTouched.js`, `tests/filesTouched.test.js`.
- Edited: `src/renderer/src/components/TimelineItem.jsx` (inline diff + subagent button), `src/renderer/src/components/SubagentPanel.jsx` (controlled openId + onList), `src/renderer/src/components/SessionView.jsx` (toggle, subagent state + map, pass-throughs), `src/renderer/src/index.css` (diff + files-touched styles).
