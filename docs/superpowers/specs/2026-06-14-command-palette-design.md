# Command Palette + Prompt History — design

**Date:** 2026-06-14
**Sub-project:** #7 of the power-user program.
**Goal:** One Ctrl+K fuzzy palette over sessions, app actions, and saved prompts — fast keyboard-first navigation and prompt re-launch.
**Status:** approved (autonomous run).

## Decisions

- **Custom fuzzy matcher**, no dep (`lib/fuzzy.js`): subsequence match with a score favoring contiguous + word-start hits. Plenty for a few hundred sessions + actions.
- **Three providers:** Sessions (jump/open), Actions (Terminal/Stats/Skills/Mission/Settings views, New chat, Launch tracked claude, open Search), Saved prompts (start a new chat prefilled with the prompt body).
- **Full prompt-history search is already Ctrl+Shift+F** (FTS over all text incl. past prompts). The palette's "prompt" entries are the saved prompt library (the `;;` set), so "prompt history" is covered by FTS (history) + palette (saved) without duplicating the FTS scan in the palette.

## Components

### Pure — `src/renderer/src/lib/fuzzy.js`
- `fuzzyScore(query, text)` → number (0 = no match; higher = better; exact/prefix/word-start boosted). Case-insensitive subsequence.
- `fuzzyFilter(query, items, keyFn)` → items with score > 0, sorted by score desc (stable). Empty query → items unchanged.

### Pure — `src/renderer/src/lib/palette.js`
- `STATIC_ACTIONS` — `[{ kind:'action', label, action }]` (e.g. `view:terminal`, `view:stats`, `view:skills`, `view:mission`, `view:settings`, `new-chat`, `launch-tracked`, `open-search`).
- `buildCommands({ sessions, prompts })` → flat list: actions, then `{ kind:'session', label:title, sub:project, sessionId }` per session, then `{ kind:'prompt', label:name, sub:bodyPreview, body }` per saved prompt.
- `filterCommands(query, commands)` → `fuzzyFilter` over each command's `label` (+ `sub`), capped to ~30. Unit-tested.

### CommandPalette overlay — `src/renderer/src/components/CommandPalette.jsx`
Keyboard-first modal (like SearchOverlay): an input, a filtered list, ↑/↓ to move, Enter to run the selected item, Esc to close. Each row shows a kind glyph + label + sub. Calls `onRun(item)` and closes.

### Wiring — `src/renderer/src/App.jsx`
- `const [paletteOpen, setPaletteOpen] = useState(false)`; in the global keydown effect add `Ctrl+K` → `setPaletteOpen(o => !o)` (and ensure Ctrl+K isn't swallowed elsewhere).
- Load saved prompts once (`window.flux.prompts.list()`), keep in state.
- `runCommand(item)`:
  - `action` → `view:*` `setView(...)`; `new-chat` `startNewChat()`; `open-search` `setSearchOpen(true)`; `launch-tracked` `setView('terminal')` (the tracked-launch lives in the terminal workspace; for v1 just switch there).
  - `session` → `openById(item.sessionId)`.
  - `prompt` → `startNewChat('', item.body)` (prefill).
  - Always `setPaletteOpen(false)`.
- Render `{paletteOpen && <CommandPalette commands={...} onRun={runCommand} onClose={() => setPaletteOpen(false)} />}`.

### New-chat prefill — `src/renderer/src/components/SessionView.jsx` + `App.jsx`
- `startNewChat(cwd, initialDraft)` → `setNewChat({ cwd: dir, draft: typeof initialDraft === 'string' ? initialDraft : '' })`.
- `SessionView`: when `newChat.draft` is set, seed the composer `draft` once (guarded by a ref so edits aren't clobbered).

## Verification

- Unit: `fuzzy` (no-match/subsequence/prefix-boost/empty-query); `palette` (`buildCommands` shape + counts, `filterCommands` ordering + cap).
- Build: `npm run build`.
- Manual: Ctrl+K opens; typing filters; Enter on a session opens it, on an action runs it, on a prompt starts a prefilled new chat; Esc closes.

## Files

- New: `src/renderer/src/lib/fuzzy.js`, `src/renderer/src/lib/palette.js`, `src/renderer/src/components/CommandPalette.jsx`, `tests/fuzzy.test.js`, `tests/palette.test.js`.
- Edited: `src/renderer/src/App.jsx` (Ctrl+K, providers, runCommand, startNewChat arg), `src/renderer/src/components/SessionView.jsx` (draft prefill), `src/renderer/src/index.css` (palette styles).
