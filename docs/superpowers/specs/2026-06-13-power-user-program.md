# Power-user program — ship everything, OSS-ready

**Date:** 2026-06-13
**Status:** decomposition approved; building sub-projects in order, #1 first.
**Goal (user's words):** "get all the things done and ready for use by all users — a power-user app."
**Distribution:** internal team first for testing, then **public OSS download from GitHub, unsigned** (SmartScreen click-through acceptable). Code signing deferred. Windows-first; macOS is v1.1.
**Source:** an 11-agent state-map workflow (2026-06-13) mapping the live code against the 2026-06-11 roadmap audit. This doc is the master sequencing artifact; each sub-project gets its own `…-design.md` spec + plan.

## Already shipped (out of scope — verified in code, not just README)

Foundation is largely solid. Confirmed done: command-injection hardening (`shell:false`, validated argv, CSP, window-open/navigation guards, `sandbox:true`, per-session child Map); the session-index substrate (recursive `fs.watch` + 15s sweep + persisted cache, warm boot parses nothing); the shared incremental tailer; elimination of the three synchronous re-parse pollers; FTS5 search (node:sqlite, 6 operators, keyboard overlay, cold-session jump); token usage deduped by `message.id`; exact turn durations from `turn_duration`; `gitBranch` badge; Mission Control grid; watcher/attention detection; notification delivery + history bell; the full Settings page; animated CSS themes; tabbed + split terminal; per-pane scrollback search; tracked-claude live bar; unsigned NSIS build (`app://` scheme, node-pty asar-unpacked).

Two foundation residuals remain and fold into sub-project #1: one unvalidated `pty:spawn` shell/cwd surface (`index.js:95-100` → `pty.js:20`), and a cold-read path that still `readFileSync`s whole files (`session:read`, `index.js:128`) — a V8 ~512MB risk on multi-GB transcripts.

## Build order (approved 2026-06-13)

| # | Sub-project | Effort | Depends on |
|---|---|---|---|
| 1 | **Production Hardening + Onboarding** | M | — |
| 2 | **Release Pipeline (CI + auto-update)** | M | #1 |
| — | **▶ Checkpoint A — internal-team-ready** (stable, installable, auto-updating) | | |
| 3 | **JSONL Parser Goldmine Extraction** | M | — |
| 4 | **Timeline Performance + Rich Rendering** | L | — (CSP done) |
| 5 | **Files-Touched Tab + Diff Lens** | M | #3, #4 |
| 6 | **Mission Control Cockpit Depth** | M | #3 |
| 7 | **Command Palette + Prompt History** | M | — |
| 8 | **Tray + Deep Links** | M | #1 (single-instance lock) |
| — | **▶ Checkpoint B — OSS-download-ready** (power-user daily driver, fit to publish) | | |
| 9 | **Visual Engine + Live Re-theming** | L | — |
| 10 | **Terminal Power-User QoL** | L | — |
| 11 | **Visual Reactivity + Ambient Layer** | M | #9 |
| 12 | **Windows Shell Integration** | S | — |
| 13 | **Session Archaeology Suite** | XL → 3×L | #3, #4 |

## Sub-project scopes

1. **Production Hardening + Onboarding** — `requestSingleInstanceLock` + second-instance focus; top-level React error boundary; main `uncaughtException`/`unhandledRejection` crash log to userData; proactive launch-time check for missing `claude` CLI + empty-`~/.claude` welcome screen; LICENSE (MIT); `engines: node >=22`; CHANGELOG `0.1.0`; CONTRIBUTING; `pty:spawn` shell allowlist; cold-read path through tailer drain-from-zero.
2. **Release Pipeline** — GitHub Actions test gate on push/PR; tag-triggered build → electron-builder → upload NSIS; `v0.1.0` tag; electron-updater + `publish:github`.
3. **JSONL Parser Goldmine Extraction** — pure data layer, no UI. Read top-level `toolUseResult` (`structuredPatch`, `oldString`/`newString`, stdout, durationMs); retain `tool_use` block id; retain `uuid`+`parentUuid` per item; parse `type:'attachment'` hook records; `system.subtype==='compact_boundary'`; `permission-mode`/`mode`, `file-history-snapshot`, `queue-operation`; surface subagent `meta.toolUseId`. **Single landing point propagates to whole-file/live/index/FTS.** Gates #5, #6, #13.
4. **Timeline Performance + Rich Rendering** — virtualization + `React.memo` TimelineItem; move composer draft state into Composer (kill keystroke re-render storm); markdown rendering; code syntax highlighting; collapsible thinking; render per-item `ts`; never-blocking composer with queued sends + draft preserved on failed send; scope tab/split/focus shortcuts via `attachCustomKeyEventHandler`, replace blocking Ctrl+W confirm. Virtualization is the hard prerequisite for cinema replay (#13).
5. **Files-Touched Tab + Diff Lens** — files-touched tab aggregating `toolUseResult`; inline Edit/Write diffs; Bash stdout/exit/duration; subagent drill-in via block.id↔`meta.toolUseId`; optional gh commit/PR.
6. **Mission Control Cockpit Depth** — attention-event timestamps on card DTO + age badges; TodoWrite chips; actionable toasts (Interrupt/Open/Snooze with suppression); optional ntfy/Pushover push.
7. **Command Palette + Prompt History** — Ctrl+K fuzzy palette; action registry; mined prompt history (reuses FTS + substrate).
8. **Tray + Deep Links** — tray icon + minimize/close-to-tray + context menu; `setAsDefaultProtocolClient('flux')`; open-url / second-instance routing to `openById`.
9. **Visual Engine + Live Re-theming** — TerminalPane live re-theme effect (the gating prereq); `scene-engine.js` (single rAF, DPR, ResizeObserver, visibility-paused); `scenes/{aurora,nebula,synthwave,matrix}.js`; ThemeBackground → single canvas; `intensityToAlpha` + terminal transparency + Intensity control; index.css cleanup. = the 2026-06-11 visual-engine spec Phase 1+2.
10. **Terminal Power-User QoL** — profile editor for cwd/shell/args/tracked; args passthrough (`pty.js` + `pty:spawn` IPC); restore split/ratio/active-pane; `@xterm/addon-web-links` + clickable paths; copy-on-select / right-click paste; OSC 133 marks (shell-integration injection + decorations).
11. **Visual Reactivity + Ambient Layer** — Phase 3 reactivity (rain ∝ tokens/sec, sun flares on error); global `--pulse`; screensaver mode; WebAudio cues; live cost odometer; always-on-top HUD.
12. **Windows Shell Integration** — Jump List / `setUserTasks`; `setProgressBar`; `setThumbarButtons` Interrupt (reuses `session:interrupt` + the `setOverlayIcon` pattern).
13. **Session Archaeology Suite (XL — split into 3×L when reached)** — (a) cinema replay + fork-from-here + chapters/auto-titles; (b) export Markdown/HTML + Ask Flux (`claude -p` over corpus); (c) hooks panel + context-pressure gauge + conversation constellation + generalised pane↔session fusion.

## Dependency graph (hard edges)

- Rich rendering, diff lens, clickable paths → CSP hardening **(done — satisfied)**
- Files-touched / diff lens, hooks panel, context gauge, constellation, subagent linkage → **#3 parser extraction**
- Cinema replay → **#4 virtualization**
- Visual engine → **TerminalPane live re-theming** (inside #9); reactivity/screensaver → visual engine
- flux:// deep links → **single-instance lock** (inside #1)
- electron-updater → **release pipeline + version tag** (#2)

## Deferred decisions (revisit at the relevant checkpoint)

- Code signing (Azure Trusted Signing ~$10/mo): deferred past unsigned v0.1.0. **User: no signing for now.**
- macOS port: explicitly v1.1; Windows-only through v1.0.
- Archaeology XL split: cut into (a)/(b)/(c) above when #13 is reached.
- OSC 133 shell-integration injection: confirm opt-in vs auto PowerShell-profile hook at #10.
- worktree-per-session spawn + local task-queue/scheduler: Cockpit-tier items parked until after v1.0 unless pulled forward.
- Fork-from-here: fork-from-latest is nearly free; midpoint forks need per-line sessionId rewrite — likely deferred.

## Sub-project #1 — shipped 2026-06-13 (branch `feat/production-hardening-onboarding`)

All 11 plan tasks DONE, spec-compliant, quality-approved; 273/273 tests pass, build clean, final review ready-to-merge. Minor follow-ups the review surfaced (none blocking, parked for a polish pass):

- **Welcome `sessionCount`**: `env:doctor` uses `sessionIndex.list(1).length`, so the "Sessions found" row shows 0 or 1 — misleading for an existing user who sees the first-run screen once after upgrading. Fix: add `SessionIndex.count()` (exact, uncapped) or show presence not a number. (First-run only; new users see 0 correctly.)
- `streamLinesSync` can emit an empty-string line (filtered downstream by `!line.trim()`); add a JSDoc note or guard before reuse.
- `WelcomeScreen` `env.doctor().then()` has no `.catch()` (the handler returns `{ok:false}` rather than rejecting, so practically safe).
- `env.doctor()` runs twice on first launch (App banner + WelcomeScreen) — pass the result down as a prop to halve the IPC.
- `crashlog.rotateIfNeeded` cascade (main.1→main.2) isn't unit-tested; the single-slot path is.
- `welcome-overlay` shares `z-index:50` with `.bell-panel` (no real-world collision at first run).

## Sub-project #2 — shipped + LIVE 2026-06-13 (▶ Checkpoint A reached)

CI + auto-update pipeline merged to main and wired live. 276 tests pass; CI green on push (windows-latest, Node 24, test+build); `release.yml` builds the NSIS installer on tag push and publishes to GitHub Releases via electron-builder + `GITHUB_TOKEN`. **`v0.1.0` is the first published release** — live at https://github.com/Exotic209093/Flux-Terminal/releases/tag/v0.1.0 (installer 103 MB + `latest.yml`). electron-updater (`src/main/updater.js`, lazy-require, no-op in dev) checks on launch in packaged builds. main pushed to origin (public repo). **This is Checkpoint A — internal-team-ready: stable, installable, auto-updating.**

Gotcha fixed: electron-builder's GitHub publisher defaults to `releaseType: draft` (invisible on Releases page + electron-updater can't read a draft) — set `releaseType: release` in the publish block so tag-push → live release → auto-update works.

Next: #3 JSONL Parser Goldmine Extraction (no-UI data enabler; gates #5/#6/#13).

## Sub-project #3 — shipped 2026-06-14 (merged to main + pushed)

Parser goldmine extraction, 282 tests (no regressions, counts shape unchanged). Additive to the shared per-line reducer (`applyEvent`/`walkContent`), so it propagates to whole-file + live/index tailer. Delivered: uuid/parentUuid stamped on every timeline item (post-switch loop in applyEvent, `=== undefined` guard) + tool_use `id`; capped `toolUseResult` (`MAX_RESULT=4000`) on tool_result items — `structuredPatch` (via `capPatch` → `{truncated:true}` if oversized), `filePath` (with `tur.file.filePath` fallback), `stdout`/`stderr`; `type:'attachment'` → `kind:'hook'` items (hookName/hookEvent/status/toolUseId/text) + `model.hookCount`; `compact_boundary` → `kind:'compact'` + `model.compactions`; `subagents.js` surfaces `meta.toolUseId`. YAGNI-deferred (no consumer yet): file-history-snapshot, queue-operation, permission-mode. Minor follow-up parked: hook-item test doesn't assert uuid stamping (works, just untested). Real shapes verified against ~/.claude transcripts: hook data nests under `o.attachment` (toolUseID capital), structuredPatch is an array under toolUseResult.

Next: #4 Timeline Performance + Rich Rendering (L; virtualization gates cinema replay #13).

## Sub-project #4 — shipped 2026-06-14 (merged to main + pushed)

Timeline perf + rich rendering, 285 tests, build clean. Deps added: react-virtuoso, react-markdown, remark-gfm, rehype-highlight, highlight.js. Delivered: `Markdown.jsx` (gfm + hljs github-dark); memoized `TimelineItem.jsx` extracted from SessionView — markdown text bodies, collapsible thinking (collapsed default), per-item `ts` in gutter; `react-virtuoso` virtualization (followOutput auto-scroll, atBottomStateChange→jump button, scrollToIndex for search-jump + LAST for bottom, Footer carries pending/working/error rows; ALL old manual scroll code removed — no scrollRef/onScroll/querySelectorAll); never-blocking composer (textarea no longer disabled while running) + pure `composerQueue.js` FIFO reducer (enqueue-while-running, flush effect on sendState transition, draft restored on error via lastSent ref, single-dequeue prevents double-send) + "N queued" indicator; terminal shortcuts gated on `active` prop (App passes view==='terminal') + Ctrl+W closes without confirm + TerminalPane.attachCustomKeyEventHandler returns false only for Ctrl+T/W/Tab, Ctrl+Shift+E/O, Alt+Arrows. composerQueue.js is ESM; its test uses dynamic import() (works Node 22.0+). Renderer bundle now ~1.97MB (fine for desktop). Minor follow-ups parked: Markdown inline plugin arrays re-created per render (hoist to module consts); Footer/flash defeat memo (bounded by virtualization); queue-flush omits setShowJump(false) (brief jump-button flicker).

Next: #5 Files-Touched Tab + Diff Lens (unblocked by #3 parser data + #4 rendering).

## Sub-project #5 — shipped 2026-06-14 (merged to main + pushed)

Files-touched + diff lens, 288 tests, build clean, no new deps. `Diff.jsx` renders structuredPatch hunks (+/- colored, `{truncated}`→notice); pure `lib/filesTouched.js` (`diffStats`, `collectFilesTouched`, ESM + dynamic-import test); inline collapsible `DiffResult` on tool_result items (falls back to text when no patch); `FilesTouched.jsx` + Timeline/Files(N) toggle in session header (Virtuoso preserved in else-branch); parent→subagent drill-in (SubagentPanel made optionally-controlled via openId/onOpenId/onList with internalOpenId fallback; `subByToolUseId` useMemo map; "↘ open subagent" button on matching Task tool_use). gh commit/PR action deferred. Minor follow-ups parked: filesCount recomputes collectFilesTouched per render (memo it); mainView not reset on session change (leaving Files tab → new session shows empty); inline DiffResult always expanded (spec wanted collapsed-by-default for large); SubagentPanel onList missing from effect deps (safe, stable setter); .tl-diff-head missing width:100%.

Next: #6 Mission Control Cockpit Depth.

## Sub-project #6 — shipped 2026-06-14 (merged to main + pushed)

Mission cockpit depth, 295 tests, build clean, no new deps. Parser `lastTodos` (latest TodoWrite todos, capped 50/200); Notifier per-session `snooze(sessionId, minutes)` (deadline map, checked after mute) + `notify:snooze` IPC + preload; monitor tracks `attnSince` (set on enter needs-you, clear on leave) + `todos`; `composeCards` surfaces `attnSince`/`todos`, `cardsChanged` flips on `todoSig`/`attnSince`; MissionCard renders age badge (needs-you duration), todo progress chip (✓done/total + active), and a 😴 snooze button (stopPropagation). **Reassigned: ntfy/Pushover push → #8** (remote-notification cluster). Deferred/flagged: Interrupt-from-card (only Flux-spawned ClaudeRunner children interruptible, not external claude), OS toast action buttons (Electron Notification.actions is macOS-only). Minor parked: todoSig tracks done/total only, so active-task label can be stale until next completion.

Next: #7 Command Palette + Prompt History.

## Sub-project #7 — shipped 2026-06-14 (merged + pushed)

Command palette, 302 tests. Pure `lib/fuzzy.js` (exact>prefix>substring>subsequence, word-boundary first char, substring gated to len>1) + `lib/palette.js` (buildCommands/filterCommands over actions+sessions+prompts); `CommandPalette.jsx` Ctrl+K overlay; App runCommand dispatch + `startNewChat(cwd, initialDraft)` prefill + SessionView one-shot draft seed. Full prompt-history search stays Ctrl+Shift+F. Minor parked: Ctrl+K not in TerminalPane attachCustomKeyEventHandler block list (leaks a control byte to a focused xterm, same as existing Ctrl+M/Ctrl+,); session sub-line shows cwd (no `project` field on session DTO).

## Sub-project #8 — shipped 2026-06-14 (merged + pushed) — ▶ CHECKPOINT B REACHED (OSS-download-ready)

Tray + deep links + ntfy push, 312 tests. `deeplink.js` parseDeepLink/findDeepLink (flux://session/<uuid>, flux://mission); index.js setAsDefaultProtocolClient (dev-aware) + extended the #1 second-instance handler to route + open-url + cold-start did-finish-load; electron-builder.yml `protocols` block; preload deeplink.onOpen; App routes session→openById / mission→setView. `tray.js` createTray (Show/Quit, data-URL icon fallback) + close-to-tray (settings.tray.closeToTray + isQuitting guard). ntfy push: settings.push{enabled,url} + tray{closeToTray} (setByPath routes); notify shouldPush/buildPushMessage + Notifier.httpPost. **Final review caught a Critical: index.js wasn't injecting httpPost → push was a no-op in prod (unit tests passed via injected stub); fixed by wiring a fetch-based httpPost into the Notifier.** Settings UI: close-to-tray + push in NotificationsSection. Minor parked: index close handler reads settings.tray.closeToTray without optional chaining (safe, DEFAULTS always present).

**▶ Checkpoint B = OSS-download-ready. 8/13 sub-projects done. Remaining (post-OSS polish): #9 Visual Engine, #10 Terminal QoL, #11 Visual Reactivity, #12 Windows Shell Integration, #13 Archaeology Suite (XL, split 3×L).**

## Sub-project #9 — shipped 2026-06-14 (merged + pushed)

Visual engine, 317 tests. `lib/scene-engine.js` (one rAF, DPR≤2, visibility-pause, ResizeObserver, theme→factory registry, destroy cleanup); `lib/scenes/{aurora,nebula,synthwave,matrix}.js` (create(ctx)→{draw,resize}, additive compositing, area-scaled particles, matrix ~24fps); `appearance.intensityToAlpha` (0.90/0.76/0.62) + `themes.terminalBg`/`hexToRgba` + `settings.appearance.intensity`; ThemeBackground → single canvas; TerminalPane `allowTransparency:true` + terminalBg-at-alpha only when animated+animations-on; AppearanceSection Subtle/Balanced/Bold; index.css old per-theme rules removed + `.theme-bg-canvas` under data-anim=on. Static themes unaffected. Minor parked: transparency scroll-perf risk NOT stress-tested (manual verify recommended; allowTransparency ships unconditionally so static themes also use xterm's slower path); redundant size() in setScene+start.

## Release pipeline hardened 2026-06-14

Fixed the electron-builder publish race (only blockmap uploaded): release.yml now `electron-builder --win --publish never` then deterministic `gh release upload` (create-or-upload --clobber). Deleted the broken v0.2.0 release+tag. **Cutting v0.3.0 (daily driver + visual engine) as the first reliable downloadable release.**
