# Correctness + Security Week Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five verified audit findings: token usage overcounted 2.4–2.75x, broken turn detection, the claude-spawn command-injection chain + renderer-escape hardening, the sendChild concurrency bug, and bundled skills missing from the installed app.

**Architecture:** Parser gains message-id usage dedupe, real-prompt counting, and turn_duration tracking (shared by batch parse and live tail — same accumulator). Attention gains an exact-duration "td mode" with legacy fallback so existing transcripts and tests keep working. The claude child-process plumbing moves out of index.js into a new `resume.js` (validated inputs, resolved binary, per-sessionId child Map). createWindow + appprotocol get the ~15-line hardening block. electron-builder ships `skills/` via extraResources.

**Tech Stack:** Electron 42 main process (CommonJS), node:test, no new dependencies.

**Branch:** `fix/correctness-security-week` (already created). Working dir: `C:\Users\james\Projects\Flux Terminal`.

**Verified facts this plan relies on (measured on this machine, 2026-06-11):**
- Duplicate-`message.id` assistant records carry byte-identical usage objects (31 same / 0 differing on a live transcript) → first-occurrence-wins dedupe is correct.
- `{"type":"system","subtype":"turn_duration","durationMs":260620,...}` records exist (CLI 2.1.170).
- Real user records: string content; tool_result carriers dominate; `isMeta:true` marks injected records.

**Conventions (do not deviate):**
- Every new `src/main/*.js` module MUST be added to `electron.vite.config.mjs` rollupOptions inputs — build succeeds without it but the app crashes at boot.
- Tests: node:test + `assert`, dependency injection over mocking, run with `npm test` (expect all green; 173 before this plan).
- All IPC handlers return `{ ok, error }`, never throw across the bridge.

---

### Task 1: Parser — count usage once per message.id

**Files:**
- Modify: `src/main/parser.js`
- Test: `tests/parser-usage.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/parser-usage.test.js`:

```js
// tests/parser-usage.test.js
const test = require('node:test')
const assert = require('node:assert')
const { freshModel, applyEvent } = require('../src/main/parser')

function assistantRecord(id, usage, model = 'claude-test-1') {
  return { type: 'assistant', message: { id, model, usage, content: [{ type: 'text', text: 'hi' }] } }
}
const USAGE = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 5 }

test('usage is counted once per message.id (streamed blocks share an id with identical usage)', () => {
  const m = freshModel(null)
  applyEvent(assistantRecord('msg_1', USAGE), m, null)
  applyEvent(assistantRecord('msg_1', USAGE), m, null)
  applyEvent(assistantRecord('msg_1', USAGE), m, null)
  assert.strictEqual(m.usage.output, 100)
  assert.strictEqual(m.usage.input, 10)
  assert.strictEqual(m.usage.cacheRead, 1000)
  assert.strictEqual(m.usage.cacheCreation, 5)
  assert.strictEqual(m.counts.assistant, 1)
})

test('distinct message ids accumulate normally', () => {
  const m = freshModel(null)
  applyEvent(assistantRecord('msg_1', USAGE), m, null)
  applyEvent(assistantRecord('msg_2', USAGE), m, null)
  assert.strictEqual(m.usage.output, 200)
  assert.strictEqual(m.counts.assistant, 2)
})

test('records without a message id are each counted (synthetic/error records)', () => {
  const m = freshModel(null)
  applyEvent({ type: 'assistant', message: { usage: USAGE, content: [] } }, m, null)
  applyEvent({ type: 'assistant', message: { usage: USAGE, content: [] } }, m, null)
  assert.strictEqual(m.usage.output, 200)
  assert.strictEqual(m.counts.assistant, 2)
})

test('lastContextTokens tracks the newest message, not duplicates', () => {
  const m = freshModel(null)
  applyEvent(assistantRecord('msg_1', { input_tokens: 50, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), m, null)
  applyEvent(assistantRecord('msg_2', { input_tokens: 70, output_tokens: 1, cache_read_input_tokens: 30, cache_creation_input_tokens: 0 }), m, null)
  assert.strictEqual(m.lastContextTokens, 100)
})

test('timeline items are still collected for duplicate-id records (each block renders)', () => {
  const m = freshModel(null)
  const tl = []
  applyEvent(assistantRecord('msg_1', USAGE), m, tl)
  applyEvent(assistantRecord('msg_1', USAGE), m, tl)
  assert.strictEqual(tl.length, 2)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test` (from `C:\Users\james\Projects\Flux Terminal`)
Expected: the first test FAILS with `m.usage.output` = 300 (and `counts.assistant` = 3); all pre-existing tests pass.

- [ ] **Step 3: Implement the dedupe in parser.js**

In `freshModel(file)` add one internal field after `__models: new Set()`:

```js
    __usageIds: new Set(), // message.ids already counted (streamed blocks share an id)
```

Replace the `case 'assistant':` block in `applyEvent` with:

```js
    case 'assistant': {
      const msg = o.message || {}
      // Claude Code writes one record per streamed content block; records of the
      // same message share message.id with byte-identical usage. Count each
      // message once — otherwise tokens inflate 2.4-2.75x (verified 2026-06-11).
      const msgId = msg.id || null
      if (!msgId || !model.__usageIds.has(msgId)) {
        if (msgId) model.__usageIds.add(msgId)
        model.counts.assistant++
        if (msg.model) model.__models.add(msg.model)
        addUsage(model.usage, msg.usage)
        const u = msg.usage
        if (u) {
          // Prompt tokens for this turn = current context fill; keep the latest.
          model.lastContextTokens =
            (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
        }
      }
      walkContent(o, model, timeline, 'assistant')
      break
    }
```

In `finalize(model)` add, next to the `__models` delete:

```js
  delete model.__usageIds
```

Note for live.js compatibility (no live.js change needed): `LiveTracker._emit` calls `finalize({ ...this.model, __models: this.model.__models })` — the spread copies the `__usageIds` reference into the clone, finalize deletes the key from the clone only, and the original accumulator keeps deduping across ticks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: ALL tests pass (new file + the existing 173).

