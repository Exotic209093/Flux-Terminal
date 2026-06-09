---
name: commit-tidy
description: Write a clean, conventional commit message from the staged changes. Use when the user says "commit this", "write a commit message", "tidy my commit", or asks to commit work. Inspects the staged diff and proposes a Conventional Commits message (type(scope): subject + body of what/why), then commits only after the user confirms.
---

# Commit Tidy

Produce a clear commit message that follows Conventional Commits, grounded in the actual staged diff.

## When to use
- "commit this" / "write a commit message for my changes"
- Cleaning up a vague message before committing

## Steps
1. Run `git status --short` and `git diff --staged` to see exactly what's staged.
   - If nothing is staged, tell the user and ask whether to `git add -A` first.
2. Draft a message:
   - **Subject:** `type(scope): summary` — imperative mood, ≤ 72 chars.
     `type` ∈ feat | fix | refactor | docs | test | chore | perf | build | ci.
   - **Body:** what changed and *why* (not how), wrapped at ~72 cols. Reference issues if mentioned.
3. Show the proposed message and **wait for confirmation** before committing.
4. On confirmation, commit with that message. Never push unless explicitly asked.

## Rules
- Derive the message from the diff — don't guess at changes you can't see.
- One logical change per commit; if the diff spans unrelated changes, say so and suggest splitting.
- Match the repo's existing commit style if it clearly differs from Conventional Commits.
