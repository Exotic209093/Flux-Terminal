# Timeline Performance + Rich Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Virtualize + memoize the session timeline, render markdown + syntax-highlighted code + collapsible thinking + per-item timestamps, and make the composer never-blocking with queued sends and draft-preserved-on-failure. Plus scope terminal shortcuts to the terminal view.

**Architecture:** New `Markdown` + `TimelineItem` components and a pure `composerQueue` reducer; `SessionView`'s hand-rolled scroll list becomes `react-virtuoso`; terminal shortcuts gate on the active view + `attachCustomKeyEventHandler`.

**Tech Stack:** React 19, react-virtuoso, react-markdown + remark-gfm + rehype-highlight, xterm, node:test.

**Spec:** `docs/superpowers/specs/2026-06-14-timeline-rich-rendering-design.md`

**Test command:** `npm test`. Build: `npm run build`. No JSX test runner — JSX is build- + smoke-verified; only the pure `composerQueue` reducer is unit-tested.

**Reference (SessionView.jsx current):** `TimelineItem({item,onImage,flash})` renders by `item.kind` (`tool_use`/`tool_result`/`image`/else-plain-text). The list is `(detail.timeline||[]).map(...)` inside `<div className="sv-timeline" ref={scrollRef} onScroll={onScroll}>` (lines ~471-500), with a `pending` bubble + working/error rows after it, and a `showJump` ↓ button. Manual scroll: `scrollToBottom()` (scrollTop=scrollHeight), `autoFollow` ref, `onScroll` distance math, and a search-jump effect using `el.querySelectorAll('.tl-item')[scrollTarget.idx]`. `draft` is `useState` in SessionView; `Composer` is a child component; the textarea has `disabled={sendState==='running'}`; `submit()` does `setDraft('')` then `onSend(msg)`.

---

## Task 1: Dependencies + Markdown component

**Files:**
- Modify: `package.json`
- Create: `src/renderer/src/components/Markdown.jsx`
- Modify: `src/renderer/src/index.css`

- [ ] **Step 1: Install deps**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm install react-virtuoso react-markdown remark-gfm rehype-highlight highlight.js`
Expected: all five appear under `dependencies`.

- [ ] **Step 2: Create the Markdown component**

Create `src/renderer/src/components/Markdown.jsx`:

```jsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

