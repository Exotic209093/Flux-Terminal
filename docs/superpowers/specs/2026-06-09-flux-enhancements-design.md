# Flux Terminal Enhancements — Design

Date: 2026-06-09
Status: Approved

Three independent enhancements to Flux Terminal, requested together:

1. **Live plan usage** — show 5-hour and weekly limit consumption.
2. **Slash commands** — autocomplete + send in the session message composer.
3. **Images** — render incoming images in the timeline; attach/paste images to send.

---

## Background: how the app works today

- **Electron + React.** Main process (`src/main/*`) owns the PTY, session parsing, live
  tailing, and skills. Renderer (`src/renderer/src/*`) is the React UI. They talk over a
  minimal `contextBridge` surface exposed as `window.flux` (`src/preload/index.js`).
- **Sessions** are Claude Code JSONL transcripts under `~/.claude/projects/...`. `parser.js`
  turns one into a structured summary + optional `timeline` (ordered replay items). `live.js`
  tails an actively-growing file; `index.js` watches an open file and re-parses on change.
- **Messaging a past session** runs `claude --resume <id> -p` with the prompt on stdin
  (`session:send` in `index.js`), from the session's *creation* cwd. The reply lands in the
  JSONL and the file-watcher streams it back into the timeline.
- **SessionView.jsx** renders the header (context gauge + stats), the timeline, and the
  composer.

---

## Feature 1 — Live plan usage (5h + weekly)

### Data source (decided: live, exact)

`GET https://api.anthropic.com/api/oauth/usage` — the same endpoint the `claude /usage`
command uses (confirmed by inspecting the bundled CLI binary). Response contains windows:

- `five_hour` — the 5-hour rolling window
- `seven_day` — the weekly window
- `seven_day_opus`, `seven_day_sonnet` — per-model weekly windows

Each window carries `utilization` / `remaining_percentage` and `resets_at` (ISO timestamp),
which is exactly "how far from the weekly and 5-hour limits" plus a reset countdown.

### Auth

- Read the OAuth **access token** from `~/.claude/.credentials.json` at request time and send
  `Authorization: Bearer <token>` plus the required `anthropic-beta` OAuth header.
- The token never leaves the machine except in the request to `api.anthropic.com`.
- **Credential access requires explicit user permission** at implementation time (the sandbox
  blocks reading the credentials store otherwise — by design).
- If the token is missing/expired (HTTP 401), surface a clear "usage unavailable — run
  `claude` once to refresh your login" state. Full OAuth refresh-token flow is **out of scope
  for v1**.

### Main process — `src/main/usage.js`

- `fetchUsage()` → reads token, calls the endpoint (Node `https`/`fetch`), normalizes to:
  ```
  {
    ok: true,
    windows: {
      fiveHour:    { utilization, remaining, resetsAt },
      sevenDay:    { utilization, remaining, resetsAt },
      sevenDayOpus:   { ... } | null,
      sevenDaySonnet: { ... } | null
    },
    fetchedAt
  }
  ```
  or `{ ok: false, error, code }` (e.g. `code: 'AUTH'` for 401, `'NO_CREDS'`, `'NETWORK'`).
- A poller ticks every **60s** while a window exists, pushing `usage:update`. Also fetched
  once on launch.
- IPC in `index.js`: `usage:get` (invoke, on-demand), `usage:refresh` (invoke, forces a fetch
  now), and `usage:update` (pushed). Poller is started in `app.whenReady`.

### Preload

```
window.flux.usage = {
  get:     () => invoke('usage:get'),
  refresh: () => invoke('usage:refresh'),
  onUpdate: (cb) => on('usage:update', cb)   // returns unsubscribe
}
```

### Renderer

- `lib/useUsage.js` — a hook that fetches once, subscribes to `usage:update`, exposes
  `{ usage, refresh }`. One source of truth shared by both placements.
- `components/UsageBar.jsx` — **compact** twin gauges (5h + weekly): each a small bar with
  `NN%` and a `resets in Xh Ym` countdown. Amber ≥ 70%, red ≥ 90%. A manual refresh button.
  An error/`AUTH` state renders a small inline notice instead of gauges.
- Placement:
  - **Topbar** (always visible) — compact `UsageBar`.
  - **Top of each session** — a fuller breakdown block at the top of `SessionView`'s header
    (includes the per-model weekly windows when present).

### Failure / edge handling

- No credentials file, or user declines credential access → `NO_CREDS` notice; rest of app
  unaffected.
- Network error → keep last good snapshot, show a subtle "stale" hint; retry on next tick.
- Countdown is derived in the renderer from `resetsAt` so it ticks smoothly between fetches.

