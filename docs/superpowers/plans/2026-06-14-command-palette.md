# Command Palette + Prompt History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** A Ctrl+K fuzzy palette over sessions, actions, and saved prompts.

**Architecture:** Pure `lib/fuzzy.js` + `lib/palette.js`; `CommandPalette.jsx` overlay; wired into `App` with a `runCommand` dispatcher; new-chat prefill via a `startNewChat(cwd, draft)` arg.

**Tech Stack:** React, node:test. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-14-command-palette-design.md`

**Test command:** `npm test`. Build: `npm run build`. `src/renderer/src/lib/` is ESM — new lib modules `export {}`; tests use dynamic `import()` (copy `tests/composerQueue.test.js`).

---

## Task 1: fuzzy matcher

**Files:**
- Create: `src/renderer/src/lib/fuzzy.js`, `tests/fuzzy.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/fuzzy.test.js`:

```js
const { test, describe, before } = require('node:test')
const assert = require('node:assert')

describe('fuzzy', () => {
  let fuzzyScore, fuzzyFilter
  before(async () => {
    const mod = await import('../src/renderer/src/lib/fuzzy.js')
    ;({ fuzzyScore, fuzzyFilter } = mod)
  })

  test('ranks exact > prefix > substring > subsequence > none', () => {
    assert.ok(fuzzyScore('abc', 'abc') > fuzzyScore('abc', 'abcdef'))
    assert.ok(fuzzyScore('abc', 'abcdef') > fuzzyScore('abc', 'xxabcxx'))
    assert.ok(fuzzyScore('abc', 'xxabcxx') > fuzzyScore('abc', 'a1b2c3'))
    assert.strictEqual(fuzzyScore('abc', 'xyz'), 0)
  })

  test('empty query scores 1 (keeps everything)', () => {
    assert.strictEqual(fuzzyScore('', 'anything'), 1)
  })

  test('fuzzyFilter drops non-matches and sorts by score', () => {
    const items = ['Settings', 'Stats', 'Skills', 'Mission']
    const out = fuzzyFilter('s', items)
    assert.ok(out.length >= 3)
    assert.ok(!out.includes('Mission'))
  })

  test('fuzzyFilter with empty query returns all (copy)', () => {
    const items = ['a', 'b']
    const out = fuzzyFilter('', items)
    assert.deepStrictEqual(out, items)
    assert.notStrictEqual(out, items)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/fuzzy.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/fuzzy.js`:

```js
// Lightweight fuzzy matcher for the command palette. No dependency.

function fuzzyScore(query, text) {
  if (query == null || query === '') return 1
  const q = String(query).toLowerCase()
  const t = String(text || '').toLowerCase()
  if (!t) return 0
  if (t === q) return 1000
  if (t.startsWith(q)) return 800
  const sub = t.indexOf(q)
  if (sub !== -1) return 600 - sub
  // subsequence with word-start bonuses and gap penalties
  let ti = 0
  let score = 100
  for (const c of q) {
    const found = t.indexOf(c, ti)
    if (found === -1) return 0
    if (found === 0 || /[\s/_\-.]/.test(t[found - 1])) score += 8
    score -= found - ti
    ti = found + 1
  }
  return Math.max(1, score)
}

function fuzzyFilter(query, items, keyFn) {
  const key = keyFn || ((x) => x)
  if (!query) return items.slice()
  const scored = []
  for (const it of items) {
    const s = fuzzyScore(query, key(it))
    if (s > 0) scored.push({ it, s })
  }
  scored.sort((a, b) => b.s - a.s)
  return scored.map((x) => x.it)
}

export { fuzzyScore, fuzzyFilter }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/fuzzy.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/fuzzy.js tests/fuzzy.test.js
git commit -m "feat(palette): fuzzy matcher

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: palette command list

**Files:**
- Create: `src/renderer/src/lib/palette.js`, `tests/palette.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/palette.test.js`:

```js
const { test, describe, before } = require('node:test')
const assert = require('node:assert')

describe('palette', () => {
  let buildCommands, filterCommands, STATIC_ACTIONS
  before(async () => {
    const mod = await import('../src/renderer/src/lib/palette.js')
    ;({ buildCommands, filterCommands, STATIC_ACTIONS } = mod)
  })

  test('buildCommands merges actions, sessions, prompts', () => {
    const cmds = buildCommands({
      sessions: [{ sessionId: 's1', title: 'Fix the parser', cwd: '/p', project: 'flux' }],
      prompts: [{ name: 'standup', body: 'write my standup' }]
    })
    assert.strictEqual(cmds.length, STATIC_ACTIONS.length + 2)
    assert.ok(cmds.find((c) => c.kind === 'session' && c.sessionId === 's1'))
    assert.ok(cmds.find((c) => c.kind === 'prompt' && c.body === 'write my standup'))
  })

  test('filterCommands fuzzy-filters by label and caps results', () => {
    const cmds = buildCommands({ sessions: [{ sessionId: 's', title: 'Parser work', cwd: '/p' }] })
    const out = filterCommands('parser', cmds)
    assert.ok(out.some((c) => c.label === 'Parser work'))
    assert.ok(out.length <= 30)
  })

  test('empty query returns the full list (capped)', () => {
    const cmds = buildCommands({})
    const out = filterCommands('', cmds)
    assert.strictEqual(out.length, Math.min(30, cmds.length))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/palette.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/palette.js`:

```js
import { fuzzyFilter } from './fuzzy'

const STATIC_ACTIONS = [
  { kind: 'action', label: 'New chat', action: 'new-chat' },
  { kind: 'action', label: 'Terminal', action: 'view:terminal' },
  { kind: 'action', label: 'Stats & achievements', action: 'view:stats' },
  { kind: 'action', label: 'Skills', action: 'view:skills' },
  { kind: 'action', label: 'Mission Control', action: 'view:mission' },
  { kind: 'action', label: 'Settings', action: 'view:settings' },
  { kind: 'action', label: 'Search sessions', action: 'open-search' },
  { kind: 'action', label: 'Launch tracked claude', action: 'launch-tracked' }
]

function buildCommands({ sessions = [], prompts = [] } = {}) {
  const cmds = STATIC_ACTIONS.slice()
  for (const s of sessions) {
    cmds.push({ kind: 'session', label: s.title || '(untitled session)', sub: s.project || s.cwd || '', sessionId: s.sessionId })
  }
  for (const p of prompts) {
    cmds.push({ kind: 'prompt', label: p.name, sub: (p.body || '').replace(/\s+/g, ' ').slice(0, 60), body: p.body })
  }
  return cmds
}

function filterCommands(query, commands, limit = 30) {
  return fuzzyFilter(query, commands, (c) => c.label + ' ' + (c.sub || '')).slice(0, limit)
}

export { STATIC_ACTIONS, buildCommands, filterCommands }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/palette.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/palette.js tests/palette.test.js
git commit -m "feat(palette): command list builder + filter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: CommandPalette overlay

**Files:**
- Create: `src/renderer/src/components/CommandPalette.jsx`
- Modify: `src/renderer/src/index.css`

- [ ] **Step 1: Create the component**

Create `src/renderer/src/components/CommandPalette.jsx`:

```jsx
import { useState, useEffect, useRef } from 'react'
import { filterCommands } from '../lib/palette'

const GLYPH = { action: '⚡', session: '💬', prompt: '✎' }

export default function CommandPalette({ commands, onRun, onClose }) {
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef(null)
  const results = filterCommands(query, commands)
  const selected = Math.max(0, Math.min(sel, results.length - 1))

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus()
  }, [])
  useEffect(() => {
    setSel(0)
  }, [query])

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[selected]) onRun(results[selected]) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Jump to a session, run an action, launch a prompt…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list">
          {results.length === 0 && <div className="palette-empty">No matches.</div>}
          {results.map((c, i) => (
            <div
              key={c.kind + ':' + (c.sessionId || c.action || c.label) + ':' + i}
              className={'palette-row' + (i === selected ? ' sel' : '')}
              onMouseEnter={() => setSel(i)}
              onClick={() => onRun(c)}
            >
              <span className="palette-glyph">{GLYPH[c.kind] || '•'}</span>
              <span className="palette-label">{c.label}</span>
              {c.sub && <span className="palette-sub">{c.sub}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Styles**

In `src/renderer/src/index.css`, append:

```css
.palette-overlay { position: fixed; inset: 0; z-index: 60; display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; background: rgba(5,7,12,0.55); }
.palette { width: 600px; max-width: 92vw; background: var(--panel, #11151c); border: 1px solid var(--border, #232a36); border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); overflow: hidden; }
.palette-input { width: 100%; box-sizing: border-box; background: transparent; border: none; border-bottom: 1px solid var(--border, #232a36); color: var(--text); font-size: 15px; padding: 14px 16px; outline: none; }
.palette-list { max-height: 50vh; overflow-y: auto; }
.palette-row { display: flex; align-items: center; gap: 10px; padding: 8px 16px; cursor: pointer; }
.palette-row.sel { background: rgba(137,180,250,0.15); }
.palette-glyph { width: 18px; text-align: center; opacity: 0.8; }
.palette-label { color: var(--text); }
.palette-sub { margin-left: auto; color: var(--text-faint); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 45%; }
.palette-empty { padding: 16px; color: var(--text-faint); }
```

- [ ] **Step 3: Verify build**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/CommandPalette.jsx src/renderer/src/index.css
git commit -m "feat(palette): Ctrl+K command palette overlay

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire into App + new-chat prefill

**Files:**
- Modify: `src/renderer/src/App.jsx`, `src/renderer/src/components/SessionView.jsx`

- [ ] **Step 1: App — state, prompts, Ctrl+K, render**

In `src/renderer/src/App.jsx`:
- Add imports: `import CommandPalette from './components/CommandPalette'` and `import { buildCommands } from './lib/palette'`.
- Add state: `const [paletteOpen, setPaletteOpen] = useState(false)` and `const [prompts, setPrompts] = useState([])`.
- Load prompts once: `useEffect(() => { window.flux.prompts.list().then((r) => { if (r && r.ok) setPrompts(r.prompts) }) }, [])`.
- In the global keydown effect (the one handling Ctrl+Shift+F / Ctrl+M / Ctrl+,), add a branch:

```jsx
      } else if (e.ctrlKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
```

- Add the dispatcher (after `startNewChat`/`openById` are defined):

```jsx
  const runCommand = useCallback(
    (item) => {
      setPaletteOpen(false)
      if (item.kind === 'session') return openById(item.sessionId)
      if (item.kind === 'prompt') return startNewChat('', item.body)
      switch (item.action) {
        case 'new-chat': return startNewChat()
        case 'open-search': return setSearchOpen(true)
        case 'launch-tracked': return setView('terminal')
        default:
          if (item.action && item.action.startsWith('view:')) setView(item.action.slice(5))
      }
    },
    [openById, startNewChat]
  )
```

- Render the palette as the last child of `app-shell` (near the WelcomeScreen / SearchOverlay renders):

```jsx
      {paletteOpen && (
        <CommandPalette commands={buildCommands({ sessions, prompts })} onRun={runCommand} onClose={() => setPaletteOpen(false)} />
      )}
```

- [ ] **Step 2: startNewChat accepts an initial draft**

In `src/renderer/src/App.jsx`, update `startNewChat` to carry a draft:

```jsx
  const startNewChat = useCallback((cwd, initialDraft) => {
    const dir = typeof cwd === 'string' ? cwd : ''
    setSelected(null)
    setDetail(null)
    setSendState(null)
    setSendError(null)
    setNewChat({ cwd: dir, draft: typeof initialDraft === 'string' ? initialDraft : '' })
    setView('session')
  }, [])
```

- [ ] **Step 3: SessionView seeds the draft once**

In `src/renderer/src/components/SessionView.jsx`, add a ref + effect near the other state:

```jsx
  const seededDraftFor = useRef(null)
  useEffect(() => {
    if (newChat && newChat.draft && seededDraftFor.current !== newChat) {
      seededDraftFor.current = newChat
      setDraft(newChat.draft)
    }
  }, [newChat])
```

(This seeds the composer once when a new chat carries a prefilled prompt, without clobbering subsequent edits.)

- [ ] **Step 4: Verify build + full suite**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3 && npm test 2>&1 | tail -5`
Expected: build succeeds; all tests pass (295 prior + 4 fuzzy + 3 palette = 302).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.jsx src/renderer/src/components/SessionView.jsx
git commit -m "feat(palette): wire Ctrl+K palette into App + new-chat prompt prefill

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** fuzzy matcher → Task 1; palette command list → Task 2; CommandPalette overlay → Task 3; App wiring + Ctrl+K + runCommand + new-chat prefill → Task 4. Full prompt-history search remains Ctrl+Shift+F (FTS), per spec.

**Placeholder scan:** complete code for new files; precise edits for App/SessionView.

**Type/name consistency:** `fuzzyScore`/`fuzzyFilter` (Task 1) used by `palette.js` (Task 2) + tests; `buildCommands`/`filterCommands`/`STATIC_ACTIONS` consumed by CommandPalette (Task 3) + App (Task 4) + tests; `runCommand` item shapes (`kind`/`action`/`sessionId`/`body`) match `buildCommands` output; `startNewChat(cwd, initialDraft)` matches the existing call sites (which pass 0 or 1 string arg — still valid).

**Notes for executor:** Tasks 1-2 independent (2 imports 1); 3 depends on 2; 4 depends on 2+3. Commit after each. Ensure the new Ctrl+K branch is added to the SAME keydown effect and doesn't collide with the terminal-shortcut handler (that one gates on `active`/terminal view; Ctrl+K is app-global here). No push/tag.
```
