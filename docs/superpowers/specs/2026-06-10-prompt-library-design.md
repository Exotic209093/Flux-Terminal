# Milestone D — Prompt library

**Date:** 2026-06-10
**Status:** approved direction; independent of other milestones.

## Goal

Saved prompt templates with variables, inserted into the session composer in a
couple of keystrokes. Cheap, daily ergonomics.

## Data

- Store: `userData/prompts.json` — `{ version: 1, prompts: [{ id, name, body,
  createdAt, updatedAt, uses }] }`. New main module `src/main/prompts.js` with CRUD +
  atomic write (tmp + rename). `uses` increments on insert (sort by most-used).
- Template variables: `{{name}}` placeholders in the body. `{{cursor}}` is special:
  marks where the caret lands after insert (at most one; defaults to end).

## UX

- Composer trigger: typing `;;` at the start of a word in the composer opens the
  prompt picker (same interaction pattern as the existing SlashMenu — reuse its
  filtering/keyboard-nav approach; do not fork its code, extract shared bits if
  trivial, otherwise a sibling component `PromptMenu.jsx` is fine).
- Picker rows: name + first line of body. Enter inserts.
- If the template has `{{variables}}`: inline fill — the template is inserted with
  the first variable's placeholder selected; Tab jumps to the next placeholder
  (lightweight: track placeholder ranges in component state; no contenteditable
  rewrite — the composer is a textarea, so implement via value+selection updates).
- Management: "Prompts" section added to the existing SkillsView tab (it already
  lists local/plugin/starter skills — add a prompts panel: list, add, edit in a
  modal with name + body textarea, delete with confirm). No new top-level tab.
- Seed with 3 starter templates on first run (e.g. "explain this error: {{error}}",
  "write tests for {{target}}", "review this diff for {{focus}}").

## IPC

- `prompts:list`, `prompts:save` (create/update), `prompts:delete`, `prompts:used`.

## Testing

- prompts.js CRUD round-trip in a temp dir; atomic write (no partial file on
  simulated crash mid-write — write tmp then rename); corrupt file → fresh store
  with backup of the corrupt original.
- Template engine: placeholder parsing ({{var}} extraction, {{cursor}} handling,
  escaping literal {{), insertion + selection-range math as pure functions.

## Non-goals

- No sharing/sync, no folders/tags, no per-project prompts in v1 (schema leaves
  room: a future `scope` field). No rich text.
