# FTS search — design

**Date:** 2026-06-11
**Status:** designed (follows the session-index substrate; see specs/2026-06-11-session-index-substrate-design.md)

## Goal

Replace the synchronous full-corpus scan behind `search:query` (which freezes live PTYs and silently misses anything beyond its caps' first occurrence ordering) with a persistent SQLite FTS5 index that is built incrementally off the SessionIndex substrate, answers in milliseconds, supports query operators (`role:`, `tool:`, `file:`, `project:`, `error:`), and arrives with the SearchOverlay keyboard UX the audit called for (arrow/Enter navigation, dialog-level Esc, restored last results) plus the scroll-target race fix in SessionView.

## Verified foundations

- `node:sqlite` (DatabaseSync) with FTS5 works in Electron 42's bundled Node v24.15.0, unflagged (ELECTRON_RUN_AS_NODE probe, 2026-06-11). Zero native modules — required, because `npmRebuild: false` + the space in "Flux Terminal" make node-gyp a packaging hazard.
- The substrate (shipped) provides: `tailer.js` (incremental JSONL deltas with reset detection), `SessionIndex` (one watcher + sweep that already knows when any session file changes), and the `search:progress` IPC channel + overlay progress UI (exists today for the legacy cache build).
- The legacy contract to preserve: hits are `{ sessionId, project, title, msgIdx, role, ts, snippet, matchStart, matchEnd }` where `msgIdx` is the parser timeline index (`.tl-item` offset — the scroll-to-hit anchor), and `extractEntries`' per-item rules (skip images; `tool_use` → name + input preview; 2048-char text cap).

## Decisions (approaches considered)

**Where indexing runs.** Considered worker_thread/utilityProcess vs chunked main-thread. Chosen: **chunked main-thread**. Steady-state indexing is a few FTS inserts per appended delta (sub-ms). The initial build parses each file once — chunked one file per `setImmediate` turn so PTY data keeps flowing, with progress events. Workers would add electron-vite bundling complexity for no measured need; revisit only if the build proves disruptive.

**Restart-safe incremental state.** The killer detail: per-file `offset` (bytes) and `itemCount` (timeline items emitted so far) persist in the DB's `files` table. A delta's new items get indices `itemCount..itemCount+n`, so `msgIdx` stays correct across app restarts without persisting any parser accumulator. This works because `walkContent` pushes timeline items for every record regardless of model state (the usage-dedupe guard does not gate timeline items — verified in parser.js).

**Feed.** `SessionIndex` gains an `onFileChanged(file, { deleted })` callback option (one call in `_update` after the summary refresh, one in `_evict`). The search indexer enqueues from it — no second watcher. Its own boot reconciliation (files table vs `listSessionFiles()`) catches everything missed while the app was closed.

**Fallback.** If `require('node:sqlite')` throws or the DB cannot be opened/recreated, `search:query` falls back to the legacy `search.js` scan (kept, untouched). The legacy `userData/search-cache` directory is left alone this milestone.

**Operators.** Parsed by a pure `parseQuery(q)` in the new module: `role:user|text|thinking|tool_use|tool_result`, `tool:<name>`, `file:<substr>`, `project:<substr>`, `error:true` — mapped to SQL WHERE on the records table; remaining words become the FTS MATCH (each term quoted + `*` prefix-matched, AND semantics). Operator-only queries (no terms) run as plain filtered SELECTs.

## Architecture

### `src/main/searchindex.js` (new)

Schema (one DB at `userData/search-index.db`, WAL):

```sql
CREATE TABLE IF NOT EXISTS files (
  file TEXT PRIMARY KEY, mtimeMs REAL, size INTEGER,
  offset INTEGER, itemCount INTEGER,
  sessionId TEXT, project TEXT, title TEXT
);
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT, sessionId TEXT, msgIdx INTEGER,
  ts TEXT, role TEXT, tool TEXT, isError INTEGER, text TEXT
);
CREATE INDEX IF NOT EXISTS records_file ON records(file);
CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(text, content='records', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN
  INSERT INTO records_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN
  INSERT INTO records_fts(records_fts, rowid, text) VALUES('delete', old.id, old.text);
END;
```

`SearchIndex` class (DI: `openDb` factory, `listFiles`, `makeTail`, `enqueueTick` (defaults to `setImmediate`), `onProgress`):

- **Boot:** open/create DB (open failure → delete the file, recreate; second failure → `available = false`). Reconcile: `listSessionFiles()` vs the files table — new/changed (mtime+size mismatch) files enqueue; rows for files no longer on disk are purged. Queue drains one file per `enqueueTick` turn; `onProgress({ done, total })` fires during a build of more than ~3 files (feeds the existing overlay progress line).
- **Per-file update:** keep a tail per queued file (transient — created from the persisted `offset`, via a `createTail`-style reader that accepts a starting offset; tailer.js gains an optional `{ startOffset }`). Read the delta; on `reset`, `DELETE FROM records WHERE file=?`, zero offset/itemCount, re-read. Apply delta objects through a throwaway `freshModel` + timeline array; map new items to entries with `entriesFromItems(items, startIdx)` (same rules as legacy `extractEntries`, exported + unit-tested); insert rows in one transaction; update the files row (offset, itemCount, mtimeMs, size, title/sessionId/project refreshed).
- **Live:** `enqueue(file)` from SessionIndex's `onFileChanged`; deletions purge rows.
- **Query:** `query(q, { limit = 200 })` — `parseQuery`, build SQL:
  - terms → `records_fts MATCH ?` with `"t1"* "t2"*`, joined `records r ON r.id = records_fts.rowid`, snippet via `snippet(records_fts, 0, '', '', '…', 40)` (the marker arguments are control characters \x01/\x02, which cannot appear in transcript text); the first marker pair's positions become `matchStart/matchEnd` and all markers are stripped from the snippet — the renderer's highlight code is unchanged.
  - filters → WHERE on `r.role`, `r.tool` (NOCASE), `r.file LIKE`, `f.project LIKE`, `r.isError`.
  - join `files f` for `project`, `title`, ordering `ORDER BY f.mtimeMs DESC, r.msgIdx ASC LIMIT ?`.
  - Returns the legacy hit DTO exactly.

### `src/main/tailer.js` (small extension)

`createTail(file, { fsImpl, startOffset })` — third option seeds the starting offset (search index resumes mid-file across restarts). Default 0; existing callers unchanged.

### `src/main/sessionindex.js` (small extension)

`opts.onFileChanged(file, { deleted })` — invoked at the end of `_update` and inside `_evict`. Tested.

### Main wiring (`src/main/index.js`)

- whenReady: construct `searchIndex` (after `sessionIndex`), pass `onProgress` → `emit('search:progress', p)`; wire `sessionIndex` `onFileChanged` → `searchIndex.enqueue/remove`. Start reconciliation.
- `search:query` handler: `searchIndex && searchIndex.available ? { ok: true, hits: searchIndex.query(query) } : legacy scan` (current code path kept as the fallback).
- `window-all-closed`: `searchIndex.dispose()` (close DB).

### Renderer

- **SearchOverlay**: flattened-hit keyboard selection (ArrowUp/Down move across groups, Enter opens selected, first hit auto-selected on results); Esc handled at the modal level (works when focus is on a result); module-level `lastQuery/lastHits` so reopening the overlay restores the previous results ("back to results" after jumping); a one-line operator hint under the input (`role: tool: file: project: error:true`); selected hit scrolls into view. The grouped rendering, snippet highlighting, and `onOpen(sessionId, file, msgIdx)` contract stay.
- **SessionView scroll race fix**: the scroll-to-target effect currently has deps `[scrollTarget]` only, so a jump into a not-yet-loaded session silently never scrolls (ref is null during the loading early-return, and the effect never re-runs). Fix: include `detail` in the effect's trigger and track the last *consumed* `scrollTarget.key` in a ref — the effect runs again when detail loads, scrolls once, and live appends don't re-trigger it.

## Error handling

- DB corruption at open → delete + recreate (one log line); recreate failure → `available = false`, legacy fallback serves queries.
- A file that throws mid-index is skipped (row purged, re-enqueued by the next reconciliation) — never kills the queue.
- Query syntax that FTS rejects (unbalanced quotes after our escaping — shouldn't happen, but) → caught, returns `{ ok: true, hits: [] }`.

## Performance expectations

- Initial build: one full parse of the corpus (~1.4s measured for 308MB) plus batched FTS inserts (~60-100k items, transactional per file) — seconds total, spread across `setImmediate` turns with progress shown; the app stays responsive.
- Steady state: per session delta, a handful of inserts inside a transaction — sub-ms; queries over the indexed corpus — milliseconds.
- Disk: index expected at 50-150MB for the current corpus (text-only, images never indexed).

## Testing

- `parseQuery` + `entriesFromItems` + snippet-marker mapping: pure, exhaustive unit tests.
- `SearchIndex` with DI (in-memory DB via `openDb: () => new DatabaseSync(':memory:')`, scripted listFiles/tails, manual tick draining): boot reconcile indexes new files; restart-safe resume (persisted offset/itemCount, new items get correct msgIdx); reset purges + re-indexes; deletion purges; operator queries return the legacy DTO with correct matchStart/End; corruption recovery (openDb throws once).
  - NOTE: tests run under plain Node 24 where `node:sqlite` is available — no Electron needed.
- SessionIndex `onFileChanged` emission tests (extend existing suite).
- Renderer: keyboard-selection logic extracted pure (`flattenHits`, `moveSelection`) and unit-tested; overlay smoke via screenshot.
- E2E (Task-6 style): real-corpus build with timing reported; an operator query (`tool:Bash <term>`) against real data returns plausible hits; screenshot of the overlay with results; jump-to-hit into a cold session lands on the right item (the fixed race).

## Non-goals

- No deep-content indexing past the parser's timeline caps (message text 6000, tool results 600 — same fidelity as today's search; raising caps is a parser-policy decision for later).
- No semantic/embedding search, no date-range operators, no worker threads (chunked main-thread is measured-fine; revisit with evidence).
- No legacy search-cache deletion/migration (the fallback still uses it).
