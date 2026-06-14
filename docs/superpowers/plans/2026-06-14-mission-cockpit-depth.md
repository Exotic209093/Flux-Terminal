# Mission Control Cockpit Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Age badges, TodoWrite progress chips, and per-session Snooze on Mission Control.

**Architecture:** Parser captures `lastTodos`; monitor tracks `attnSince` + `todos`; `composeCards` surfaces them; `MissionCard` renders age + todo chip + snooze; `Notifier` gains a snooze map + IPC.

**Tech Stack:** Node, React, node:test. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-14-mission-cockpit-depth-design.md`

**Test command:** `npm test`. Build: `npm run build`. Main modules (parser/notify/missioncontrol) are CommonJS — tests `require()` them directly.

---

## Task 1: Parser — capture latest TodoWrite todos

**Files:**
- Modify: `src/main/parser.js`
- Test: `tests/parser-todos.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/parser-todos.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { parseSessionFile } = require('../src/main/parser')

function tmp(lines) {
  const f = path.join(os.tmpdir(), 'flux-todos-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.jsonl')
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n'))
  return f
}

test('parser captures the latest TodoWrite todos as lastTodos', () => {
  const f = tmp([
    { type: 'assistant', message: { id: 'm1', content: [
      { type: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos: [
        { content: 'first', status: 'completed' },
        { content: 'second', status: 'in_progress' }
      ] } }
    ] } },
    { type: 'assistant', message: { id: 'm2', content: [
      { type: 'tool_use', id: 't2', name: 'TodoWrite', input: { todos: [
        { content: 'first', status: 'completed' },
        { content: 'second', status: 'completed' },
        { content: 'third', status: 'pending' }
      ] } }
    ] } }
  ])
  const r = parseSessionFile(f, { timeline: true })
  assert.ok(Array.isArray(r.lastTodos))
  assert.strictEqual(r.lastTodos.length, 3) // latest TodoWrite wins
  assert.strictEqual(r.lastTodos[1].status, 'completed')
  assert.strictEqual(r.lastTodos[0].content, 'first')
})

