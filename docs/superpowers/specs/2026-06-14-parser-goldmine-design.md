# JSONL Parser Goldmine Extraction — design

**Date:** 2026-06-14
**Sub-project:** #3 of the power-user program (`2026-06-13-power-user-program.md`).
**Goal:** Extend the shared per-line parser to retain the untapped JSONL record types and ids, so later features (diff lens #5, Mission Control depth #6, archaeology #13) have data. No UI.
**Status:** design approved 2026-06-14. Field shapes verified against real transcripts in `~/.claude/projects`.

## Why one landing point

`parser.js`'s per-line reducer (`applyEvent` + `walkContent`) is shared by the whole-file parse **and** the live/index tailer (`tailer.js` → `parseLine` → same `applyEvent`). Extending it once propagates to whole-file reads, the live session stream, the session index, and (via re-extraction) FTS. Plus one field surfaced in `subagents.js`.

## Verified record shapes (from real transcripts)

- **toolUseResult** (sibling of `message` on `type:'user'` records). Varies by tool: Edit/Write → `{ structuredPatch: [...hunks], filePath?, oldString?, newString? }`; Bash → `{ stdout, stderr, ... }`; Read → `{ type:'text', file:{ filePath, ... } }`; slash → `{ success, commandName }`.
- **attachment** (`type:'attachment'` record) → `o.attachment = { type:'hook_success'|'hook_failure'|..., hookName, hookEvent, toolUseID, content, stdout }`.
- **compact_boundary** → `type:'system'`, `subtype:'compact_boundary'`.
- **uuid / parentUuid** → present on every record.
- **tool_use** content block → has `id` (matches a subagent's `meta.toolUseId`).

## Changes

### `src/main/parser.js`
- New constant `MAX_RESULT = 4000` (cap for attached result/patch/stdout, mirrors `MAX_TEXT` discipline).
- `freshModel`: add top-level `hookCount: 0` and `compactions: 0`. **Do NOT add to `counts`** — keep the `counts` object shape stable so existing assertions don't break.
- **uuid/parentUuid stamping (DRY):** in `applyEvent`, capture `timeline.length` before the switch; after the switch, stamp `uuid`/`parentUuid` (from `o.uuid`/`o.parentUuid`) onto every item this record added. One place covers user/assistant/hook/compact items.
- **tool_use id:** in `walkContent`'s `tool_use` case, add `id: block.id || null` to the pushed item.
- **toolUseResult:** in `walkContent`'s `tool_result` case, read `o.toolUseResult`; attach a capped `result` object to the item with whichever of these are present: `structuredPatch` (kept whole if `JSON.stringify` ≤ `MAX_RESULT`, else `{ truncated: true }`), `filePath` (from `tur.filePath` or `tur.file?.filePath`), `stdout`/`stderr` (truncated to `MAX_RESULT`). Omit `result` entirely if none apply.
- **attachment/hook:** new `case 'attachment'` in `applyEvent` — read `o.attachment`; `model.hookCount++`; push `{ kind:'hook', ts, hookName, hookEvent, status: a.type, toolUseId: a.toolUseID, text: truncate(a.stdout || a.content, MAX_RESULT) }`.
- **compact_boundary:** in the `system` case, when `o.subtype === 'compact_boundary'` → `model.compactions++` and push `{ kind:'compact', ts }`.

### `src/main/subagents.js`
- In `listSubagents`'s pushed object, add `toolUseId: (meta && meta.toolUseId) || null` so #5 can join a parent's Task `tool_use.id` to its subagent.

## Deferred (YAGNI)

`file-history-snapshot`, `queue-operation`, `permission-mode`/`mode` records — listed in the program doc but with no downstream consumer yet. Leave them default-cased (already tolerated). Pull in when a feature needs them.

## Safety / payload

- Additive only. Existing parser tests use field-specific assertions (`.find(t => t.kind===…)`), not whole-item `deepStrictEqual`, so new item fields don't break them. `counts` shape is deliberately untouched.
- `structuredPatch`, `stdout`, `stderr`, hook `content` are all capped at `MAX_RESULT` so timeline IPC payloads stay bounded (a diff/log can be huge).
- `uuid`/`parentUuid` are short strings — fine on every item.

## Testing

New `tests/parser-goldmine.test.js` (fixtures via temp `.jsonl`, like `parser-stream.test.js`):
- tool_use item carries `id`; user/assistant items carry `uuid`/`parentUuid`.
- a `type:'user'` record with `toolUseResult.structuredPatch` → tool_result item has `result.structuredPatch` + `result.filePath`; an oversized patch → `result.structuredPatch.truncated === true`.
- a Bash `toolUseResult.stdout` → tool_result item has capped `result.stdout`.
- a `type:'attachment'` hook record → a `kind:'hook'` item with `hookName`/`status`/`toolUseId`; `hookCount === 1`.
- a `compact_boundary` system record → a `kind:'compact'` item; `compactions === 1`.
- Plus a `subagents` test: `listSubagents` surfaces `toolUseId` from a meta fixture.
- Full suite must stay green (additive; confirm no `counts`/model regressions).

## Files

- Edited: `src/main/parser.js`, `src/main/subagents.js`.
- New: `tests/parser-goldmine.test.js` (+ a `toolUseId` assertion in a subagents test).
