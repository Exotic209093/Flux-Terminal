# Files-Touched Tab + Diff Lens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `structuredPatch` (from #3) as inline Edit/Write diffs and a per-session files-touched view; add parent→subagent drill-in.

**Architecture:** Pure helpers (`lib/filesTouched.js`) + presentational `Diff.jsx`/`FilesTouched.jsx`; `TimelineItem` gains inline diffs + an open-subagent button; `SubagentPanel` becomes optionally-controlled; `SessionView` adds a Timeline/Files toggle and the subagent map.

**Tech Stack:** React 19, node:test. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-14-files-touched-diff-lens-design.md`

**Test command:** `npm test`. Build: `npm run build`.

**Key data (from #3):** `tool_result` items have `item.result = { structuredPatch?, filePath?, stdout? }`; `structuredPatch` is `[{ oldStart, oldLines, newStart, newLines, lines:['-x','+y',' z'] }]` or `{ truncated:true }`. `tool_use` items have `id`. `listSubagents` returns `toolUseId`.

**ESM note:** `src/renderer/src/lib/` is ESM (it has a `package.json` with `type:module`). New lib modules use `export { ... }`; their node:test files load them via dynamic `import()` inside `describe`/`before` (the composerQueue test is the pattern to copy).

---

## Task 1: Pure helpers — diffStats + collectFilesTouched

**Files:**
- Create: `src/renderer/src/lib/filesTouched.js`, `tests/filesTouched.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/filesTouched.test.js`:

```js
const { test, describe, before } = require('node:test')
const assert = require('node:assert')

