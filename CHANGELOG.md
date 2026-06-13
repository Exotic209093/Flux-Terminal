# Changelog

All notable changes to Flux Terminal are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [Unreleased]

### Added
- Single-instance lock (a second launch focuses the running window).
- Crash log (`userData/logs/main.log`) capturing uncaught exceptions, unhandled
  rejections, and renderer crashes; rotated, never uploaded.
- React error boundaries (app-level + per-view) with a reload fallback.
- Guided first-run welcome screen (claude CLI / login / sessions checks) and a
  persistent CLI-missing banner.

### Changed
- Session reads stream the transcript in bounded chunks, so multi-GB files no
  longer hit V8's string-size limit.

### Security
- `pty:spawn` validates the requested shell against an allowlist.

## [0.1.0] - 2026-06-11

Initial internal build: real ConPTY terminal (tabs + split), live/relived
Claude Code sessions with a defensive JSONL parser, themes & animated
backgrounds, live token/cost dashboards, session timeline + replay,
cross-session stats, live session tracking, interactive resume, skills,
plan-usage gauges, slash-command autocomplete, inline images, Mission Control,
watcher + notifications, FTS5 search, and an unsigned Windows NSIS build.