- [ ] **Step 5: Commit**

```powershell
git add tests/parser-usage.test.js src/main/parser.js
git commit -m "fix(parser): count usage once per message.id (was inflating tokens 2.4-2.75x)"
```

---

### Task 2: Parser — real-prompt counting + turn_duration tracking

**Files:**
- Modify: `src/main/parser.js`
- Test: `tests/parser-turns.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/parser-turns.test.js`:

```js
// tests/parser-turns.test.js
const test = require('node:test')
const assert = require('node:assert')
const { freshModel, applyEvent } = require('../src/main/parser')

test('tool_result carrier user records are not counted as user prompts', () => {
  const m = freshModel(null)
  applyEvent({ type: 'user', message: { content: 'do the thing' } }, m, null)
  applyEvent({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }, m, null)
  applyEvent({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok2' }] } }, m, null)
  assert.strictEqual(m.counts.user, 1)
  assert.strictEqual(m.counts.toolResult, 2) // still tallied + rendered
})

test('isMeta user records are not prompts', () => {
  const m = freshModel(null)
  applyEvent({ type: 'user', isMeta: true, message: { content: 'injected context' } }, m, null)
  assert.strictEqual(m.counts.user, 0)
})

test('empty/whitespace string content is not a prompt', () => {
  const m = freshModel(null)
  applyEvent({ type: 'user', message: { content: '   ' } }, m, null)
  assert.strictEqual(m.counts.user, 0)
})

test('image-only array content counts as a prompt (pasted screenshot)', () => {
  const m = freshModel(null)
  applyEvent({ type: 'user', message: { content: [{ type: 'image', source: { type: 'base64', data: 'x' } }] } }, m, null)
  assert.strictEqual(m.counts.user, 1)
})

test('turn_duration system records are tracked', () => {
  const m = freshModel(null)
  applyEvent({ type: 'system', subtype: 'turn_duration', durationMs: 260620 }, m, null)
  applyEvent({ type: 'system', subtype: 'turn_duration', durationMs: 41000 }, m, null)
  assert.strictEqual(m.turnDurationCount, 2)
  assert.strictEqual(m.lastTurnDurationMs, 41000)
  assert.strictEqual(m.counts.system, 2)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — carrier test sees `counts.user` = 3; turn_duration test sees `m.turnDurationCount` undefined.

- [ ] **Step 3: Implement in parser.js**

In `freshModel(file)` add after `lastUserPrompt: null,`:

```js
    turnDurationCount: 0, // system/turn_duration records seen (exact turn closes)
    lastTurnDurationMs: 0,
```

Add this helper above `applyEvent`:

```js
/**
 * Is this user record a real human prompt? Most type:'user' records (~87%
 * measured) are tool_result carriers, and isMeta marks injected context —
 * neither opens a turn nor counts as a message.
 */
function isRealUserPrompt(o) {
  if (o.isMeta) return false
  const content = o.message && o.message.content
  if (typeof content === 'string') return content.trim().length > 0
  if (Array.isArray(content)) return content.length > 0 && !content.some((b) => b && b.type === 'tool_result')
  return false
}
```

In `applyEvent`, replace the `case 'user':` block:

```js
    case 'user':
      if (isRealUserPrompt(o)) model.counts.user++
      walkContent(o, model, timeline, 'user')
      break
```

Replace the `case 'system':` block:

```js
    case 'system':
      model.counts.system++
      if (o.subtype === 'turn_duration') {
        model.turnDurationCount++
        if (typeof o.durationMs === 'number') model.lastTurnDurationMs = o.durationMs
      }
      break