describe('filesTouched', () => {
  let diffStats, collectFilesTouched
  before(async () => {
    const mod = await import('../src/renderer/src/lib/filesTouched.js')
    ;({ diffStats, collectFilesTouched } = mod)
  })

  test('diffStats counts +/- lines, ignores context and truncated', () => {
    const patch = [{ lines: ['-a', '+b', ' c', '+d'] }]
    assert.deepStrictEqual(diffStats(patch), { adds: 2, dels: 1 })
    assert.deepStrictEqual(diffStats({ truncated: true }), { adds: 0, dels: 0 })
    assert.deepStrictEqual(diffStats(null), { adds: 0, dels: 0 })
  })

  test('collectFilesTouched groups tool_result items by filePath with totals', () => {
    const timeline = [
      { kind: 'user', text: 'hi' },
      { kind: 'tool_result', ts: 't1', result: { filePath: 'a.txt', structuredPatch: [{ lines: ['+x'] }] } },
      { kind: 'tool_result', ts: 't2', result: { filePath: 'a.txt', structuredPatch: [{ lines: ['-y', '+z'] }] } },
      { kind: 'tool_result', ts: 't3', result: { filePath: 'b.txt', structuredPatch: [{ lines: ['+1'] }] } },
      { kind: 'tool_result', ts: 't4', result: { stdout: 'no file here' } }
    ]
    const files = collectFilesTouched(timeline)
    assert.strictEqual(files.length, 2)
    const a = files.find((f) => f.filePath === 'a.txt')
    assert.strictEqual(a.edits.length, 2)
    assert.strictEqual(a.adds, 2)
    assert.strictEqual(a.dels, 1)
  })

  test('collectFilesTouched on an empty/no-file timeline returns []', () => {
    assert.deepStrictEqual(collectFilesTouched([]), [])
    assert.deepStrictEqual(collectFilesTouched(null), [])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/filesTouched.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/filesTouched.js`:

```js
// Pure aggregation of file edits from a parsed timeline. The diff data lives on
// tool_result items as item.result.structuredPatch (from the parser goldmine).

function diffStats(patch) {
  if (!Array.isArray(patch)) return { adds: 0, dels: 0 }
  let adds = 0
  let dels = 0
  for (const hunk of patch) {
    for (const line of (hunk && hunk.lines) || []) {
      if (line[0] === '+') adds++
      else if (line[0] === '-') dels++
    }
  }
  return { adds, dels }
}

function collectFilesTouched(timeline) {
  const byFile = new Map()
  for (const item of timeline || []) {
    if (!item || item.kind !== 'tool_result' || !item.result || !item.result.filePath) continue
    const fp = item.result.filePath
    const patch = item.result.structuredPatch
    const stats = diffStats(patch)
    if (!byFile.has(fp)) byFile.set(fp, { filePath: fp, edits: [], adds: 0, dels: 0 })
    const entry = byFile.get(fp)
    entry.edits.push({ ts: item.ts || null, patch: patch || null, stats })
    entry.adds += stats.adds
    entry.dels += stats.dels
  }
  return [...byFile.values()]
}

export { diffStats, collectFilesTouched }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/filesTouched.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/filesTouched.js tests/filesTouched.test.js
git commit -m "feat(files): pure diffStats + collectFilesTouched helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Diff component

**Files:**
- Create: `src/renderer/src/components/Diff.jsx`
- Modify: `src/renderer/src/index.css`

- [ ] **Step 1: Create Diff.jsx**

Create `src/renderer/src/components/Diff.jsx`:

```jsx
// Renders a structuredPatch (array of hunks) as a colored diff. No dep —
// the data is already structured (lines prefixed +/-/space).
export default function Diff({ patch }) {
  if (patch && patch.truncated) return <div className="diff-note">diff too large to show</div>
  if (!Array.isArray(patch) || patch.length === 0) return <div className="diff-note">(no changes)</div>
  return (
    <div className="diff">
      {patch.map((hunk, hi) => (
        <div key={hi} className="diff-hunk">
          <div className="diff-hunk-head">
            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
          </div>
          {(hunk.lines || []).map((line, li) => {
            const c = line[0]
            const cls = c === '+' ? 'diff-add' : c === '-' ? 'diff-del' : 'diff-ctx'
            return (
              <div key={li} className={'diff-line ' + cls}>
                {line || ' '}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Styles**

In `src/renderer/src/index.css`, append:

```css
.diff { font-family: var(--mono, monospace); font-size: 12px; border-radius: 6px; overflow-x: auto; margin: 4px 0; }
.diff-hunk-head { color: var(--text-faint); padding: 2px 8px; background: rgba(255,255,255,0.03); }
.diff-line { white-space: pre; padding: 0 8px; }
.diff-add { background: rgba(64,160,64,0.18); }
.diff-del { background: rgba(200,64,64,0.18); }
.diff-ctx { color: var(--text-faint); }
.diff-note { color: var(--text-faint); font-size: 12px; font-style: italic; padding: 4px 0; }
```

- [ ] **Step 3: Verify build**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Diff.jsx src/renderer/src/index.css
git commit -m "feat(diff): structuredPatch diff renderer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Inline diffs in tool_result items

**Files:**
- Modify: `src/renderer/src/components/TimelineItem.jsx`, `src/renderer/src/index.css`

- [ ] **Step 1: Import Diff + add a collapsible DiffResult**

In `src/renderer/src/components/TimelineItem.jsx`, add `import Diff from './Diff'` after the Markdown import. Add this component above `TimelineItemBase`:

```jsx
function DiffResult({ result }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="tl-diff">
      <button className="tl-diff-head" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} {result.filePath || 'diff'}
      </button>
      {open && <Diff patch={result.structuredPatch} />}
    </div>
  )
}
```

- [ ] **Step 2: Use it in the tool_result branch**

In `TimelineItemBase`, replace the tool_result branch:

```jsx
        ) : item.kind === 'tool_result' ? (
          <pre className="tl-pre tl-dim">{item.text}</pre>
        ) : item.kind === 'thinking' ? (
```

with:

```jsx
        ) : item.kind === 'tool_result' ? (
          item.result && item.result.structuredPatch ? (
            <DiffResult result={item.result} />
          ) : (
            <pre className="tl-pre tl-dim">{item.text}</pre>
          )
        ) : item.kind === 'thinking' ? (
```

- [ ] **Step 3: Styles**

In `src/renderer/src/index.css`, append:

```css
.tl-diff-head { background: none; border: none; color: var(--text-faint); cursor: pointer; font-family: var(--mono, monospace); font-size: 12px; padding: 0 0 2px; }
```

- [ ] **Step 4: Verify build**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TimelineItem.jsx src/renderer/src/index.css
git commit -m "feat(timeline): inline Edit/Write diffs on tool_result items

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Files-touched view + Timeline/Files toggle

**Files:**
- Create: `src/renderer/src/components/FilesTouched.jsx`
- Modify: `src/renderer/src/components/SessionView.jsx`, `src/renderer/src/index.css`

- [ ] **Step 1: Create FilesTouched.jsx**

Create `src/renderer/src/components/FilesTouched.jsx`:

```jsx
import { useState } from 'react'
import Diff from './Diff'
import { collectFilesTouched } from '../lib/filesTouched'

function FileRow({ file }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="ft-file">
      <button className="ft-head" onClick={() => setOpen((o) => !o)}>
        <span className="ft-caret">{open ? '▾' : '▸'}</span>
        <span className="ft-path">{file.filePath}</span>
        <span className="ft-stat ft-add">+{file.adds}</span>
        <span className="ft-stat ft-del">-{file.dels}</span>
        <span className="ft-count">{file.edits.length} edit{file.edits.length > 1 ? 's' : ''}</span>
      </button>
      {open && file.edits.map((e, i) => <Diff key={i} patch={e.patch} />)}
    </div>
  )
}

export default function FilesTouched({ timeline }) {
  const files = collectFilesTouched(timeline || [])
  if (!files.length) return <div className="sv-empty">No file edits in this session.</div>
  return (
    <div className="files-touched">
      {files.map((f) => (
        <FileRow key={f.filePath} file={f} />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Add the toggle to SessionView**

In `src/renderer/src/components/SessionView.jsx`:
- Add imports: `import FilesTouched from './FilesTouched'` and `import { collectFilesTouched } from '../lib/filesTouched'`.
- Add state near the others: `const [mainView, setMainView] = useState('timeline')`.
- Compute the count (after `detail` is known, near the `usage`/`cost` derivations): `const filesCount = (detail.timeline ? collectFilesTouched(detail.timeline) : []).length`.
- In `sv-header` (after the `sv-stats` block), add a segmented toggle:

```jsx
        <div className="sv-viewtoggle">
          <button className={mainView === 'timeline' ? 'active' : ''} onClick={() => setMainView('timeline')}>Timeline</button>
          <button className={mainView === 'files' ? 'active' : ''} onClick={() => setMainView('files')}>Files ({filesCount})</button>
        </div>
```

- Wrap the main pane: render `<FilesTouched>` when `mainView === 'files'`, else the existing `sv-timeline-wrap` (Virtuoso). Replace the `<div className="sv-timeline-wrap"> … </div>` block with:

```jsx
      {mainView === 'files' ? (
        <div className="sv-timeline-wrap">
          <FilesTouched timeline={detail.timeline} />
        </div>
      ) : (
        <div className="sv-timeline-wrap">
          {/* ...existing Virtuoso block + showJump button unchanged... */}
        </div>
      )}
```

(Keep the existing Virtuoso + `showJump` JSX exactly as-is inside the `else` branch.)

- [ ] **Step 3: Styles**

In `src/renderer/src/index.css`, append:

```css
.sv-viewtoggle { display: flex; gap: 4px; margin-top: 8px; }
.sv-viewtoggle button { background: rgba(255,255,255,0.05); border: 1px solid var(--border, #2a2a2a); color: var(--text-faint); padding: 3px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
.sv-viewtoggle button.active { color: var(--text); background: rgba(255,255,255,0.12); }
.files-touched { overflow-y: auto; height: 100%; padding: 4px 8px; }
.ft-file { border-bottom: 1px solid var(--border, #222); padding: 4px 0; }
.ft-head { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; color: var(--text); cursor: pointer; text-align: left; padding: 4px; }
.ft-path { flex: 1; font-family: var(--mono, monospace); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.ft-stat.ft-add { color: #6cc070; }
.ft-stat.ft-del { color: #d06060; }
.ft-count { color: var(--text-faint); font-size: 11px; }
```

- [ ] **Step 4: Verify build**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/FilesTouched.jsx src/renderer/src/components/SessionView.jsx src/renderer/src/index.css
git commit -m "feat(session): files-touched view + Timeline/Files toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Parent→subagent drill-in

**Files:**
- Modify: `src/renderer/src/components/SubagentPanel.jsx`, `src/renderer/src/components/TimelineItem.jsx`, `src/renderer/src/components/SessionView.jsx`

- [ ] **Step 1: Make SubagentPanel optionally controlled + report its list**

In `src/renderer/src/components/SubagentPanel.jsx`:
- Change the signature to `export default function SubagentPanel({ file, live, renderTimeline, openId: openIdProp, onOpenId, onList })`.
- Rename the internal open-row state to avoid the prop clash, and derive the effective id:

```jsx
  const [internalOpenId, setInternalOpenId] = useState(null)
  const openId = openIdProp !== undefined ? openIdProp : internalOpenId
  const setOpenId = onOpenId || setInternalOpenId
```

  (Replace the old `const [openId, setOpenId] = useState(null)` with the three lines above. The existing `openId`/`setOpenId` usages keep working.)
- In the list-load effect, after `setSubagents(r.subagents)`, also report up: `if (onList) onList(r.subagents)`.
- Auto-expand the panel when a row is opened externally — add an effect:

```jsx
  useEffect(() => {
    if (openId) setOpen(true)
  }, [openId])
```

- [ ] **Step 2: TimelineItem — open-subagent button on matching tool_use**

In `src/renderer/src/components/TimelineItem.jsx`:
- Add `subByToolUseId` and `onOpenSubagent` to the `TimelineItemBase` props.
- In the `tool_use` branch, after the `<span className="tl-tool">`, add:

```jsx
            {subByToolUseId && item.id && subByToolUseId[item.id] && (
              <button className="tl-open-subagent" onClick={() => onOpenSubagent && onOpenSubagent(subByToolUseId[item.id])}>
                ↘ open subagent
              </button>
            )}
```

- The `memo` comparison is default (shallow props); `subByToolUseId`/`onOpenSubagent` must be referentially stable (provided via useMemo/useCallback in Step 3) or memo'd items re-render. That's handled in Step 3.

- [ ] **Step 3: Wire SessionView**

In `src/renderer/src/components/SessionView.jsx`:
- Add state: `const [subOpenId, setSubOpenId] = useState(null)` and `const [subList, setSubList] = useState([])`.
- Build the map + handler (stable):

```jsx
  const subByToolUseId = useMemo(() => {
    const m = {}
    for (const s of subList) if (s.toolUseId) m[s.toolUseId] = s.agentId
    return m
  }, [subList])
  const onOpenSubagent = useCallback((agentId) => setSubOpenId(agentId), [])
```

(Add `useMemo` to the React import if not present.)
- Update the `SubagentPanel` usage to pass the controlled props:

```jsx
        <SubagentPanel
          file={detail.file}
          live={false}
          openId={subOpenId}
          onOpenId={setSubOpenId}
          onList={setSubList}
          renderTimeline={(items) => items.map((item, i) => <TimelineItem key={i} item={item} onImage={setLightbox} />)}
        />
```

- Pass the map + handler into the Virtuoso `itemContent`'s `TimelineItem`:

```jsx
          itemContent={(i, item) => (
            <TimelineItem item={item} onImage={setLightbox} flash={i === flashIdx} subByToolUseId={subByToolUseId} onOpenSubagent={onOpenSubagent} />
          )}
```

- [ ] **Step 4: Style the button**

In `src/renderer/src/index.css`, append:

```css
.tl-open-subagent { margin-left: 8px; background: rgba(137,180,250,0.15); border: 1px solid var(--accent, #89b4fa); color: var(--accent, #89b4fa); border-radius: 5px; font-size: 11px; padding: 1px 8px; cursor: pointer; }
```

- [ ] **Step 5: Verify build + full suite**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3 && npm test 2>&1 | tail -6`
Expected: build succeeds; all tests pass (285 prior + 3 filesTouched = 288).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/SubagentPanel.jsx src/renderer/src/components/TimelineItem.jsx src/renderer/src/components/SessionView.jsx src/renderer/src/index.css
git commit -m "feat(subagents): open a subagent from its parent Task tool_use

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** diffStats + collectFilesTouched (pure, tested) → Task 1; Diff renderer → Task 2; inline diffs on tool_result → Task 3; FilesTouched view + Timeline/Files toggle → Task 4; parent→subagent drill-in (controlled SubagentPanel + map + button) → Task 5. gh action deferred (out of scope, per spec).

**Placeholder scan:** new files have complete code; modifications give exact replacements + explicit "keep existing block" notes for the Virtuoso wrap.

**Type/name consistency:** `collectFilesTouched`/`diffStats` exports used in tests (Task 1), FilesTouched (Task 4), SessionView count (Task 4); `Diff` consumed by DiffResult (Task 3) and FilesTouched (Task 4); `subByToolUseId`/`onOpenSubagent` threaded SessionView→TimelineItem (Tasks 2-3 of #5 numbering / Task 5 here); SubagentPanel controlled props (`openId`/`onOpenId`/`onList`) match SessionView's usage.

**Notes for executor:** Tasks 1-2 independent; 3 depends on 2; 4 depends on 1+2; 5 depends on 4 (edits the same Virtuoso `itemContent`). Commit after each. No push/tag. JSX verified by build; helpers by unit test. After Task 5 confirm the memo stays effective (subByToolUseId via useMemo, onOpenSubagent via useCallback) so the timeline doesn't re-render per keystroke.