---

## Feature 2 — Slash commands in the composer

Scope: the **session message composer** (the Terminal tab already supports `/commands`
natively because it is a real `claude` PTY session).

### Main process — `src/main/commands.js`

- `listCommands(cwd)` returns a merged, de-duplicated list of:
  - **Built-ins** — a curated static list (name + short description) of common Claude Code
    slash commands.
  - **User custom** — `~/.claude/commands/*.md` (name = filename; description from the
    `description:` frontmatter if present).
  - **Project custom** — `<cwd>/.claude/commands/*.md` for the session's project.
- Shape: `[{ name: '/review', description: '...', source: 'builtin'|'user'|'project' }]`.
- IPC `commands:list` (invoke, takes the session cwd). Exposed as `window.flux.commands.list`.

### Renderer — `components/SlashMenu.jsx` + composer changes in `SessionView.jsx`

- When the draft **starts with `/`**, show a dropdown above the composer filtered by the typed
  prefix. ↑/↓ move selection, Tab/Enter completes the highlighted command, Esc dismisses.
- The list is fetched once per opened session (cwd-dependent) and cached.
- Sending is unchanged: a `/command` is passed through to `session:send` →
  `claude --resume -p`, which executes it.

---

## Feature 3 — Images (both directions)

### Incoming — render images in the timeline

- `parser.js` `walkContent` currently handles `text`, `thinking`, `tool_use`, `tool_result`.
  Extend it to detect `image` content blocks:
  - Direct `image` blocks in user/assistant content:
    `{ type: 'image', source: { type: 'base64', media_type, data } }`.
  - `image` blocks nested inside a `tool_result`'s `content` array.
  - Emit `{ kind: 'image', ts, mediaType, data }` timeline items.
- **Size/count caps** (prevent IPC/UI bloat): skip/elide images whose base64 exceeds a cap
  (e.g. ~1.5 MB) with a `{ kind: 'image', truncated: true }` placeholder; cap total images
  retained per parse. Live tailer (`live.js`) shares the same `walkContent`, so it inherits
  this automatically (its `MAX_RECENT` ring already bounds memory).
- `components/TimelineItem` (in `SessionView.jsx`) renders an `image` item as an inline
  thumbnail (`<img src="data:<mediaType>;base64,<data>">`); clicking opens
  `components/Lightbox.jsx` (full-size overlay, click/Esc to close).

### Outgoing — attach / paste images to send

- Composer gains a 📎 attach button (file picker) and a **paste handler** (Ctrl+V image from
  clipboard).
- On attach/paste:
  - The image bytes are written to a temp file (`os.tmpdir()/flux-<id>.<ext>`) via a new
    IPC `image:stash` (returns the absolute path).
  - The composer shows a small chip ("🖼 image attached ✕").
  - On send, the absolute path is appended to the prompt text so the resumed `claude` opens it
    with its Read tool (e.g. the message plus `\n\n[Attached image: <abs path>]`).
- **Trade-off / rationale:** `claude --resume -p` consumes a *text* prompt on stdin, so a
  referenced file path is the reliable way to introduce an image. The UI hides this detail;
  the user just pastes and sends.
- Temp files are best-effort cleaned on app exit.

---

## Cross-cutting

- **Keep files focused.** New renderer units: `UsageBar.jsx`, `Lightbox.jsx`, `SlashMenu.jsx`,
  and hooks/helpers `lib/useUsage.js`. This keeps `SessionView.jsx` from ballooning as it gains
  the usage block, slash menu, image rendering, and attach controls.
- **Preload additions** are minimal, namespaced bridges (`usage`, `commands`, plus `image`),
  matching the existing `pty` / `sessions` / `skills` / `live` style.
- **No new heavy deps.** Use Node built-ins for the HTTPS call and temp files; React for UI.

## Out of scope (v1)

- OAuth refresh-token flow (expired token → "run `claude` to refresh" message).
- Files-API upload for outgoing images (temp-file + path is sufficient and simpler).
- Slash-command argument hinting / parameter forms (autocomplete is name-level only).

## Testing

- `parser.js` image extraction: unit-test against fixture JSONL lines containing direct and
  tool-result-nested image blocks, plus an oversized image (asserts truncation placeholder).
- `commands.js`: unit-test merge/dedupe across builtin + user + project dirs with a temp dir.
- `usage.js`: unit-test the response normalizer against a sample payload and the 401 → `AUTH`
  path (network mocked).
- Manual smoke: launch app, confirm topbar + session usage gauges populate, slash menu filters
  and sends, an image-bearing session renders thumbnails, paste-to-send round-trips.