// Safe markdown rendering for transcript text. react-markdown never uses
// innerHTML; links open through the main process's window-open-deny policy, so
// rendering them as anchors is inert. Syntax highlighting via highlight.js.
export default function Markdown({ text }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {text || ''}
      </ReactMarkdown>
    </div>
  )
}
```

- [ ] **Step 3: Add markdown + hljs styles**

In `src/renderer/src/index.css`, at the TOP of the file add the highlight.js theme import:

```css
@import 'highlight.js/styles/github-dark.css';
```

Then append markdown styles at the end:

```css
.md { line-height: 1.5; }
.md p { margin: 0 0 8px; }
.md p:last-child { margin-bottom: 0; }
.md pre { background: rgba(0,0,0,0.28); padding: 10px 12px; border-radius: 8px; overflow-x: auto; margin: 8px 0; }
.md code { font-family: var(--mono, monospace); font-size: 12.5px; }
.md :not(pre) > code { background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 4px; }
.md ul, .md ol { margin: 4px 0 8px; padding-left: 20px; }
.md a { color: var(--accent, #89b4fa); }
.md table { border-collapse: collapse; margin: 8px 0; }
.md th, .md td { border: 1px solid var(--border, #2a2a2a); padding: 4px 8px; }
.md h1, .md h2, .md h3 { margin: 10px 0 6px; }
```

- [ ] **Step 4: Verify build**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -4`
Expected: build succeeds (deps resolve, CSS import valid).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/renderer/src/components/Markdown.jsx src/renderer/src/index.css
git commit -m "feat(renderer): add rendering deps + Markdown component (gfm + hljs)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: composerQueue reducer (pure, TDD)

**Files:**
- Create: `src/renderer/src/lib/composerQueue.js`, `tests/composerQueue.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/composerQueue.test.js`:

```js
const { test, describe, before } = require('node:test')
const assert = require('node:assert')

// Dynamic import so this test file (CJS) can load the ESM module without
// relying on the require(esm) interop added in Node 22.12 / Node 24. Works
// on all Node 22+ versions within the engines range.
describe('composerQueue', () => {
  let emptyQueue, enqueue, dequeue, peek, size

  before(async () => {
    const mod = await import('../src/renderer/src/lib/composerQueue.js')
    ;({ emptyQueue, enqueue, dequeue, peek, size } = mod)
  })

  test('empty queue', () => {
    const q = emptyQueue()
    assert.strictEqual(size(q), 0)
    assert.strictEqual(peek(q), null)
    assert.deepStrictEqual(dequeue(q), { state: q, msg: null })
  })

  test('enqueue then dequeue is FIFO and immutable', () => {
    const q0 = emptyQueue()
    const q1 = enqueue(q0, 'a')
    const q2 = enqueue(q1, 'b')
    assert.strictEqual(size(q0), 0) // original untouched
    assert.strictEqual(size(q2), 2)
    assert.strictEqual(peek(q2), 'a')
    const { state: q3, msg } = dequeue(q2)
    assert.strictEqual(msg, 'a')
    assert.strictEqual(size(q3), 1)
    assert.strictEqual(peek(q3), 'b')
  })

  test('enqueue ignores empty/blank messages', () => {
    const q = enqueue(enqueue(emptyQueue(), '   '), '')
    assert.strictEqual(size(q), 0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/composerQueue.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/composerQueue.js`:

```js
// Pure FIFO queue for composer sends while a turn is running. Immutable ops so
// React state updates stay predictable.

function emptyQueue() {
  return { items: [] }
}

function size(q) {
  return q && q.items ? q.items.length : 0
}

function peek(q) {
  return size(q) ? q.items[0] : null
}

function enqueue(q, msg) {
  if (typeof msg !== 'string' || !msg.trim()) return q
  return { items: [...q.items, msg] }
}

function dequeue(q) {
  if (!size(q)) return { state: q, msg: null }
  const [msg, ...rest] = q.items
  return { state: { items: rest }, msg }
}

export { emptyQueue, enqueue, dequeue, peek, size }
```

(ESM so Vite can tree-shake and the renderer imports it normally. The test uses dynamic `import()` inside `describe`/`before` so it works on Node 22.0+ without relying on the require(esm) interop that was only stabilised in Node 22.12 / Node 24.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/composerQueue.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/composerQueue.js tests/composerQueue.test.js
git commit -m "feat(composer): pure FIFO send-queue reducer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Extract + enrich TimelineItem (memo, markdown, thinking, ts)

**Files:**
- Create: `src/renderer/src/components/TimelineItem.jsx`
- Modify: `src/renderer/src/components/SessionView.jsx`, `src/renderer/src/index.css`

- [ ] **Step 1: Create the memoized TimelineItem**

Create `src/renderer/src/components/TimelineItem.jsx`:

```jsx
import { memo, useState } from 'react'
import Markdown from './Markdown'

const KIND_LABEL = {
  user: 'You',
  text: 'Claude',
  thinking: 'Thinking',
  tool_use: 'Tool',
  tool_result: 'Result',
  image: 'Image',
  hook: 'Hook',
  compact: 'Compact'
}

function fmtTs(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function TimelineItemBase({ item, onImage, flash }) {
  const [open, setOpen] = useState(false)
  const cls = 'tl-item tl-' + item.kind + (item.isError ? ' tl-error' : '') + (flash ? ' tl-flash' : '')
  return (
    <div className={cls}>
      <div className="tl-gutter">
        <span className="tl-label">{KIND_LABEL[item.kind] || item.kind}</span>
        {item.ts && <span className="tl-ts">{fmtTs(item.ts)}</span>}
      </div>
      <div className="tl-body">
        {item.kind === 'tool_use' ? (
          <div>
            <span className="tl-tool">{item.toolName}</span>
            {item.toolInput && <pre className="tl-pre">{item.toolInput}</pre>}
          </div>
        ) : item.kind === 'tool_result' ? (
          <pre className="tl-pre tl-dim">{item.text}</pre>
        ) : item.kind === 'thinking' ? (
          <div className="tl-thinking">
            <button className="tl-thinking-toggle" onClick={() => setOpen((o) => !o)}>
              {open ? '▾' : '▸'} thinking
            </button>
            {open && <Markdown text={item.text} />}
          </div>
        ) : item.kind === 'image' ? (
          item.truncated ? (
            <div className="tl-img-omitted">🖼 image omitted (too large)</div>
          ) : (
            <img
              className="tl-img"
              src={`data:${item.mediaType};base64,${item.data}`}
              alt="session image"
              onClick={() => onImage && onImage(item)}
            />
          )
        ) : (
          <Markdown text={item.text} />
        )}
      </div>
    </div>
  )
}

const TimelineItem = memo(TimelineItemBase)
export default TimelineItem
```

- [ ] **Step 2: Use it in SessionView**

In `src/renderer/src/components/SessionView.jsx`:
- Add `import TimelineItem from './TimelineItem'` near the top imports.
- Delete the local `TimelineItem` function (lines ~38-70) and the local `KIND_LABEL` const (lines ~21-28) — they now live in `TimelineItem.jsx`.
- The two existing usages (`SubagentPanel`'s `renderTimeline` and the main list) keep calling `<TimelineItem item={...} onImage={setLightbox} flash={...} />` unchanged.

- [ ] **Step 3: Add thinking + ts styles**

In `src/renderer/src/index.css`, append:

```css
.tl-ts { color: var(--text-faint); font-size: 10px; margin-left: 6px; }
.tl-thinking-toggle { background: none; border: none; color: var(--text-faint); cursor: pointer; font-size: 12px; padding: 0; }
.tl-thinking { font-style: normal; }
```

- [ ] **Step 4: Verify build**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -4`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TimelineItem.jsx src/renderer/src/components/SessionView.jsx src/renderer/src/index.css
git commit -m "feat(renderer): memoized TimelineItem with markdown, collapsible thinking, timestamps

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Virtualize the timeline with react-virtuoso

**Files:**
- Modify: `src/renderer/src/components/SessionView.jsx`

- [ ] **Step 1: Import Virtuoso + add a ref**

Add `import { Virtuoso } from 'react-virtuoso'` to the imports. Add near the other refs: `const virtuosoRef = useRef(null)`.

- [ ] **Step 2: Replace the scroll list with Virtuoso**

Replace the timeline list block (the `<div className="sv-timeline" ref={scrollRef} onScroll={onScroll}> … </div>` containing the `.map`, the `pending` bubble, and the working/error rows — lines ~472-493) with:

```jsx
        <Virtuoso
          ref={virtuosoRef}
          className="sv-timeline"
          data={detail.timeline || []}
          followOutput={(atBottom) => (autoFollow.current && atBottom ? 'smooth' : false)}
          atBottomStateChange={(atBottom) => {
            autoFollow.current = atBottom
            setShowJump(!atBottom)
          }}
          itemContent={(i, item) => (
            <TimelineItem item={item} onImage={setLightbox} flash={i === flashIdx} />
          )}
          components={virtuosoComponents}
        />
```

Before the `return` statement, define the Footer component function outside the render and memoize the components object so Virtuoso gets a stable reference (an inline object literal causes Virtuoso to re-mount the Footer on every parent render):

```jsx
  function VirtuosoFooter() {
    return (
      <>
        {pending && (
          <div className="tl-item tl-user tl-pending">
            <div className="tl-gutter"><span className="tl-label">You</span></div>
            <div className="tl-body"><div className="tl-text">{pending}</div></div>
          </div>
        )}
        {sendState === 'running' && (
          <div className="tl-working"><span className="live-dot" /> claude is working…</div>
        )}
        {sendState === 'error' && <div className="tl-senderror">⚠ {friendlyError(sendError)}</div>}
        {sendState === 'interrupted' && <div className="tl-senderror tl-interrupted">◼ Interrupted</div>}
      </>
    )
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const virtuosoComponents = useMemo(() => ({ Footer: VirtuosoFooter }), [pending, sendState, sendError])
```

(`useMemo` must be called unconditionally before the early-return guards, so move it to just after the other hooks, and define `VirtuosoFooter` immediately above it. The deps `[pending, sendState, sendError]` are the only values the Footer reads, so `components` only gets a new reference when those change.)

- [ ] **Step 3: Replace manual scroll helpers with Virtuoso calls**

- `scrollToBottom()` → replace its body with: `virtuosoRef.current && virtuosoRef.current.scrollToIndex({ index: 'LAST', behavior: 'auto' })`.
- Delete the `onScroll` function (Virtuoso's `atBottomStateChange` replaces it) and remove the now-unused `scrollRef` (replace remaining `scrollRef.current` reads — there are none after this).
- `jumpToLatest()` → `autoFollow.current = true; setShowJump(false); virtuosoRef.current && virtuosoRef.current.scrollToIndex({ index: 'LAST', behavior: 'smooth' })`.
- In the auto-scroll effect (the `useEffect` keyed on `[sessionId, timelineLen, pending, sendState, detail]`), keep the logic but the `requestAnimationFrame(scrollToBottom)` calls now drive Virtuoso (scrollToBottom is redefined above). Leave the effect otherwise intact.

- [ ] **Step 4: Fix the search-jump effect for virtualization**

In the search-jump `useEffect` (keyed `[scrollTarget, detail]`), replace the DOM lookup:

```jsx
    const el = scrollRef.current
    if (!el) return
    const item = el.querySelectorAll('.tl-item')[scrollTarget.idx]
    if (!item) return
    consumedScrollKey.current = scrollTarget.key
    autoFollow.current = false
    setShowJump(false)
    item.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlashIdx(scrollTarget.idx)
```

with:

```jsx
    if (!virtuosoRef.current) return
    consumedScrollKey.current = scrollTarget.key
    autoFollow.current = false
    setShowJump(false)
    virtuosoRef.current.scrollToIndex({ index: scrollTarget.idx, align: 'center', behavior: 'smooth' })
    setFlashIdx(scrollTarget.idx)
    const timer = setTimeout(() => setFlashIdx(null), 900)
    return () => clearTimeout(timer)
```

(The `flash` highlight now renders via `itemContent`'s `flash={i===flashIdx}`, which Virtuoso re-renders when `flashIdx` changes. The timer clears the flash after 900 ms; the cleanup prevents stale timers on unmount or re-runs.)

- [ ] **Step 5: CSS — Virtuoso needs a sized scroll container**

In `src/renderer/src/index.css`, ensure `.sv-timeline` fills its wrapper (Virtuoso sets its own inner scroller height, but the element needs a height). If `.sv-timeline` currently relies on `flex:1`/`overflow:auto`, keep `flex: 1` and `min-height: 0` on it; Virtuoso manages `overflow` internally. Add if missing:

```css
.sv-timeline { flex: 1; min-height: 0; }
```

- [ ] **Step 6: Verify build + smoke**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -4`
Expected: build succeeds.

Run the session smoke screenshot (PowerShell):
`cd "C:/Users/james/Projects/Flux Terminal"; $env:FLUX_SMOKE_SHOT="C:/tmp/flux-tl.png"; $env:FLUX_SMOKE_VIEW="session"; npm run preview` (or `npm run dev`), then confirm `C:/tmp/flux-tl.png` shows a rendered timeline (markdown text, scrolled to bottom). Remove the env vars after. If the smoke harness isn't wired for `preview`, run `npm run dev` and verify manually.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/SessionView.jsx src/renderer/src/index.css
git commit -m "perf(renderer): virtualize session timeline with react-virtuoso

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Never-blocking composer + queued sends + draft-preserve

**Files:**
- Modify: `src/renderer/src/components/SessionView.jsx`

- [ ] **Step 1: Wire the queue state**

In `SessionView`, add imports + state:

```jsx
import { emptyQueue, enqueue, dequeue, size as queueSize } from '../lib/composerQueue'
```

Near the other state: `const [queue, setQueue] = useState(emptyQueue())` and `const lastSent = useRef(null)`.

- [ ] **Step 2: Make submit() queue while running**

Replace `submit()` with:

```jsx
  const submit = () => {
    const text = draft.trim()
    if ((!text && !attachment) || (!text && attachment === null)) return
    const display = text || '🖼 (image)'
    let msg = text
    if (attachment) {
      msg = (text ? text + '\n\n' : '') + '[The user attached an image. Read this file to view it: ' + attachment.file + ']'
    }
    setDraft('')
    setAttachment(null)
    if (sendState === 'running') {
      setQueue((q) => enqueue(q, JSON.stringify({ msg, display }))) // queued; flushed when the turn ends
      return
    }
    totalAtSend.current = totalCount
    setPending(display)
    lastSent.current = msg
    autoFollow.current = true
    setShowJump(false)
    onSend(msg)
  }
```

(Storing `{ msg, display }` as JSON in the queue keeps the queue type as string and the reducer pure, while giving the flush path a user-friendly display string.)

- [ ] **Step 2b: Flush the queue when a turn ends; restore draft on error**

Add an effect:

```jsx
  // When a turn finishes, send the next queued message. On error, put the failed
  // message back in the composer instead of losing it.
  useEffect(() => {
    if (sendState === 'running') return
    if (sendState === 'error' && lastSent.current && !draft.trim()) {
      setDraft(lastSent.current)
      lastSent.current = null
      return
    }
    if (queueSize(queue) > 0 && sendState !== 'error') {
      const { state, msg: entry } = dequeue(queue)
      const { msg, display } = JSON.parse(entry)
      setQueue(state)
      totalAtSend.current = totalCount
      setPending(display) // show user-friendly text, not the raw file path
      lastSent.current = msg
      autoFollow.current = true
      onSend(msg)
    }
  }, [sendState]) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Stop disabling the textarea; show queued count**

In the `Composer` component, remove `disabled={sendState === 'running'}` from the `<textarea>`. Pass a `queued` prop from SessionView (`queued={queueSize(queue)}`) and render a small indicator when `queued > 0`, e.g. above the textarea:

```jsx
        {queued > 0 && <div className="composer-queued">{queued} queued</div>}
```

Add the prop to both `<Composer ... queued={queueSize(queue)} />` call sites and the `Composer({ ..., queued })` signature. (The attach button may stay disabled while running, or also be enabled — enable it for consistency.)

- [ ] **Step 4: Style the queued indicator**

In `src/renderer/src/index.css`, append:

```css
.composer-queued { font-size: 11px; color: var(--text-faint); padding: 2px 4px; }
```

- [ ] **Step 5: Verify build + manual**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -4`
Expected: build succeeds.

Manual (`npm run dev`): while claude is working, type and press Enter → message shows "N queued" and is sent when the turn ends; trigger a send error (e.g., message an in-progress session) → the failed text returns to the composer.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/SessionView.jsx src/renderer/src/index.css
git commit -m "feat(composer): never-blocking input with queued sends + draft preserved on failure

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Scope terminal shortcuts to the terminal view

**Files:**
- Modify: `src/renderer/src/components/TerminalWorkspace.jsx`, `src/renderer/src/components/TerminalPane.jsx`, `src/renderer/src/App.jsx`

- [ ] **Step 1: Gate the workspace keydown on active view + drop the blocking confirm**

In `src/renderer/src/components/TerminalWorkspace.jsx`:
- Accept an `active` prop in the component signature.
- In the `keydown` effect, add as the first line of the handler: `if (!active) return`.
- Replace the Ctrl+W branch's blocking confirm with a direct close:

```js
      else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault()
        if (activeTab) closeTab(activeTab.id)
      }
```

- Add `active` to the effect's dependency array.

- [ ] **Step 2: Pass `active` from App**

In `src/renderer/src/App.jsx`, the TerminalWorkspace render (inside the always-mounted pane-slot) — pass `active`:

```jsx
          <TerminalWorkspace theme={theme} active={view === 'terminal'} onActivePty={setActivePtyId} />
```

- [ ] **Step 3: Stop xterm from also processing app shortcuts**

In `src/renderer/src/components/TerminalPane.jsx`, after the xterm `Terminal` is created and opened (where other addons/handlers are attached), add:

```js
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      // Let the app handle its window-level shortcuts; don't send them to the shell.
      if (e.altKey && /^Arrow/.test(e.key)) return false
      if (e.ctrlKey && e.shiftKey && /^[eEoO]$/.test(e.key)) return false
      if (e.ctrlKey && !e.shiftKey && /^[tTwW]$/.test(e.key)) return false
      if (e.ctrlKey && e.key === 'Tab') return false
      return true
    })
```

(Per-pane Ctrl+F scrollback search already has its own handling — keep it; this handler only returns false for the tab/split/focus combos.)

- [ ] **Step 4: Verify build + manual**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -4`
Expected: build succeeds.

Manual (`npm run dev`): in the Session view, Ctrl+T does NOT create a terminal tab; in the Terminal view, Ctrl+T/W/Tab work and don't leak characters into the shell; Ctrl+W closes a tab without a modal dialog.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TerminalWorkspace.jsx src/renderer/src/components/TerminalPane.jsx src/renderer/src/App.jsx
git commit -m "fix(terminal): scope tab/split/focus shortcuts to the terminal view

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** deps + Markdown → Task 1; composerQueue (pure, tested) → Task 2; memoized TimelineItem with markdown/thinking/ts → Task 3; virtualization (followOutput/atBottom/scrollToIndex/Footer) → Task 4; never-blocking composer + queue + draft-preserve → Task 5; terminal shortcut scoping → Task 6.

**Placeholder scan:** new files have complete code; integration edits give target code + explicit removals (the SessionView refactor is structural, so edits describe what to replace/delete with the exact replacement code).

**Type/name consistency:** `composerQueue` exports `emptyQueue/enqueue/dequeue/peek/size` — used in Task 2 test and Task 5 wiring; `Virtuoso` ref API (`scrollToIndex({index, align, behavior})`) used in Tasks 4; `TimelineItem` default export consumed by SessionView (Task 3) and Virtuoso `itemContent` (Task 4); `active` prop threaded App→TerminalWorkspace (Task 6).

**Notes for executor:** Tasks 1-2 independent; 3 depends on 1; 4 depends on 3; 5 depends on 2; 6 independent. Commit after each. No push/tag — merge is the controller's job. JSX changes are build- + smoke-verified; only composerQueue has unit tests. After Task 4, sanity-check that the search-jump (open a search hit) scrolls + flashes the right item, since that path changed most.
