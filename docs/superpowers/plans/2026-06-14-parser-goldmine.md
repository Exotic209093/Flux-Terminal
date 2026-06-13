# JSONL Parser Goldmine Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shared per-line parser to retain `uuid`/`parentUuid`, tool_use ids, `toolUseResult`/`structuredPatch`, hook (`attachment`) records, and `compact_boundary` — plus surface the subagent `toolUseId`. No UI.

**Architecture:** All changes land in `parser.js`'s `applyEvent`/`walkContent` (shared by whole-file parse + live/index tailer) and one field in `subagents.js`. Additive; `counts` object shape stays stable; new result/patch/stdout fields are capped at `MAX_RESULT`.

**Tech Stack:** Node, node:test.

**Spec:** `docs/superpowers/specs/2026-06-14-parser-goldmine-design.md`

**Test command:** `npm test` runs `node --test "tests/**/*.test.js"`. Single file: `node --test tests/parser-goldmine.test.js`.

**Reference (parser.js current shape):** `applyEvent(o, model, timeline)` does `model.lineCount++`, sets sessionId/cwd/gitBranch/version/timestamp, then `switch (o.type)` with cases `ai-title`/`last-prompt`/`user`/`assistant`/`system`/`default`. `walkContent(o, model, timeline, role)` switches over content `block.type`: `text`/`thinking`/`tool_use`/`image`/`tool_result`/`default`. `freshModel(file)` returns the accumulator (has `counts`, `usage`, `parseErrors`, `errorCount`, `lineCount`, etc.). `truncate(s, n)` caps strings. All exported.

---

## Task 1: uuid/parentUuid stamping + tool_use id

**Files:**
- Modify: `src/main/parser.js`
- Test: `tests/parser-goldmine.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/parser-goldmine.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { parseSessionFile } = require('../src/main/parser')

function tmp(lines) {
  const f = path.join(os.tmpdir(), 'flux-gm-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.jsonl')
  fs.writeFileSync(f, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'))
  return f
}

test('timeline items carry uuid/parentUuid and tool_use carries id', () => {
  const f = tmp([
    { type: 'user', uuid: 'u1', parentUuid: null, message: { content: 'hello there' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { id: 'm1', content: [
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 'tool_abc', name: 'Bash', input: { command: 'ls' } }
    ] } }
  ])
  const r = parseSessionFile(f, { timeline: true })
  const user = r.timeline.find((t) => t.kind === 'user')
  const tool = r.timeline.find((t) => t.kind === 'tool_use')
  assert.strictEqual(user.uuid, 'u1')
  assert.strictEqual(user.parentUuid, null)
  assert.strictEqual(tool.uuid, 'a1')
  assert.strictEqual(tool.parentUuid, 'u1')
  assert.strictEqual(tool.id, 'tool_abc')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/parser-goldmine.test.js`
Expected: FAIL (`user.uuid` is undefined; `tool.id` is undefined).

- [ ] **Step 3: Implement in parser.js**

(a) In `applyEvent`, capture the timeline length up front. Replace:

```js
function applyEvent(o, model, timeline) {
  model.lineCount++
```

with:

```js
function applyEvent(o, model, timeline) {
  const __startLen = timeline ? timeline.length : 0
  model.lineCount++
```

(b) At the END of `applyEvent`, stamp the ids onto every item this record produced. Replace the tail of `applyEvent` (its switch's default case + the function close):

```js
    default:
      break
  }
}
```

with:

```js
    default:
      break
  }

  // Conversation-threading ids on every item this record produced (constellation #13).
  if (timeline) {
    for (let i = __startLen; i < timeline.length; i++) {
      if (timeline[i].uuid === undefined) timeline[i].uuid = o.uuid || null
      if (timeline[i].parentUuid === undefined) timeline[i].parentUuid = o.parentUuid || null
    }
  }
}
```

(Note: this `default:`/`break` at 6-space indent is `applyEvent`'s switch — `walkContent`'s default is indented deeper, so this anchor is unique.)

(c) In `walkContent`, the `tool_use` case currently pushes `{ kind: 'tool_use', ts, toolName: block.name || 'tool', toolInput: preview(block.input) }`. Add the block id:

```js
        if (timeline) timeline.push({ kind: 'tool_use', ts, id: block.id || null, toolName: block.name || 'tool', toolInput: preview(block.input) })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/parser-goldmine.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/main/parser.js tests/parser-goldmine.test.js
git commit -m "feat(parser): retain uuid/parentUuid on items + tool_use block id

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: toolUseResult / structuredPatch / stdout on tool_result items

**Files:**
- Modify: `src/main/parser.js`
- Test: `tests/parser-goldmine.test.js`

- [ ] **Step 1: Add the failing test (append to tests/parser-goldmine.test.js)**

```js
test('tool_result items carry capped toolUseResult (structuredPatch + filePath + stdout)', () => {
  const f = tmp([
    { type: 'user', uuid: 'u2', toolUseResult: { filePath: 'C:/x/a.txt', structuredPatch: [{ oldStart: 1, lines: ['-old', '+new'] }] },
      message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'edited' }] }] } },
    { type: 'user', uuid: 'u3', toolUseResult: { stdout: 'line1\nline2' },
      message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'ran' }] }] } }
  ])
  const r = parseSessionFile(f, { timeline: true })
  const results = r.timeline.filter((t) => t.kind === 'tool_result')
  assert.strictEqual(results[0].result.filePath, 'C:/x/a.txt')
  assert.ok(Array.isArray(results[0].result.structuredPatch))
  assert.strictEqual(results[1].result.stdout, 'line1\nline2')
})

