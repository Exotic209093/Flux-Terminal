# Roadmap audit — codebase findings + feature roadmap

**Date:** 2026-06-11
**Status:** findings verified; correctness/security week planned (see plans/2026-06-11-correctness-security-week.md)
**Source:** 11-agent audit (5 subsystem readers, competitive web research, 4 ideation lenses, completeness critic). Claims below marked *verified* were measured against real transcripts on this machine (306MB / 207 sessions) or checked against the installed `claude` CLI.

## Verified correctness findings

1. **Token usage overcounted 2.4–2.75x everywhere.** Claude Code writes multiple JSONL records per assistant message (one per content block) sharing `message.id` with byte-identical usage objects. `parser.js:129` sums all of them. *Verified:* 2,281 assistant records vs 905 distinct ids on one transcript (2.29M output tokens counted vs 835K real); re-verified on a second transcript (44 records → 16 ids, duplicate usage objects byte-identical). Fix: count usage once per `message.id`. Gates every cost/stats/gamification feature.
2. **Turn detection misfires for long multi-tool turns.** 87% of `type:'user'` records are tool_result carriers; each re-opens the "turn" in attention.js, so `turn:finished` durations measure only the final tool-result→assistant gap and rarely clear MIN_TURN_MS. *Verified:* `system.subtype === 'turn_duration'` records with exact `durationMs` exist in real transcripts (CLI 2.1.170). Fix: only string/non-tool_result user records open turns; consume turn_duration for exact close.
3. **Bundled skills broken in every installed copy.** `electron-builder.yml` packages only `out/**` + `package.json`; `skills.js` resolves `<appPath>/skills`, which never enters the asar. Works in dev only.
4. **Command-injection chain.** Renderer-supplied `sessionId`/`model` flow into `spawn('claude', args, { shell: true })` (index.js:367/427); plus no CSP, no `setWindowOpenHandler`, no `will-navigate` guard, `sandbox: false`. Transcript-derived content is untrusted (sessions fetch the web), so one renderer XSS = RCE via `flux.pty.spawn`. Must land before markdown rendering / HTML export / any richer rendering of transcript content.
5. **`sendChild` is a single module-level global** shared by session:send/session:new; overlapping sends clobber each other, `finish()` nulls the wrong child, interrupt can hit nothing or the wrong child. Fix: per-sessionId child Map (resume.js extraction).

## Performance / scale findings (fast-follow, not this week)

- Three pollers re-parse whole transcripts synchronously on the main process: session watch (1s, index.js:312), monitor (3s, monitor.js:103), `sessions:list` (every call, sessions.js:77). Quadratic over a session's life; stalls PTY data. `live.js` already has correct incremental byte-offset tailing to reuse.
- `search()` runs sync readFileSync over all transcripts inside the IPC handler — first query freezes live terminals.
- `parser.js` readFileSync hits V8's ~512MB string limit: multi-GB transcripts become permanently unviewable.
- Sessions list is fetched once at App mount and never refreshed; search-hit and notification clicks on unknown ids are silent no-ops. No fs.watch anywhere (4 independent pollers).
- **One substrate fixes all of these:** recursive fs.watch on ~/.claude/projects → incremental parse off the main thread → persistent summary index. For FTS, prefer Electron 42's `node:sqlite` (check FTS5) over better-sqlite3 — `npmRebuild: false` + the space in "Flux Terminal" makes a second native module a packaging hazard.

## Renderer findings

- Timeline has no virtualization; composer draft state lives in SessionView so every keystroke re-renders every TimelineItem; live refresh replaces the whole detail object. Virtualize + React.memo + move draft into Composer.
- No markdown/code highlighting/diff rendering (Edit/Write show 600-char JSON); thinking blocks don't collapse; `ts` exists on every item but is never rendered. (Rich rendering is gated on the CSP work.)
- Terminal shortcuts (Ctrl+W/T/Tab) registered window-wide; they hijack the shell when an xterm pane is focused and fire invisibly from other views. Scope via `attachCustomKeyEventHandler`.
- Composer is disabled while claude runs and the draft is cleared at submit (a failed send eats the message). Queue sends; preserve drafts.
- TerminalPane reads the theme only on mount — open panes never re-theme. Blocker for the visual-engine transparency work (the spec assumes live re-theming).

