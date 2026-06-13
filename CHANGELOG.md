# Changelog

All notable changes to Flux Terminal are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

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
