---
name: explain-this
description: Explain a file, function, or selection clearly — what it does, why, and the gotchas. Use when the user asks "what does this do", "explain this", or "walk me through".
---

# Explain this

When the user asks you to explain code:

1. Read the target (file, function, or the lines they point at). If they didn't
   specify, ask which file/symbol.
2. Lead with a one-sentence summary of its **purpose** — the job it does for the
   rest of the system, not a line-by-line restatement.
3. Then cover, briefly:
   - **Inputs → outputs** and any side effects (I/O, state, network).
   - **Control flow** worth knowing (the main path + notable branches).
   - **Gotchas**: edge cases, assumptions, foot-guns, anything surprising.
4. Match the depth to the ask — a quick "what is this" gets 3 lines; "walk me
   through it" gets a short tour. Use the codebase's own terms.

Don't pad. If something is genuinely unclear or looks buggy, say so plainly.
