# Milestone C — Cross-session search

**Date:** 2026-06-10
**Status:** approved direction; independent of other milestones.

## Goal

Search across all parsed session transcripts ("where did Claude fix that ConPTY
bug?") and jump straight to the matching message in the session timeline. Past
sessions become a knowledge base.

## Approach: streaming search + extracted-text cache (no new deps)

Scale is ~70 sessions / ~21k messages — brute force is fine if we don't re-parse
JSONL every keystroke.

- Main process module `src/main/search.js`:
  - Per session file, maintain a cached plain-text extraction:
    `userData/search-cache/<sessionId>.json` → array of
    `{ idx, role, ts, text }` (text = message text + tool names; strip base64,
    cap each entry ~2KB). Cache entry keyed by source file `mtimeMs + size`;
    rebuild lazily on mismatch. Reuse `parser.js` for extraction.
  - `search(query, opts)`: case-insensitive substring + simple AND of
    whitespace-split terms. Streams session caches newest-first, returns top N=200
    hits: `{ sessionId, project, title, msgIdx, role, ts, snippet }` (snippet =
    match line ±80 chars, match range marked for highlight).
  - First-ever search builds caches for all sessions (~seconds); show progress.
- IPC: `search:query` (handle), `search:progress` (push during initial cache build).

## UX

- **Ctrl+Shift+F** anywhere → search overlay (modal panel, theme-styled): input,
  debounced 250ms live results.
- Result rows: project · session title · time · role icon · snippet with highlighted
  match. Grouped by session, newest sessions first.
- Enter/click → open that session in SessionView scrolled to that message, briefly
  flash-highlight it. SessionView gains a `scrollToIdx` prop/anchor (timeline items
  already have stable indices from the parser).
- Esc closes. Filters can wait (non-goal).

## Testing

- Extraction: parser output → cache entries (strips base64, caps size, stable idx).
- Cache validity: mtime/size mismatch rebuilds, match reuses (inject fs facade).
- Search semantics: multi-term AND, case-insensitivity, snippet windowing + match
  offsets, result cap, newest-first ordering.
- No renderer e2e; keep SessionView scroll change minimal.

## Non-goals

- No fuzzy/semantic search, no SQLite/lunr dependency, no regex UI, no filters
  (role/project/date) in v1 — design the hit DTO so filters can be added later.
