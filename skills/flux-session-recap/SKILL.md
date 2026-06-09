---
name: flux-session-recap
description: Summarize a Claude Code session into a short, skimmable recap — what was asked, what changed, key decisions, and open follow-ups. Use when the user says "recap this session", "summarize what we did", "what did we change", or wants a handover note for a conversation. Reads the session transcript and produces a tight bulleted summary plus a list of files touched and next steps.
---

# Flux Session Recap

Turn a long Claude Code session into a recap someone (or future-you) can read in 30 seconds.

## When to use
- "recap this session" / "summarize what we did today"
- Writing a handover note before stopping work
- Producing a changelog-style summary of a working session

## How to produce the recap
1. Identify the relevant transcript. If the user names a session file (`*.jsonl` under
   `~/.claude/projects/<encoded-cwd>/`), read it; otherwise summarize the current conversation.
2. Extract, in order:
   - **Goal** — the user's original ask (first substantive prompt).
   - **What changed** — files created/edited/deleted (from `Edit`/`Write` tool calls) and commands run.
   - **Key decisions** — design choices, trade-offs, anything the user explicitly chose.
   - **Verification** — tests/builds run and their outcome.
   - **Open follow-ups** — anything deferred, flagged, or left unfinished.
3. Output format:

```
## Recap — <one-line title>
**Goal:** …
**Changed:** `path` — what, `path` — what
**Decisions:** …
**Verified:** …
**Next:** …
```

## Rules
- Be concrete and terse — link files as `path:line` where useful.
- Don't invent outcomes; if a step's result is unknown, say so.
- Prefer the user's own words for the goal.
