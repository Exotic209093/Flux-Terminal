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
