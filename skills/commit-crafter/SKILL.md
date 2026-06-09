---
name: commit-crafter
description: Write a clear, conventional git commit message from the staged changes. Use when the user asks to commit, or for help writing a commit message.
---

# Commit crafter

When the user asks for a commit (or a commit message):

1. Inspect what's staged: `git diff --staged --stat` then `git diff --staged`.
   If nothing is staged, say so and ask whether to `git add -A` first.
2. Write a message in this shape:
   - **Subject** (≤ 72 chars, imperative mood): `<type>: <what changed>`
     where type ∈ feat, fix, refactor, docs, test, chore, perf, build.
   - A blank line, then a short body explaining **why** (not just what), wrapping at ~72 cols.
   - Reference issues/PRs if the user mentions them.
3. Show the message and let the user approve before running `git commit`.

Keep it honest: describe what the diff actually does, never invent scope. One logical
change per commit — if the diff spans unrelated changes, suggest splitting it.