## Unparsed JSONL goldmine (verified present in real transcripts)

- `toolUseResult` on user records (909 in 8 transcripts): Edit/Write `structuredPatch` diffs, Bash stdout/durations → files-touched tab, diff lens.
- `attachment` records (237) carry **hook executions**: hookName, command, stdout/stderr, exitCode, durationMs → hooks observability panel (no tool anywhere surfaces this).
- `turn_duration`, `compact_boundary`, `file-history-snapshot`, `queue-operation`, `permission-mode`, `mode` records; `gitBranch` on every record (branch display needs zero git execs).
- `uuid`/`parentUuid` threading → real conversation tree; subagent `meta.toolUseId` linkage.
- `claude --resume <id> --fork-session` exists in the installed CLI (*verified*) → fork-from-latest is nearly free. Mid-point forks need per-line sessionId rewriting (the filename is the id and every record embeds it).

## Production v1.0 set

GitHub Actions (test gate + tag-triggered NSIS release) → electron-updater + `publish: github` (ship before announcing anywhere) → LICENSE file + `engines: node >=22` + v0.1.0 tag + CHANGELOG → first-run onboarding (claude CLI missing / empty ~/.claude vs today's `No sessions match ""`) → local crash log + React error boundary + single-instance lock (skip Sentry) → README rewritten for users, machine notes → CONTRIBUTING. Fast-follow: Azure Trusted Signing (~$10/mo). v1.1: macOS port (Keychain creds in usage.js, dmg target, dock badge, Cmd keymap) — don't let it delay Windows v1.0.

## Feature roadmap (post-fixes, ordered tiers)

**Cockpit tier:** attention triage queue in Mission Control (needs-you-first + age badges); never-blocking composer with queued sends; one Ctrl+K palette (sessions/actions/launch templates/mined prompt history); files-touched tab + diff lens from toolUseResult with gh commit/PR; worktree-per-session spawn (Conductor is Mac-only; Windows lane open, Pane is racing for it); tray mode + flux:// deep links + actionable toasts (Interrupt/Open/Snooze) + optional ntfy/Pushover push; TodoWrite checklist chips on cards; task queue + local scheduled runs (one scheduler, ad-hoc + cron — counter-positions cloud Routines as local-first).

**Archaeology tier:** fork-from-here (`--fork-session`); cinema-mode replay with scrubber (needs virtualization first); session chapters + auto-titles (heuristics, then optional haiku); export as Markdown + self-contained HTML replay; Ask Flux (`claude -p` over the corpus: standups, "what did I do last week"); hooks observability panel; context-pressure gauge (compact_boundary + lastContextTokens); terminal-pane↔session fusion (auto-link claude in a pane to its transcript).

**Identity tier:** Canvas-2D engine + Phase 3 reactivity built as one unit (rain accelerates with tokens/sec, sun flares on error; prerequisite: TerminalPane live re-theming); global `--pulse` CSS var; WebAudio event cues; live cost odometer; Flux Wrapped + shareable PNG cards; conversation constellation (parentUuid tree); always-on-top HUD; screensaver mode; terminal QoL (addon-web-links, clickable paths, OSC 133 marks, copy-on-select); Windows shell surfaces (Jump List, taskbar progress, thumbnail Interrupt).

## Positioning

Flux is the session archaeology engine plus live mission control, wearing vivid visuals, on a real terminal, Windows-first. Don't compete with the official desktop app on basics; compete where the archive is the moat (deep recall, replay, fork, analytics, Wrapped).
