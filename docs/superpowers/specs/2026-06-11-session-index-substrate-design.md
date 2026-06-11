# Session-index substrate (freshness phase) — design

**Date:** 2026-06-11
**Status:** designed (follows the correctness/security week; see specs/2026-06-11-roadmap-audit.md)

## Goal

One substrate that fixes four audited problems at once: the sidebar loads once and never refreshes (sessions started mid-run never appear; search-hit and notification clicks on unknown ids silently no-op), `sessions:list` fully re-parses every transcript per call, the open-session watcher re-parses the whole file every second, and the monitor re-parses changed transcripts every 3s tick. After this milestone, steady-state work is O(appended bytes), the sidebar is live, and cold boot with a warm cache parses nothing.

This is the **freshness phase**. Full-text search (FTS5) builds on this substrate in its own milestone.

## Probes (verified on this machine, 2026-06-11)

- `node:sqlite` with FTS5 works in Electron 42's bundled Node v24.15.0 (`ELECTRON_RUN_AS_NODE` probe: create FTS5 table, insert, MATCH all succeed). The search milestone needs **no native module** — important because `npmRebuild: false` + the space in "Flux Terminal" make native rebuilds a packaging hazard. Not used in this phase.
- `fs.watch(projectsDir, { recursive: true })` on Windows fires rename+change events for new project dirs, top-level `<id>.jsonl` creates/appends, and nested `subagents/agent-*.jsonl` writes, with relative paths. Trustworthy enough as the fast path; a slow reconciliation sweep guarantees consistency anyway (below).

## Decisions (approaches considered)