test('an oversized structuredPatch is marked truncated, not inlined whole', () => {
  const huge = Array.from({ length: 5000 }, (_, i) => ({ line: 'x'.repeat(20), n: i }))
  const f = tmp([
    { type: 'user', toolUseResult: { structuredPatch: huge },
      message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'big' }] }] } }
  ])
  const r = parseSessionFile(f, { timeline: true })
  const res = r.timeline.find((t) => t.kind === 'tool_result')
  assert.strictEqual(res.result.structuredPatch.truncated, true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/parser-goldmine.test.js`
Expected: FAIL (`results[0].result` is undefined).

- [ ] **Step 3: Implement in parser.js**

(a) After the `MAX_IMAGES` constant near the top, add:

```js
const MAX_RESULT = 4000 // cap for attached tool results / patches / stdout (IPC payload discipline)
```

(b) Add a helper above `walkContent` (next to `preview`):

```js
/** Cap a structuredPatch so a giant diff can't bloat the IPC payload. */
function capPatch(patch) {
  try {
    if (JSON.stringify(patch).length <= MAX_RESULT) return patch
  } catch {
    /* fall through */
  }
  return { truncated: true }
}
```

(c) In `walkContent`'s `tool_result` case, after the existing `timeline.push({ kind: 'tool_result', ts, isError: !!block.is_error, text })`, attach the result projection. Replace:

```js
        if (timeline) {
          const text = inner
            ? truncate(
                inner
                  .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
                  .map((b) => b.text)
                  .join('\n'),
                600
              )
            : preview(block.content)
          timeline.push({ kind: 'tool_result', ts, isError: !!block.is_error, text })
        }
```

with:

```js
        if (timeline) {
          const text = inner
            ? truncate(
                inner
                  .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
                  .map((b) => b.text)
                  .join('\n'),
                600
              )
            : preview(block.content)
          const item = { kind: 'tool_result', ts, isError: !!block.is_error, text }
          const tur = o.toolUseResult
          if (tur && typeof tur === 'object') {
            const result = {}
            if (Array.isArray(tur.structuredPatch)) result.structuredPatch = capPatch(tur.structuredPatch)
            const fp = tur.filePath || (tur.file && tur.file.filePath)
            if (fp) result.filePath = fp
            if (typeof tur.stdout === 'string') result.stdout = truncate(tur.stdout, MAX_RESULT)
            if (typeof tur.stderr === 'string') result.stderr = truncate(tur.stderr, MAX_RESULT)
            if (Object.keys(result).length) item.result = result
          }
          timeline.push(item)
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/parser-goldmine.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/parser.js tests/parser-goldmine.test.js
git commit -m "feat(parser): attach capped toolUseResult (structuredPatch/filePath/stdout) to tool_result items

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Hook (attachment) records

**Files:**
- Modify: `src/main/parser.js`
- Test: `tests/parser-goldmine.test.js`

- [ ] **Step 1: Add the failing test (append)**

```js
test('attachment records become hook timeline items and bump hookCount', () => {
  const f = tmp([
    { type: 'attachment', uuid: 'h1', timestamp: '2026-01-01T00:00:00Z',
      attachment: { type: 'hook_success', hookName: 'SessionStart:startup', hookEvent: 'SessionStart', toolUseID: 'tu9', content: '', stdout: 'ran the hook' } }
  ])
  const r = parseSessionFile(f, { timeline: true })
  const hook = r.timeline.find((t) => t.kind === 'hook')
  assert.strictEqual(hook.hookName, 'SessionStart:startup')
  assert.strictEqual(hook.status, 'hook_success')
  assert.strictEqual(hook.toolUseId, 'tu9')
  assert.strictEqual(hook.text, 'ran the hook')
  assert.strictEqual(r.hookCount, 1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/parser-goldmine.test.js`
Expected: FAIL (`hook` is undefined; `r.hookCount` is undefined).

- [ ] **Step 3: Implement in parser.js**

(a) In `freshModel`, after the `errorCount: 0,` line add:

```js
    hookCount: 0, // attachment/hook-execution records (hooks panel #13)
```

(b) In `applyEvent`'s switch, add a new case before `default:`:

```js
    case 'attachment': {
      const a = o.attachment
      if (a && typeof a === 'object') {
        model.hookCount++
        if (timeline) {
          timeline.push({
            kind: 'hook',
            ts: o.timestamp || null,
            hookName: a.hookName || null,
            hookEvent: a.hookEvent || null,
            status: a.type || null,
            toolUseId: a.toolUseID || null,
            text: truncate(typeof a.stdout === 'string' && a.stdout ? a.stdout : a.content || '', MAX_RESULT)
          })
        }
      }
      break
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/parser-goldmine.test.js`
Expected: PASS (4 tests). uuid stamping from Task 1 also applies (`hook.uuid === 'h1'`).

- [ ] **Step 5: Commit**

```bash
git add src/main/parser.js tests/parser-goldmine.test.js
git commit -m "feat(parser): parse attachment hook records into hook timeline items

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: compact_boundary marker

**Files:**
- Modify: `src/main/parser.js`
- Test: `tests/parser-goldmine.test.js`

- [ ] **Step 1: Add the failing test (append)**

```js
test('compact_boundary system records become compact markers and bump compactions', () => {
  const f = tmp([
    { type: 'system', subtype: 'compact_boundary', uuid: 'c1', timestamp: '2026-01-01T00:00:00Z' }
  ])
  const r = parseSessionFile(f, { timeline: true })
  const c = r.timeline.find((t) => t.kind === 'compact')
  assert.ok(c)
  assert.strictEqual(r.compactions, 1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/parser-goldmine.test.js`
Expected: FAIL (`c` is undefined; `r.compactions` is undefined).

- [ ] **Step 3: Implement in parser.js**

(a) In `freshModel`, after the `hookCount: 0,` line (added in Task 3) add:

```js
    compactions: 0, // system/compact_boundary records (context-pressure gauge #13)
```

(b) In `applyEvent`'s `case 'system':`, after the existing `turn_duration` block and before its `break`, add:

```js
      if (o.subtype === 'compact_boundary') {
        model.compactions++
        if (timeline) timeline.push({ kind: 'compact', ts: o.timestamp || null })
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/parser-goldmine.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/parser.js tests/parser-goldmine.test.js
git commit -m "feat(parser): mark compact_boundary records on the timeline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Surface subagent toolUseId

**Files:**
- Modify: `src/main/subagents.js`
- Test: `tests/subagents-tooluseid.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/subagents-tooluseid.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { listSubagents } = require('../src/main/subagents')

test('listSubagents surfaces toolUseId from the subagent meta', () => {
  const base = path.join(os.tmpdir(), 'flux-sa-' + Date.now() + '-' + Math.random().toString(36).slice(2))
  fs.mkdirSync(base, { recursive: true })
  const sessionFile = path.join(base, 'sess.jsonl')
  fs.writeFileSync(sessionFile, JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n')
  const subDir = path.join(base, 'sess', 'subagents')
  fs.mkdirSync(subDir, { recursive: true })
  fs.writeFileSync(path.join(subDir, 'agent-x.jsonl'), JSON.stringify({ type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: 'work' }] } }) + '\n')
  fs.writeFileSync(path.join(subDir, 'agent-x.meta.json'), JSON.stringify({ agentType: 'general', name: 'helper', description: 'do a thing', toolUseId: 'tool_parent_123' }))

  const list = listSubagents(sessionFile)
  assert.strictEqual(list.length, 1)
  assert.strictEqual(list[0].toolUseId, 'tool_parent_123')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/subagents-tooluseid.test.js`
Expected: FAIL (`list[0].toolUseId` is undefined).

- [ ] **Step 3: Implement in subagents.js**

In `listSubagents`, in the `out.push({ ... })` object, after the `name: (meta && meta.name) || null,` line add:

```js
      toolUseId: (meta && meta.toolUseId) || null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/subagents-tooluseid.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Full suite — confirm no regressions**

Run: `npm test 2>&1 | tail -6`
Expected: all pass (276 prior + 6 new = 282; `counts` shape unchanged so no regressions).

- [ ] **Step 6: Commit**

```bash
git add src/main/subagents.js tests/subagents-tooluseid.test.js
git commit -m "feat(subagents): surface meta.toolUseId for parent-tool-use join

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** uuid/parentUuid + tool_use id → Task 1; toolUseResult/structuredPatch/filePath/stdout (capped) → Task 2; hook/attachment records → Task 3; compact_boundary → Task 4; subagent toolUseId → Task 5. YAGNI-deferred records (file-history-snapshot/queue-operation/permission-mode) intentionally untouched.

**Placeholder scan:** none — every step has full code + exact commands. Field names (`structuredPatch`, `filePath`, `stdout`, `attachment.type`/`hookName`/`hookEvent`/`toolUseID`, `subtype:'compact_boundary'`) match the real transcript shapes verified in the spec.

**Type/name consistency:** `MAX_RESULT` defined in Task 2, used in Tasks 2-3; `capPatch` defined and used in Task 2; `hookCount` added in Task 3 / `compactions` in Task 4 and asserted in their tests; `__startLen` stamping (Task 1) covers items pushed by later tasks (hook/compact get uuid stamped too); `counts` object deliberately unchanged.

**Notes for executor:** Tasks are sequential (all edit `parser.js` except Task 5); commit after each. The Task 4 `freshModel` edit depends on Task 3's `hookCount:` line existing as its anchor. No push/tag — this sub-project has no live rollout.
