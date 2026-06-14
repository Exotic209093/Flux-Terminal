# Changelog

All notable changes to Flux Terminal are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [0.3.0] - 2026-06-14

Visual engine + a reliable release.

### Added
- **Animated visual engine:** a Canvas-2D scene engine renders Aurora, Nebula,
  Synthwave, and Matrix scenes behind a now semi-transparent terminal, with a
  **Subtle / Balanced / Bold** intensity control. Static themes stay opaque.

### Fixed
- The release pipeline now uploads the installer + `latest.yml` deterministically
  via the `gh` CLI (electron-builder's publisher was racing the upload and leaving
  releases with only a blockmap — v0.2.0 was affected).

## [0.2.0] - 2026-06-14

The power-user daily-driver release.

### Added
- **Rich timeline:** markdown rendering with syntax-highlighted code, collapsible
  thinking blocks, per-message timestamps, and a virtualized timeline that stays
  fast on huge sessions.
- **Inline diffs:** Edit/Write changes render as colored diffs; a **Files** view
  per session lists every touched file with its diffs.
- **Command palette (Ctrl+K):** fuzzy-jump to any session, run any action, or
  launch a saved prompt.
- **Mission Control depth:** age badges (how long a session has needed you),
  TodoWrite progress chips, and per-session snooze.
- **Never-blocking composer:** type and queue messages while Claude is working;
  a failed send no longer loses your draft.
- **System tray** with Show/Quit and optional close-to-tray; **`flux://` deep
  links** open a session from anywhere; optional **ntfy push** on needs-you events.
- **Subagent drill-in** from a parent Task tool call.

### Changed
- The parser now retains diffs, hook executions, compaction boundaries, and
  conversation threading ids (groundwork for replay, hooks, and analytics views).

## [0.1.0] - 2026-06-13

First published release.

### App
- Real ConPTY terminal (tabs + two-pane split + per-pane scrollback search),
  live and relived Claude Code sessions with a defensive JSONL parser, themes
  and animated backgrounds, live token/cost/tools dashboards, session timeline
  + replay, cross-session stats, live session tracking, interactive resume,
  skills, plan-usage gauges, slash-command autocomplete, inline images, Mission
  Control, watcher + notifications, and FTS5 cross-session search.

### Hardening + onboarding
- Single-instance lock (a second launch focuses the running window).
- Crash log (`userData/logs/main.log`) for uncaught exceptions, unhandled
  rejections, and renderer/child crashes; rotated, never uploaded.
- App-level + per-view React error boundaries with a reload fallback.
- Guided first-run welcome screen (claude CLI / login / sessions checks),
  a persistent CLI-missing banner, and a real zero-sessions empty state.
- `pty:spawn` validates the requested shell against an allowlist.
- Session reads stream the transcript in bounded chunks, so multi-GB files no
  longer hit V8's string-size limit.

### Distribution
- GitHub Actions CI (test + build) on push/PR.
- Tag-triggered NSIS installer published to GitHub Releases.
- In-app auto-update via electron-updater (unsigned; SmartScreen prompts until
  code signing is added).