**Watcher vs polling.** Considered keeping pollers (status quo), watcher-only, and watcher + reconciliation sweep. Chosen: **watcher for latency + a 15s stat-sweep for truth**. fs.watch on Windows is good but not contractual (overflow drops, edge cases on renames); the sweep (same cost as today's 3s monitor sweep, 5x less often) catches anything missed and detects deletions. Correctness never depends on fs.watch.

**Incremental parsing.** live.js already contains a correct byte-offset tail (consume to last newline, re-read partial trailing line, detect truncation). Extract it as `tailer.js` and reuse for every consumer instead of whole-file re-reads. First encounter of a file still costs one full read (offset 0); after that, O(delta).

**Summary persistence.** JSON file in userData (schema-versioned, debounced writes), not sqlite. Summaries are ~1KB × ~200 sessions; a JSON map is simpler, testable, and the search milestone can migrate it into the FTS database later. Key: `mtimeMs + size` per file (the proven search-cache pattern).

**Worker threads: deferred.** Incremental parsing removes the quadratic cost that motivated them. Remaining sync work is one full parse per *cold changed* file (rare) and first-ever boot (one-time). `search:query` still blocks — fixed in the search milestone, where the FTS index lives off-thread.

**Monitor integration.** Monitor keeps its 3s tick (attention's `blocked` detection needs periodic wall-clock observations regardless of fs events) and keeps its injectable test interface. Its *defaults* change: `listFiles` reads the index's in-memory metadata (no readdir sweep), `parseFile` reads the index's accumulator summary (no file read). Attention semantics are untouched — counts come from the same `applyEvent` accumulator a full parse would produce.

**Open-session watch.** The index owns a single "watch slot" with a full-timeline accumulator (seeded by one full parse on subscribe — the same parse `session:read` already does). Deltas emit `session:append` with just the appended timeline items + refreshed summary; truncation/rotation falls back to a full `session:refresh`. The slot is separate from the monitor's bounded-ring accumulators (the same file may be tailed by both; two small delta reads beat lifecycle coupling).

## Architecture

### `src/main/tailer.js` (new, extracted from live.js)

`createTail(file, { fsImpl })` → `{ readDelta() }`. `readDelta()` stats the file and returns `{ reset: boolean, objects: [] }`: parsed JSONL objects appended since the last offset (consuming only to the last newline; the partial trailing line is re-read next call). `reset: true` when the file shrank (truncation/rotation) — the caller rebuilds its accumulator and `readDelta` starts from 0 again. Pure logic, injectable fs, unit-tested. live.js switches to it (no behavior change; its correlation/snapshot logic stays).

### `src/main/sessionindex.js` (new)

`SessionIndex` (EventEmitter-style with injected deps: `fsImpl`, `watchFactory`, `now`, `listFiles`, `parseFile`, `cachePath`, timers):

- **State:** `summaries: Map<file, { mtimeMs, size, summary }>` (summary = the exact shape `listSessions` returns today, plus `lastRole`/`lastSnippet`); `hot: Map<file, { tail, model, ring }>` — accumulators with a bounded timeline ring (last 12 items, live.js's MAX_RECENT pattern) for files modified inside the recent window (24h); one `watchSlot: { file, tail, model, timeline }` with a full timeline.
- **Boot:** load the persisted cache (`userData/session-index.json`, `{ v: 1, entries }`; corrupt/missing → empty), run one stat sweep, parse only files whose `mtimeMs+size` differ from the cache, emit `sessions`.
- **Watch path:** recursive `fs.watch` on `projectsDir()`; events debounced per-file (300ms); only `*.jsonl` at project depth update session state (subagent file events are ignored in this phase). A changed file: ensure a hot accumulator (cold file → seed by tailing from offset 0), `readDelta()`, apply objects via the parser's `applyEvent`, trim the ring, refresh the summary (counts/usage/title/`turnDurationCount` from the model; `lastRole`/`lastSnippet` from the ring), update `mtimeMs/size`, schedule a debounced `sessions` emit (500ms) and a debounced cache save (2s). Watcher constructor failure → sweep-only mode (logged).
- **Reconciliation sweep (15s):** `listSessionFiles()` stat sweep; new/changed files enqueue the same update path; missing files are evicted from all maps and emit `sessions`. Also evicts hot accumulators idle past the recent window (summary retained).
- **Watch slot:** `subscribe(file)` seeds a full-timeline accumulator (one full parse) and returns the parsed session (so `session:read` reuses it); deltas emit `delta` events `{ file, session, items }`; `reset` re-seeds and emits a `refresh` event with the full session. `unsubscribe()` drops the slot.
- **Public reads:** `list(limit)` (sorted summaries — serves `sessions:list`), `recent(windowMs)` (metadata for monitor), `summary(file)` (monitor's parse replacement).

### Wiring (`src/main/index.js`, preload, monitor)

- whenReady constructs the index; `sessions:list` returns `index.list(limit)`; the 1s `session:watch` mtime-poll block is deleted — `session:watch`/`session:unwatch` call `index.subscribe/unsubscribe` (path guard stays), and index `refresh`/`delta` events forward as `session:refresh` (existing channel, full session) and `session:append` (new channel `{ session, items }`).
- New push channel `sessions:changed` carries `index.list()` on every debounced `sessions` event. Preload adds `sessions.onChanged(cb)` and `sessions.onAppend(cb)`.
- `SessionMonitor` defaults change to `listFiles: () => index.recent(...)` shaped like today's `listSessionFiles()` output and `parseFile: (f) => index.summary(f)`; its tick/attention/cards logic and test seams are unchanged. The index instance is created before the monitor and passed in.
- `window-all-closed` disposes the index (watcher, timers, final cache flush).

### Renderer

- `src/renderer/src/lib/sessions-context.jsx` (mirrors settings-context): `SessionsProvider` owns `{ sessions, loading, error }` — initial `sessions.list({ limit: 500 })`, then `onChanged` replaces the array. `useSessions()` hook; App drops its local sessions state; Sidebar/StatsView/search receive the live list unchanged in shape.
- `openSessionById(id, fallbackFields)`: find in store, else synthesize `{ sessionId, file, title, cwd }` (today's `openCard` fallback, generalized). Notification clicks and search-result clicks use it — no more dead clicks.
- `sendNewChat` drops the 8-retry poll loop: it waits for the new sessionId to appear in the store (effect on `sessions`), with a 10s timeout fallback message.
- `App.jsx` merges `session:append` into the open detail: `setDetail({ ...payload.session, timeline: [...prev.timeline, ...payload.items] })` (guarded by `openFileRef`); `session:refresh` still replaces wholesale. SessionView's autoFollow/jump logic keys off `timeline.length` and needs no change.

## Error handling

- Corrupt persisted cache → start empty, log, rebuild by sweep (a slow boot, never a broken one).
- fs.watch throw at construction or runtime error event → sweep-only mode; a `mode` field is exposed for the About/debug surface.
- A delta parse that throws on one file never breaks the index loop (per-file try/catch; file falls back to full re-seed next sweep).
- Watch-slot subscribe on a missing/unreadable file returns the same `{ ok: false }` shape `session:read` produces today.

## Performance expectations

- Warm boot: 0 parses (cache hit on every unchanged file); sidebar instant.
- Steady state with one active session: per debounced change, one stat + one delta read of appended bytes (twice if it's also the open session) — replaces three whole-file re-parses per second across watch/monitor/list.
- Memory: summaries ~1KB × sessions; hot accumulators bounded by the 24h window (rings capped at 12 items); one full timeline only for the open session (same data the renderer already holds).

## Testing

- `tailer.test.js`: appends across calls, partial trailing line, truncation reset, fs injection — port the behavior live.js's tests rely on.
- `sessionindex.test.js`: DI fake fs/watch/clock — boot from cache (no parses for unchanged), watch event → updated summary + debounced `sessions` emit, cold-file change → seeded accumulator, sweep catches a change the watcher missed, deletion evicts, watch-slot delta/reset semantics, corrupt cache recovery.
- live.js existing tests stay green after the tailer extraction.
- monitor tests unchanged (injected fakes bypass the new defaults).
- Renderer store: merge/synthesize logic extracted as pure functions and unit-tested; full-app smoke (FLUX_SMOKE_SHOT) for boot + session view.
- Manual: start a `claude` in the terminal tab → its session appears in the sidebar without restart; click a notification for a brand-new session → it opens.

## Non-goals

- No FTS/search changes (next milestone, on `node:sqlite` per the probe).
- No worker threads/utilityProcess (re-evaluate with the search milestone).
- No timeline virtualization or rich rendering (separate renderer milestone).
- No subagent watching (subagent events are ignored; SubagentPanel keeps its 2s poll).
- LiveTracker keeps its own lifecycle (switches to tailer.js internally, nothing else).