test('no TodoWrite => lastTodos stays null', () => {
  const f = tmp([{ type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: 'hi' }] } }])
  const r = parseSessionFile(f)
  assert.strictEqual(r.lastTodos, null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/parser-todos.test.js`
Expected: FAIL (`r.lastTodos` is undefined).

- [ ] **Step 3: Implement**

In `src/main/parser.js`:
- In `freshModel`, after the `lastTool: null,` line add: `lastTodos: null, // latest TodoWrite todos (Mission Control chips)`.
- In `walkContent`, in the `case 'tool_use':` block, after the `model.tools[...]` / `model.lastTool` bookkeeping and before the `if (timeline) timeline.push(...)`, add:

```js
        if (block.name === 'TodoWrite' && block.input && Array.isArray(block.input.todos)) {
          model.lastTodos = block.input.todos.slice(0, 50).map((td) => ({
            content: truncate(td && td.content, 200),
            status: (td && td.status) || 'pending'
          }))
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/parser-todos.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/parser.js tests/parser-todos.test.js
git commit -m "feat(parser): capture latest TodoWrite todos as lastTodos

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Notifier snooze + IPC

**Files:**
- Modify: `src/main/notify.js`, `src/main/index.js`, `src/preload/index.js`
- Test: `tests/notify-snooze.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/notify-snooze.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const { Notifier } = require('../src/main/notify')

function mk(now) {
  const shown = []
  const n = new Notifier({
    getSettings: () => ({ notify: { turnError: 'toast' } }),
    getWindow: () => null,
    NotificationImpl: class { constructor(o) { this.o = o } on() {} show() { shown.push(this.o) } },
    now: () => now.t
  })
  return { n, shown }
}

test('snooze suppresses delivery until the deadline, then resumes', () => {
  const now = { t: 1000 }
  const { n, shown } = mk(now)
  n.snooze('s1', 1) // 1 minute
  n.deliver({ sessionId: 's1', title: 'x', event: { type: 'turn:error' } })
  assert.strictEqual(shown.length, 0) // snoozed
  now.t = 1000 + 61_000 // past the 1-min deadline
  n.deliver({ sessionId: 's1', title: 'x', event: { type: 'turn:error' } })
  assert.strictEqual(shown.length, 1) // resumed
})

test('snooze is per-session', () => {
  const now = { t: 5000 }
  const { n, shown } = mk(now)
  n.snooze('s1', 10)
  n.deliver({ sessionId: 's2', title: 'y', event: { type: 'turn:error' } })
  assert.strictEqual(shown.length, 1) // s2 not snoozed
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/notify-snooze.test.js`
Expected: FAIL (`n.snooze` is not a function).

- [ ] **Step 3: Implement in notify.js**

In the `Notifier` constructor, add: `this.snoozed = new Map()`.
Add a method:

```js
  snooze(sessionId, minutes) {
    if (!sessionId) return
    this.snoozed.set(sessionId, this.now() + (minutes || 30) * 60_000)
  }
```

In `deliver`, after the `if (setting.muted) return` line, add:

```js
    const snoozeUntil = this.snoozed.get(notice.sessionId)
    if (snoozeUntil && this.now() < snoozeUntil) return
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/notify-snooze.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the IPC + preload**

In `src/main/index.js`, near the other `notify:` handlers (e.g. after `notify:history`), add:

```js
ipcMain.handle('notify:snooze', (_e, { sessionId, minutes }) => {
  if (notifier) notifier.snooze(sessionId, minutes)
  return { ok: true }
})
```

In `src/preload/index.js`, in the `notify:` object, add:

```js
    snooze: (sessionId, minutes) => ipcRenderer.invoke('notify:snooze', { sessionId, minutes }),
```

- [ ] **Step 6: Verify build + tests**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3 && node --test tests/notify-snooze.test.js tests/notify.test.js`
Expected: build succeeds; snooze tests + existing notify tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/notify.js src/main/index.js src/preload/index.js tests/notify-snooze.test.js
git commit -m "feat(notify): per-session snooze (suppress toasts) + IPC

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Monitor attnSince + todos → card DTO

**Files:**
- Modify: `src/main/monitor.js`, `src/main/missioncontrol.js`
- Test: `tests/mission-cockpit.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/mission-cockpit.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const { composeCards, cardsChanged } = require('../src/main/missioncontrol')

function rec(over) {
  return { sessionId: 's', file: 'f', project: 'p', cwd: 'c', title: 't', model: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, subagents: { running: 0, total: 0 },
    lastSnippet: '', lastActivityMs: 1000, hasError: false, blocked: false, turnOpen: false, ...over }
}

test('composeCards surfaces attnSince and todos', () => {
  const cards = composeCards([rec({ attnSince: 500, todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] })], 2000)
  assert.strictEqual(cards[0].attnSince, 500)
  assert.strictEqual(cards[0].todos.length, 2)
})

test('cardsChanged flips when the todo signature changes', () => {
  const a = composeCards([rec({ todos: [{ content: 'x', status: 'pending' }] })], 1000)
  const b = composeCards([rec({ todos: [{ content: 'x', status: 'completed' }] })], 1000)
  assert.strictEqual(cardsChanged(a, b), true)
})

test('cardsChanged stays false when nothing relevant changed', () => {
  const a = composeCards([rec({ todos: [{ content: 'x', status: 'pending' }] })], 1000)
  const b = composeCards([rec({ todos: [{ content: 'x', status: 'pending' }] })], 1000)
  assert.strictEqual(cardsChanged(a, b), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mission-cockpit.test.js`
Expected: FAIL (`cards[0].attnSince` undefined; cardsChanged doesn't see todos).

- [ ] **Step 3: Implement in missioncontrol.js**

Add a helper near the top:

```js
function todoSig(todos) {
  if (!Array.isArray(todos)) return ''
  let done = 0
  for (const t of todos) if (t && t.status === 'completed') done++
  return done + '/' + todos.length
}
```

In `composeCards`, add to the returned card object (after `group`):

```js
      attnSince: r.attnSince || null,
      todos: r.todos || null
```

In `cardsChanged`, add to the per-card comparison (inside the `if (...)`):

```js
      a.lastSnippet !== b.lastSnippet ||
      todoSig(a.todos) !== todoSig(b.todos) ||
      a.attnSince !== b.attnSince
```

(Insert the two new conditions alongside the existing `a.lastSnippet !== b.lastSnippet` — keep that one.)

Export `todoSig`: change the module.exports to include it.

- [ ] **Step 4: Implement in monitor.js**

- In `_ensure`'s record defaults, add `attnSince: null,` and `todos: null,`.
- In the parse block (where `rec.lastSnippet = snippetOf(parsed)` etc.), add: `rec.todos = parsed.lastTodos || null`.
- After the attention block (after the `if (rec.hasError && rec._errorAt && ...)` line), add:

```js
      const needsYou = rec.hasError || rec.blocked
      if (needsYou && !rec.attnSince) rec.attnSince = now
      else if (!needsYou) rec.attnSince = null
```

- [ ] **Step 5: Run tests + existing missioncontrol/monitor tests**

Run: `node --test tests/mission-cockpit.test.js tests/missioncontrol.test.js tests/monitor.test.js`
Expected: PASS (new + existing).

- [ ] **Step 6: Commit**

```bash
git add src/main/missioncontrol.js src/main/monitor.js tests/mission-cockpit.test.js
git commit -m "feat(mission): attnSince age + todos on card DTO

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: MissionCard — age badge, todo chip, snooze

**Files:**
- Modify: `src/renderer/src/components/MissionCard.jsx`, `src/renderer/src/index.css`

- [ ] **Step 1: Render age badge, todo chip, and snooze button**

Replace the contents of `MissionCard` (the returned JSX) so it adds the three affordances. Replace `src/renderer/src/components/MissionCard.jsx` with:

```jsx
// src/renderer/src/components/MissionCard.jsx
import { estimateCost, formatUSD } from '../lib/pricing'

const CHIP_LABEL = { error: 'error', blocked: 'needs you', running: 'running', finished: 'done', idle: 'idle' }

function rel(ms, now) {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.round(s / 60) + 'm'
  if (s < 86400) return Math.round(s / 3600) + 'h'
  return Math.round(s / 86400) + 'd'
}

function todoSummary(todos) {
  const done = todos.filter((t) => t.status === 'completed').length
  const active = todos.find((t) => t.status === 'in_progress')
  return { done, total: todos.length, active: active ? active.content : null }
}

export default function MissionCard({ card, now, onOpen }) {
  const todos = Array.isArray(card.todos) && card.todos.length ? todoSummary(card.todos) : null
  return (
    <div className={'mcard ' + card.group} onClick={() => onOpen(card)}>
      <div className="mcard-top">
        <span className="mcard-title" title={card.title}>{card.title}</span>
        {card.attnSince && card.group === 'needsYou' && (
          <span className="mcard-age" title="time waiting on you">⏱ {rel(card.attnSince, now)}</span>
        )}
        <span className={'mcard-chip ' + card.status}>{CHIP_LABEL[card.status]}</span>
      </div>
      <div className="mcard-proj" title={card.cwd}>{card.cwd || card.project}</div>
      <div className="mcard-snippet">{card.lastSnippet || '—'}</div>
      {todos && (
        <div className="mcard-todos" title={todos.active || ''}>
          ✓ {todos.done}/{todos.total}{todos.active ? ' · ' + todos.active : ''}
        </div>
      )}
      <div className="mcard-meta">
        <span>{formatUSD(estimateCost(card.usage, card.model).total)}</span>
        {card.model && <span>{card.model.replace(/^claude-/, '')}</span>}
        {card.subagents.running > 0 && <span>▶ {card.subagents.running}</span>}
        <button
          className="mcard-snooze"
          title="Snooze notifications for 30 min"
          onClick={(e) => { e.stopPropagation(); window.flux.notify.snooze(card.sessionId, 30) }}
        >
          😴
        </button>
        <span style={{ marginLeft: 'auto' }}>{rel(card.lastActivityMs, now)} ago</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Styles**

In `src/renderer/src/index.css`, append:

```css
.mcard-age { color: #f9e2af; font-size: 11px; margin-left: auto; margin-right: 6px; }
.mcard-todos { font-size: 11px; color: var(--text-faint); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mcard-snooze { background: none; border: none; cursor: pointer; font-size: 12px; padding: 0 4px; opacity: 0.7; }
.mcard-snooze:hover { opacity: 1; }
```

- [ ] **Step 3: Verify build**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3`
Expected: build succeeds.

- [ ] **Step 4: Full suite**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm test 2>&1 | tail -5`
Expected: all pass (288 prior + 2 todos + 2 snooze + 3 cockpit = 295).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/MissionCard.jsx src/renderer/src/index.css
git commit -m "feat(mission): age badge, todo progress chip, snooze button on cards

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** parser lastTodos → Task 1; Notifier snooze + IPC + preload → Task 2; monitor attnSince + todos and composeCards/cardsChanged → Task 3; MissionCard age badge + todo chip + snooze → Task 4. Interrupt-from-card + OS toast buttons deferred (out of scope per spec); ntfy push moved to #8.

**Placeholder scan:** every step has full code + commands.

**Type/name consistency:** `lastTodos` (parser) → `rec.todos` (monitor) → `card.todos` (composeCards) → `MissionCard`; `todoSig` defined+exported in missioncontrol and used in cardsChanged; `snooze(sessionId, minutes)` consistent across notify/IPC/preload/MissionCard.

**Notes for executor:** Tasks 1-2 independent; 3 depends on 1 (reads `parsed.lastTodos`); 4 depends on 2+3. Commit after each. No push/tag. Main-module tests use `require()`; the parser/notify/missioncontrol are CommonJS.