```

Export the helper (extend the existing module.exports line):

```js
module.exports = { parseSessionFile, parseLine, freshModel, applyEvent, finalize, isErrorRecord, isRealUserPrompt }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: ALL pass. (parser-images tests stay green: image/text user records have no tool_result block → still prompts; carrier asserts don't touch counts.user.)

- [ ] **Step 5: Commit**

```powershell
git add tests/parser-turns.test.js src/main/parser.js
git commit -m "fix(parser): only real prompts count as user messages; track turn_duration records"
```

---

### Task 3: Attention — exact turn durations (td mode) + monitor wiring

**Files:**
- Modify: `src/main/attention.js`
- Modify: `src/main/monitor.js:114-130`
- Test: `tests/attention.test.js` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `tests/attention.test.js`:

```js
// ---- turn_duration ("td") mode: exact closes from system records --------------
function tdObs(ts, mtimeMs, u, a, tdCount, tdMs, e = 0) {
  return { ts, mtimeMs, userCount: u, assistantCount: a, errorCount: e, turnDurationCount: tdCount, lastTurnDurationMs: tdMs }
}

test('td mode: mid-turn assistant records do not close the turn; the turn_duration record does, with the exact duration', () => {
  const s = createAttentionState()
  observe(s, tdObs(0, 0, 5, 5, 3, 0)) // baseline on a transcript that writes turn_duration
  observe(s, tdObs(1000, 1000, 6, 5, 3, 0)) // new prompt → turn opens
  const mid = observe(s, tdObs(5000, 5000, 6, 6, 3, 0)) // first reply lands mid-turn
  assert.deepStrictEqual(mid, [])
  assert.strictEqual(s.turnOpen, true)
  const done = observe(s, tdObs(9000, 9000, 6, 8, 4, 260620)) // CLI wrote turn_duration
  assert.strictEqual(done.length, 1)
  assert.strictEqual(done[0].type, 'turn:finished')
  assert.strictEqual(done[0].durationMs, 260620)
  assert.strictEqual(s.turnOpen, false)
})

test('td mode: a short exact duration does not notify', () => {
  const s = createAttentionState()
  observe(s, tdObs(0, 0, 0, 0, 1, 0))
  observe(s, tdObs(1000, 1000, 1, 0, 1, 0))
  const done = observe(s, tdObs(9000, 9000, 1, 1, 2, 5000)) // 5s < MIN_TURN_MS
  assert.deepStrictEqual(done, [])
  assert.strictEqual(s.turnOpen, false)
})

test('td mode: blocked still fires after assistant records stream mid-turn', () => {
  const s = createAttentionState()
  observe(s, tdObs(0, 0, 0, 0, 1, 0))
  observe(s, tdObs(1000, 1000, 1, 0, 1, 0)) // turn opens
  observe(s, tdObs(2000, 2000, 1, 1, 1, 0)) // reply streams (write at ts=2000), turn stays open
  const ev = observe(s, tdObs(2000 + BLOCKED_MS + 1, 2000, 1, 1, 1, 0)) // silence past BLOCKED_MS
  assert.strictEqual(ev.length, 1)
  assert.strictEqual(ev[0].type, 'blocked')
})

test('legacy transcripts (no turn_duration anywhere) keep the assistant-close behavior', () => {
  const s = createAttentionState()
  observe(s, obs(0, 0, 0, 0))
  observe(s, obs(1000, 1000, 1, 0))
  const ev = observe(s, obs(1000 + MIN_TURN_MS + 1, 5000, 1, 1))
  assert.strictEqual(ev.length, 1)
  assert.strictEqual(ev[0].type, 'turn:finished')
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test`
Expected: the first td test FAILS (`mid` contains a turn:finished — assistant branch closed the turn). Existing attention tests pass.

- [ ] **Step 3: Implement td mode in attention.js**

In `createAttentionState()` add after `lastErrorCount: 0,`:

```js
    lastTurnDurationCount: 0,
    tdMode: false, // transcript writes turn_duration records → exact close signal
```

In `observe`, after `const ts = obs.ts` add:

```js
  const tdCount = obs.turnDurationCount || 0
```

In the baseline branch, before `state.lastMtime = obs.mtimeMs` add:

```js
    state.lastTurnDurationCount = tdCount
    if (tdCount > 0) state.tdMode = true
```

Between the error branch and the assistant branch, insert:

```js
  // Exact close: the CLI wrote a turn_duration record with the real duration.
  // Once any td record is seen, assistant records (which arrive mid-turn,
  // between tool calls) stop closing turns — only this branch does.
  if (tdCount > state.lastTurnDurationCount) {
    state.tdMode = true
    if (state.turnOpen) {
      const durationMs =
        typeof obs.lastTurnDurationMs === 'number' && obs.lastTurnDurationMs > 0
          ? obs.lastTurnDurationMs
          : ts - state.turnOpenedAt
      if (durationMs >= MIN_TURN_MS) events.push({ type: 'turn:finished', ts, durationMs })
      state.turnOpen = false
    }
  }
```

Change the assistant-close branch condition from:

```js
  if (obs.assistantCount > state.lastAssistantCount && state.turnOpen) {
```

to:

```js
  if (!state.tdMode && obs.assistantCount > state.lastAssistantCount && state.turnOpen) {
```

At the bottom, next to the other `state.last*` updates, add:

```js
  state.lastTurnDurationCount = tdCount
```

- [ ] **Step 4: Wire monitor.js**

In `_tick()`, where `rec._parsedCounts` is set (currently `monitor.js:114`), add two lines after it:

```js
          rec._turnDurationCount = parsed.turnDurationCount || 0
          rec._lastTurnDurationMs = parsed.lastTurnDurationMs || 0
```

In the `observe(rec._attn, { ... })` call, add two fields after `errorCount`:

```js
          errorCount: rec._errorCount || 0,
          turnDurationCount: rec._turnDurationCount || 0,
          lastTurnDurationMs: rec._lastTurnDurationMs || 0
```

(Existing monitor tests pass fakes without `turnDurationCount` → 0 → legacy mode → unchanged behavior.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: ALL pass, including all pre-existing attention + monitor tests.

- [ ] **Step 6: Commit**

```powershell
git add tests/attention.test.js src/main/attention.js src/main/monitor.js
git commit -m "fix(attention): exact turn durations from turn_duration records (notifications now fire for long turns)"
```

---

### Task 4: resume.js — validated, Map-tracked claude child processes

**Files:**
- Create: `src/main/resume.js`
- Modify: `src/main/index.js` (delete lines 333-481 region: sendChild globals + session:send/session:new/session:interrupt bodies; rewire)
- Modify: `electron.vite.config.mjs` (add `resume` input — MANDATORY, see conventions)
- Test: `tests/resume.test.js` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/resume.test.js`:

```js
// tests/resume.test.js
const test = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('node:events')
const { ClaudeRunner, isValidSessionId, isValidModel, needsShell, resolveClaudeBin } = require('../src/main/resume')

const UUID_A = '11111111-2222-3333-4444-555555555555'
const UUID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function fakeChild() {
  const c = new EventEmitter()
  c.stderr = new EventEmitter()
  c.stdin = { written: [], write(d) { this.written.push(d) }, end() { this.ended = true } }
  c.killed = false
  c.kill = () => { c.killed = true }
  return c
}

function runnerWith(overrides = {}) {
  const spawned = [] // { bin, args, opts, child }
  const statuses = [] // { sessionId, state, error }
  const runner = new ClaudeRunner({
    bin: 'C:\\tools\\claude.exe',
    spawnImpl: (bin, args, opts) => { const child = fakeChild(); spawned.push({ bin, args, opts, child }); return child },
    onStatus: (sessionId, state, error) => statuses.push({ sessionId, state, error }),
    now: () => 1_000_000,
    fsImpl: { existsSync: () => true, statSync: () => ({ mtimeMs: 0 }) },
    findFile: () => null,
    timeoutMs: 999_999,
    ...overrides
  })
  return { runner, spawned, statuses }
}

test('validators: UUID session ids, conservative model charset, cmd-shim shell detection', () => {
  assert.strictEqual(isValidSessionId(UUID_A), true)
  assert.strictEqual(isValidSessionId('x" & calc & "'), false)
  assert.strictEqual(isValidSessionId('../../etc'), false)
  assert.strictEqual(isValidModel('claude-opus-4-8'), true)
  assert.strictEqual(isValidModel(null), true) // optional
  assert.strictEqual(isValidModel('x" & calc'), false)
  assert.strictEqual(needsShell('claude'), true)
  assert.strictEqual(needsShell('C:\\Users\\j\\AppData\\Roaming\\npm\\claude.cmd'), true)
  assert.strictEqual(needsShell('C:\\tools\\claude.exe'), false)
})

test('send rejects an invalid sessionId or model without spawning', () => {
  const { runner, spawned } = runnerWith()
  assert.strictEqual(runner.send({ sessionId: 'x" & calc & "', message: 'hi' }).ok, false)
  assert.strictEqual(runner.send({ sessionId: UUID_A, message: 'hi', model: 'bad model name!' }).ok, false)
  assert.strictEqual(spawned.length, 0)
})

test('send spawns claude --resume with the prompt on stdin and no shell for an exe', () => {
  const { runner, spawned, statuses } = runnerWith()
  const res = runner.send({ sessionId: UUID_A, cwd: 'C:\\proj', message: 'hello', model: 'claude-opus-4-8' })
  assert.strictEqual(res.ok, true)
  assert.strictEqual(spawned.length, 1)
  assert.deepStrictEqual(spawned[0].args, ['--resume', UUID_A, '-p', '--model', 'claude-opus-4-8'])
  assert.strictEqual(spawned[0].opts.shell, false)
  assert.deepStrictEqual(spawned[0].child.stdin.written, ['hello'])
  assert.strictEqual(spawned[0].child.stdin.ended, true)
  assert.deepStrictEqual(statuses[0], { sessionId: UUID_A, state: 'running', error: null })
})

test('concurrent sends are tracked independently; the first exit does not clobber the second', () => {
  const { runner, spawned, statuses } = runnerWith()
  runner.send({ sessionId: UUID_A, message: 'a' })
  runner.send({ sessionId: UUID_B, message: 'b' })
  assert.strictEqual(runner.running(), 2)
  spawned[0].child.emit('exit', 0)
  assert.strictEqual(runner.running(), 1)
  assert.ok(statuses.find((s) => s.sessionId === UUID_A && s.state === 'done'))
  // interrupt now targets the remaining (most recent) child
  assert.strictEqual(runner.interrupt().ok, true)
  assert.strictEqual(spawned[1].child.killed, true)
  spawned[1].child.emit('exit', 1)
  assert.ok(statuses.find((s) => s.sessionId === UUID_B && s.state === 'interrupted'))
})

test('interrupt with no running child reports nothing running', () => {
  const { runner } = runnerWith()
  assert.deepStrictEqual(runner.interrupt(), { ok: false, error: 'nothing running' })
})

test('non-zero exit surfaces trimmed stderr; ENOENT gets a friendly message', () => {
  const { runner, spawned, statuses } = runnerWith()
  runner.send({ sessionId: UUID_A, message: 'a' })
  spawned[0].child.stderr.emit('data', Buffer.from('boom'))
  spawned[0].child.emit('exit', 2)
  assert.ok(statuses.find((s) => s.state === 'error' && s.error === 'boom'))

  const second = runnerWith()
  second.runner.send({ sessionId: UUID_A, message: 'a' })
  const enoent = new Error('spawn claude ENOENT')
  enoent.code = 'ENOENT'
  second.spawned[0].child.emit('error', enoent)
  assert.ok(second.statuses.find((s) => s.state === 'error' && /Claude Code CLI not found/.test(s.error)))
})

test('newChat generates a session id and passes --session-id', () => {
  const { runner, spawned } = runnerWith()
  const res = runner.newChat({ message: 'start', cwd: 'C:\\proj', model: 'claude-opus-4-8' })
  assert.strictEqual(res.ok, true)
  assert.strictEqual(isValidSessionId(res.sessionId), true)
  assert.strictEqual(res.cwd, 'C:\\proj')
  assert.deepStrictEqual(spawned[0].args, ['-p', '--session-id', res.sessionId, '--model', 'claude-opus-4-8'])
})

test('live-session guard: a freshly-written file we did not just send to is refused', () => {
  const { runner, spawned } = runnerWith({
    findFile: () => 'C:\\fake\\s.jsonl',
    fsImpl: { existsSync: () => true, statSync: () => ({ mtimeMs: 995_000 }) } // 5s ago < 10s guard
  })
  const res = runner.send({ sessionId: UUID_A, message: 'hi' })
  assert.strictEqual(res.ok, false)
  assert.match(res.error, /active right now/)
  assert.strictEqual(spawned.length, 0)
})

test('timeout kills the child and reports an error', () => {
  const { runner, spawned, statuses } = runnerWith({ timeoutMs: 0 })
  runner.send({ sessionId: UUID_A, message: 'hi' })
  return new Promise((resolve) => setTimeout(() => {
    assert.strictEqual(spawned[0].child.killed, true)
    assert.ok(statuses.find((s) => s.state === 'error' && /didn't respond in time/.test(s.error)))
    resolve()
  }, 20))
})

test('resolveClaudeBin takes the first where/which line and falls back to "claude"', () => {
  assert.strictEqual(
    resolveClaudeBin({ platform: 'win32', execFile: () => 'C:\\a\\claude.exe\r\nC:\\b\\claude.cmd\r\n' }),
    'C:\\a\\claude.exe'
  )
  assert.strictEqual(resolveClaudeBin({ platform: 'win32', execFile: () => { throw new Error('not found') } }), 'claude')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '../src/main/resume'`.

- [ ] **Step 3: Create src/main/resume.js**

```js
// src/main/resume.js
// Runs `claude` child processes for interactive resume + new chats.
//
// Security contract (the renderer is untrusted input):
//   - sessionId must be a UUID, model a conservative charset, BEFORE either
//     reaches argv. With shell:true on Windows argv is flattened into a cmd.exe
//     line, so unvalidated values were command injection.
//   - The binary is resolved once via where/which; a real path spawns with
//     shell:false. Only the bare-name fallback and .cmd/.bat shims (which
//     Node cannot spawn directly) go through a shell — safe with validated args
//     and the prompt on stdin.
//
// Concurrency: every child lives in a Map keyed by sessionId, so overlapping
// sends can't clobber each other and interrupt targets the right child.
const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const { randomUUID } = require('crypto')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODEL_RE = /^[a-zA-Z0-9._:-]{1,80}$/
const TIMEOUT_MS = 150_000
const LIVE_GUARD_MS = 10_000 // file written this recently => live elsewhere
const OWN_SEND_GRACE_MS = 30_000 // unless WE wrote it via a recent send

function isValidSessionId(id) {
  return typeof id === 'string' && UUID_RE.test(id)
}

function isValidModel(model) {
  return model == null || (typeof model === 'string' && MODEL_RE.test(model))
}

function needsShell(bin) {
  return bin === 'claude' || /\.(cmd|bat)$/i.test(bin)
}

/** Resolve the claude binary once at startup (also fixes PATH ambiguity when
 *  launched from the Start menu). Falls back to the bare name + shell. */
function resolveClaudeBin({ platform = process.platform, execFile = execFileSync } = {}) {
  try {
    const out = execFile(platform === 'win32' ? 'where.exe' : 'which', ['claude'], { encoding: 'utf-8' })
    const first = String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0]
    if (first) return first
  } catch {
    /* not on PATH — the ENOENT/exit path surfaces a friendly error */
  }
  return 'claude'
}

class ClaudeRunner {
  constructor({
    bin = 'claude',
    spawnImpl = spawn,
    onStatus = () => {},
    timeoutMs = TIMEOUT_MS,
    now = Date.now,
    fsImpl = fs,
    findFile = () => null
  } = {}) {
    this.bin = bin
    this._spawn = spawnImpl
    this.onStatus = onStatus // (sessionId, state, error)
    this.timeoutMs = timeoutMs
    this.now = now
    this.fs = fsImpl
    this.findFile = findFile
    this.children = new Map() // sessionId -> { child, interrupting }
    this.lastSentAt = new Map() // sessionId -> ts of our last send
  }

  running() {
    return this.children.size
  }

  /** Message an existing session: claude --resume <id> -p, prompt on stdin. */
  send({ sessionId, cwd, message, model } = {}) {
    if (!sessionId || !message) return { ok: false, error: 'missing sessionId or message' }
    if (!isValidSessionId(sessionId)) return { ok: false, error: 'invalid session id' }
    if (!isValidModel(model)) return { ok: false, error: 'invalid model name' }

    // Guard: can't resume a session that's currently live (being written by
    // another running claude). Recent mtime + we didn't just send here => active
    // elsewhere. Within OWN_SEND_GRACE_MS of our own send, skip the check so a
    // normal back-and-forth isn't false-flagged.
    const file = this.findFile(sessionId)
    if (file) {
      try {
        const st = this.fs.statSync(file)
        const sentAt = this.lastSentAt.get(sessionId) || 0
        if (this.now() - st.mtimeMs < LIVE_GUARD_MS && this.now() - sentAt > OWN_SEND_GRACE_MS) {
          return {
            ok: false,
            error:
              "This session is active right now (being written elsewhere). You can't message an in-progress session — open a past one to continue it."
          }
        }
      } catch {
        /* ignore stat errors */
      }
    }
    if (cwd && !this.fs.existsSync(cwd)) {
      return { ok: false, error: "This session's working folder no longer exists:\n" + cwd }
    }

    const args = ['--resume', sessionId, '-p']
    if (model) args.push('--model', model)
    return this._run(sessionId, args, cwd || os.homedir(), message)
  }

  /** Start a fresh session: claude -p --session-id <uuid>, prompt on stdin. */
  newChat({ message, cwd, model } = {}) {
    if (!message) return { ok: false, error: 'missing message' }
    if (!isValidModel(model)) return { ok: false, error: 'invalid model name' }
    const dir = cwd || os.homedir()
    if (!this.fs.existsSync(dir)) return { ok: false, error: 'Working folder does not exist:\n' + dir }
    const sessionId = randomUUID()
    const args = ['-p', '--session-id', sessionId]
    if (model) args.push('--model', model)
    const res = this._run(sessionId, args, dir, message)
    return res.ok ? { ok: true, sessionId, cwd: dir } : res
  }

  /** Stop a running child. Without an id, targets the most recently started. */
  interrupt(sessionId) {
    let id = sessionId
    if (!id) {
      const ids = [...this.children.keys()]
      id = ids[ids.length - 1]
    }
    const entry = id ? this.children.get(id) : null
    if (!entry) return { ok: false, error: 'nothing running' }
    entry.interrupting = true
    try {
      entry.child.kill()
    } catch {
      /* already gone */
    }
    return { ok: true }
  }

  killAll() {
    for (const entry of this.children.values()) {
      try {
        entry.child.kill()
      } catch {
        /* ignore */
      }
    }
    this.children.clear()
  }

  _run(sessionId, args, cwd, message) {
    let child
    try {
      child = this._spawn(this.bin, args, { cwd, shell: needsShell(this.bin), windowsHide: true })
    } catch (err) {
      return { ok: false, error: err.message }
    }
    const entry = { child, interrupting: false }
    this.children.set(sessionId, entry)
    this.lastSentAt.set(sessionId, this.now())
    this.onStatus(sessionId, 'running', null)

    let stderr = ''
    let settled = false
    const finish = (state, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (entry.interrupting) {
        state = 'interrupted'
        error = null
      }
      if (this.children.get(sessionId) === entry) this.children.delete(sessionId)
      this.onStatus(sessionId, state, error || null)
    }
    const timer = setTimeout(() => {
      try {
        entry.child.kill()
      } catch {
        /* ignore */
      }
      finish('error', "claude didn't respond in time. The session may be open elsewhere, or its folder moved.")
    }, this.timeoutMs)

    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', (err) =>
      finish(
        'error',
        err && err.code === 'ENOENT' ? 'Claude Code CLI not found on PATH. Install it, then restart Flux.' : err.message
      )
    )
    child.on('exit', (code) =>
      finish(code === 0 ? 'done' : 'error', code === 0 ? null : stderr.slice(0, 400) || 'claude exited ' + code)
    )
    child.stdin.write(message)
    child.stdin.end()
    return { ok: true }
  }
}

module.exports = { ClaudeRunner, resolveClaudeBin, isValidSessionId, isValidModel, needsShell }
```

- [ ] **Step 4: Run tests to verify the resume tests pass**

Run: `npm test`
Expected: ALL pass.

- [ ] **Step 5: Rewire index.js**

In `src/main/index.js`:

1. Add to the requires at the top: `const { ClaudeRunner, resolveClaudeBin } = require('./resume')`
2. Add `let claudeRunner = null` next to the other module-level singletons.
3. DELETE the whole block from the `// ---- Interactive resume ----` comment through the end of the `session:interrupt` handler (the `let sendChild`/`lastSentAt`/`interrupting` globals, the `session:send` handler, the `// ---- New chat ----` block including `const { randomUUID } = require('crypto')`, and the `session:interrupt` handler). Replace with:

```js
// ---- Interactive resume + new chat ----------------------------------------
// All claude child-process plumbing lives in resume.js: input validation,
// resolved binary, per-sessionId child Map (concurrent sends don't clobber).
ipcMain.handle('session:send', (_e, args) =>
  claudeRunner ? claudeRunner.send(args || {}) : { ok: false, error: 'not ready' }
)
ipcMain.handle('session:new', (_e, args) =>
  claudeRunner ? claudeRunner.newChat(args || {}) : { ok: false, error: 'not ready' }
)
ipcMain.handle('session:interrupt', () =>
  claudeRunner ? claudeRunner.interrupt() : { ok: false, error: 'nothing running' }
)
```

4. In `app.whenReady().then(() => { ... })`, after the `ptyManager = new PtyManager({...})` block, add:

```js
  claudeRunner = new ClaudeRunner({
    bin: resolveClaudeBin(),
    onStatus: (sessionId, state, error) => emit('session:sendstatus', { sessionId, state, error }),
    findFile: findSessionFileById
  })
```

5. In the `window-all-closed` handler, replace the `if (sendChild) { try { sendChild.kill() } catch {...} }` block with:

```js
  if (claudeRunner) claudeRunner.killAll()
```

- [ ] **Step 6: Register the new module in electron.vite.config.mjs**

Add to the rollupOptions `input` map (alphabetical position doesn't matter):

```js
          resume: resolve('src/main/resume.js'),
```

- [ ] **Step 7: Verify tests + build**

Run: `npm test`
Expected: ALL pass.
Run: `npm run build`
Expected: build succeeds; `out/main/resume.js` exists.

- [ ] **Step 8: Commit**

```powershell
git add tests/resume.test.js src/main/resume.js src/main/index.js electron.vite.config.mjs
git commit -m "fix(security): validated, Map-tracked claude spawns in resume.js (kills IPC command injection + sendChild clobbering)"
```

---

### Task 5: Renderer-escape hardening — CSP, deny window.open/navigation, sandbox

**Files:**
- Modify: `src/main/appprotocol.js`
- Modify: `src/main/index.js` (createWindow)
- Test: `tests/appprotocol.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/appprotocol.test.js`:

```js
const { headersFor, CSP } = require('../src/main/appprotocol')

test('html responses carry a restrictive Content-Security-Policy; assets do not', () => {
  const html = headersFor('.html')
  assert.strictEqual(html['content-type'], 'text/html')
  assert.strictEqual(html['content-security-policy'], CSP)
  assert.match(CSP, /default-src 'self'/)
  assert.match(CSP, /object-src 'none'/)
  assert.ok(!CSP.includes("unsafe-eval"))
  const js = headersFor('.js')
  assert.strictEqual(js['content-security-policy'], undefined)
  assert.strictEqual(headersFor('.nope')['content-type'], 'application/octet-stream')
})
```

(Match the existing test file's import style — it requires from `../src/main/appprotocol`; `test`/`assert` are already imported at the top.)

- [ ] **Step 2: Run tests to verify it fails**

Run: `npm test`
Expected: FAIL — `headersFor` is not exported.

- [ ] **Step 3: Implement in appprotocol.js**

Add below the MIME map:

```js
// Transcript-derived content is untrusted (sessions fetch the web), so the
// renderer document gets a tight CSP. style-src 'unsafe-inline' is required:
// React style props and the inline theme vars on <html> are style attributes.
// img-src data: covers timeline images (base64 from transcripts).
// Dev (Vite server) is unaffected — this header is only served over app://.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

/** Response headers for a renderer asset by extension. Pure — unit-tested. */
function headersFor(ext) {
  const headers = { 'content-type': MIME[ext] || 'application/octet-stream' }
  if (ext === '.html') headers['content-security-policy'] = CSP
  return headers
}
```

In `serveAppProtocol`, replace the success Response line with:

```js
      return new Response(data, { headers: headersFor(ext) })
```

Extend module.exports:

```js
module.exports = { resolveRendererPath, registerAppScheme, serveAppProtocol, headersFor, CSP, MIME }
```

- [ ] **Step 4: Harden createWindow in index.js**

In `createWindow()`:

1. Change `sandbox: false` to `sandbox: true` and update its context: the preload only uses `contextBridge` + `ipcRenderer`, both available in sandboxed preloads.
2. After the `mainWindow = new BrowserWindow({...})` statement (before `loadURL`), add:

```js
  // The renderer displays transcript-derived content (whatever a session
  // touched, including web fetches) — treat it as untrusted. No popups, no
  // navigating the window away from the app bundle / dev server.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    const allowed = url.startsWith('app://') || (dev && url.startsWith(dev))
    if (!allowed) e.preventDefault()
  })
```

- [ ] **Step 5: Run tests + build + smoke the real app**

Run: `npm test` → ALL pass.
Run: `npm run build` → succeeds.
Smoke (the sandbox + CSP could break the preload bridge or asset loading — verify against the BUILT app; kill stray electron.exe first per the GPU-cache-lock gotcha):

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
$env:FLUX_SMOKE_SHOT = "C:\tmp\flux-hardening-smoke.png"
npx electron .
Remove-Item env:FLUX_SMOKE_SHOT
```

Expected: stdout contains `FLUX_SMOKE_SHOT_OK`, and `C:\tmp\flux-hardening-smoke.png` shows the normal app (sidebar with sessions, terminal pane) — not a blank window. If blank: check the devtools console output for CSP violations; `style-src 'unsafe-inline'` and `img-src data:` above are the two known requirements.

- [ ] **Step 6: Commit**

```powershell
git add tests/appprotocol.test.js src/main/appprotocol.js src/main/index.js
git commit -m "fix(security): CSP on app://, deny window.open/navigation, sandbox the renderer"
```

---

### Task 6: PtyManager spawn error contract

**Files:**
- Modify: `src/main/ptymanager.js:23-33`
- Modify: `src/main/index.js` (pty:spawn handler)
- Test: `tests/ptymanager.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/ptymanager.test.js`:

```js
test('a throwing spawn impl returns null and leaves no entry (bad cwd must not reject the IPC)', () => {
  const mgr = new PtyManager({ spawn: () => { throw new Error('ENOENT: no such cwd') } })
  let result
  assert.doesNotThrow(() => { result = mgr.spawn('a', { cwd: 'C:\\gone' }) })
  assert.strictEqual(result, null)
  assert.strictEqual(mgr.has('a'), false)
  assert.doesNotThrow(() => { mgr.write('a', 'x'); mgr.kill('a') })
})
```

- [ ] **Step 2: Run tests to verify it fails**

Run: `npm test`
Expected: FAIL — `mgr.spawn` throws.

- [ ] **Step 3: Implement**

In `ptymanager.js` `spawn(id, opts)`, wrap the creation:

```js
  spawn(id, opts) {
    if (this.ptys.has(id)) return this.ptys.get(id) // idempotent
    let p
    try {
      p = this._spawn(opts)
    } catch {
      // node-pty throws on a nonexistent cwd; match the {ok:false} contract
      // every other channel has instead of rejecting the invoke promise.
      return null
    }
    p.onData((data) => this.onData(id, data))
    p.onExit(({ exitCode }) => {
      this.ptys.delete(id)
      this.onExit(id, exitCode)
    })
    this.ptys.set(id, p)
    return p
  }
```

In `index.js`, replace the `pty:spawn` handler:

```js
ipcMain.handle('pty:spawn', (_e, { id, cols, rows, cwd, shell }) => {
  const p = ptyManager ? ptyManager.spawn(id, { cols, rows, cwd, shell }) : null
  return p ? { ok: true, id } : { ok: false, id, error: 'failed to start terminal (working folder may not exist)' }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` → ALL pass.

- [ ] **Step 5: Commit**

```powershell
git add tests/ptymanager.test.js src/main/ptymanager.js src/main/index.js
git commit -m "fix(pty): bad-cwd spawn returns {ok:false} instead of rejecting the invoke"
```

---

### Task 7: Ship bundled skills in the installed app

**Files:**
- Modify: `electron-builder.yml`
- Modify: `src/main/skills.js:104-106` (bundledSkillsDir + export)
- Test: `tests/skills-bundled.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/skills-bundled.test.js`:

```js
// tests/skills-bundled.test.js
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { bundledSkillsDir } = require('../src/main/skills')

test('dev: bundled skills resolve under appPath/skills when it exists', () => {
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-skills-'))
  fs.mkdirSync(path.join(appPath, 'skills'))
  assert.strictEqual(bundledSkillsDir(appPath), path.join(appPath, 'skills'))
})

test('packaged: falls back to process.resourcesPath/skills when appPath/skills is missing', () => {
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-asar-')) // simulates the asar root: no skills/
  const resources = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-res-'))
  fs.mkdirSync(path.join(resources, 'skills'))
  const orig = process.resourcesPath
  process.resourcesPath = resources
  try {
    assert.strictEqual(bundledSkillsDir(appPath), path.join(resources, 'skills'))
  } finally {
    process.resourcesPath = orig
  }
})
```

- [ ] **Step 2: Run tests to verify it fails**

Run: `npm test`
Expected: FAIL — `bundledSkillsDir` is not exported (undefined is not a function).

- [ ] **Step 3: Implement**

In `skills.js`, replace `bundledSkillsDir`:

```js
function bundledSkillsDir(appPath) {
  // Dev: repo-root skills/ next to package.json. Packaged: electron-builder
  // ships skills/ as an extraResource (it is NOT in the asar — the files list
  // only packs out/**), so resolve under process.resourcesPath.
  const inApp = path.join(appPath, 'skills')
  if (fs.existsSync(inApp)) return inApp
  if (process.resourcesPath) {
    const inResources = path.join(process.resourcesPath, 'skills')
    if (fs.existsSync(inResources)) return inResources
  }
  return inApp
}
```

Extend module.exports:

```js
module.exports = { listSkills, installBundledSkill, userSkillsDir, bundledSkillsDir }
```

In `electron-builder.yml`, add after the `files:` block:

```yaml
# Bundled starter skills live OUTSIDE the asar so fs.cpSync (skill install)
# copies real files; skills.js falls back to process.resourcesPath/skills.
extraResources:
  - from: skills
    to: skills
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` → ALL pass.

- [ ] **Step 5: Commit**

```powershell
git add tests/skills-bundled.test.js src/main/skills.js electron-builder.yml
git commit -m "fix(skills): ship bundled skills as extraResources (Skills tab was empty in every installed copy)"
```

---

### Task 8: Session-path guard + watch-timer hygiene

**Files:**
- Modify: `src/main/sessions.js` (add pure `isSessionPathAllowed`)
- Modify: `src/main/index.js` (apply guard in session:read / session:watch / subagents:list / subagent:read; clear watch timer on unwatch)
- Test: `tests/sessions-pathguard.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/sessions-pathguard.test.js`:

```js
// tests/sessions-pathguard.test.js
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { isSessionPathAllowed } = require('../src/main/sessions')

const BASE = 'C:\\Users\\james\\.claude'
const opts = { baseDir: BASE, platform: 'win32' }

test('jsonl files under ~/.claude are allowed (any depth, case-insensitive on win32)', () => {
  assert.strictEqual(isSessionPathAllowed(path.join(BASE, 'projects', 'p', 's.jsonl'), opts), true)
  assert.strictEqual(isSessionPathAllowed(path.join(BASE, 'projects', 'p', 's', 'subagents', 'agent-1.jsonl'), opts), true)
  assert.strictEqual(isSessionPathAllowed('c:\\users\\JAMES\\.claude\\projects\\p\\s.jsonl', opts), true)
})

test('paths outside ~/.claude, traversals, and non-jsonl files are refused', () => {
  assert.strictEqual(isSessionPathAllowed('C:\\Windows\\system32\\config\\SAM', opts), false)
  assert.strictEqual(isSessionPathAllowed(path.join(BASE, '..', 'secrets.jsonl'), opts), false)
  assert.strictEqual(isSessionPathAllowed(path.join(BASE, 'projects', 'p', 'notes.txt'), opts), false)
  assert.strictEqual(isSessionPathAllowed(null, opts), false)
  assert.strictEqual(isSessionPathAllowed(42, opts), false)
})

test('posix platforms compare case-sensitively', () => {
  const popts = { baseDir: '/home/j/.claude', platform: 'linux' }
  assert.strictEqual(isSessionPathAllowed('/home/j/.claude/projects/p/s.jsonl', popts), true)
  assert.strictEqual(isSessionPathAllowed('/home/J/.claude/projects/p/s.jsonl', popts), false)
})
```

- [ ] **Step 2: Run tests to verify it fails**

Run: `npm test`
Expected: FAIL — `isSessionPathAllowed` is not exported.

- [ ] **Step 3: Implement the guard in sessions.js**

Add below `projectsDir()`:

```js
/**
 * May the renderer ask main to read/watch this file? Transcript reads are
 * boundary-checked to .jsonl files under ~/.claude — session:read and
 * session:watch would otherwise read+return any absolute path over IPC.
 * Pure for tests: baseDir/platform injectable.
 */
function isSessionPathAllowed(file, { baseDir, platform = process.platform } = {}) {
  if (typeof file !== 'string' || !file.toLowerCase().endsWith('.jsonl')) return false
  const base = path.normalize(baseDir || path.join(os.homedir(), '.claude'))
  let resolved
  try {
    resolved = path.normalize(path.resolve(file))
  } catch {
    return false
  }
  const a = platform === 'win32' ? resolved.toLowerCase() : resolved
  const b = platform === 'win32' ? base.toLowerCase() : base
  return a.startsWith(b + path.sep)
}
```

Add `isSessionPathAllowed` to the module.exports object.

- [ ] **Step 4: Apply in index.js**

1. Extend the sessions require: `const { listSessions, findSessionFileById, isSessionPathAllowed } = require('./sessions')`
2. `session:read` — add as the first line of the try block:

```js
    if (!isSessionPathAllowed(file)) return { ok: false, error: 'path not allowed' }
```

3. `session:watch` — at the top of the handler:

```js
ipcMain.on('session:watch', (_e, file) => {
  if (!isSessionPathAllowed(file)) return
  watchFile = file
```

4. `subagents:list` and `subagent:read` — first line of each try block:

```js
    if (!isSessionPathAllowed(file)) return { ok: false, error: 'path not allowed', subagents: [] }
```

(for `subagent:read`, return `{ ok: false, error: 'path not allowed' }` — no `subagents` key.)

5. `session:unwatch` — clear the interval (it currently runs for the app's lifetime):

```js
ipcMain.on('session:unwatch', () => {
  watchFile = null
  if (watchTimer) {
    clearInterval(watchTimer)
    watchTimer = null
  }
})
```

(`session:watch` already re-creates the timer via `if (!watchTimer)`, so re-watching works.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test` → ALL pass. (Parser tests that write to os.tmpdir() call `parseSessionFile` directly — the guard lives only at the IPC boundary.)

- [ ] **Step 6: Commit**

```powershell
git add tests/sessions-pathguard.test.js src/main/sessions.js src/main/index.js
git commit -m "fix(security): boundary-check transcript paths to ~/.claude *.jsonl; stop the orphaned watch timer"
```

---

### Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: ALL pass (185+ tests: 173 pre-existing + the new files).

- [ ] **Step 2: Production build + packaged-render smoke**

```powershell
npm run build
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
$env:FLUX_SMOKE_SHOT = "C:\tmp\flux-week-final-smoke.png"
npx electron .
Remove-Item env:FLUX_SMOKE_SHOT
```

Expected: `FLUX_SMOKE_SHOT_OK`, screenshot shows the normal UI.

- [ ] **Step 3: Packaged skills verification**

```powershell
npm run dist:dir
Get-ChildItem "dist\win-unpacked\resources\skills"
```

Expected: the skills folders from the repo's `skills/` directory are listed under `resources\skills` (this is the proof the Task 7 fix works in the real package).

- [ ] **Step 4: Manual interactive check (real claude)**

Launch `npm run dev`; open a past session; send a short message ("say hi and nothing else"); while it runs confirm Stop works; confirm the reply lands in the timeline. Open a second session and send there too (the old code could not track two children).

- [ ] **Step 5: Update README roadmap + commit**

Add one line to README.md's roadmap section:

```markdown
- [x] **Correctness + security week:** token usage deduped by message.id (was
      2.4-2.75x inflated), exact turn durations from `turn_duration` records
      (turn-finished notifications now fire), validated claude spawns in
      `resume.js` (concurrent sends, correct interrupt), CSP + sandbox +
      window-open/navigation hardening, bundled skills actually packaged,
      transcript reads boundary-checked to `~/.claude`.
```

```powershell
git add README.md
git commit -m "docs: correctness + security week in the roadmap"
```
