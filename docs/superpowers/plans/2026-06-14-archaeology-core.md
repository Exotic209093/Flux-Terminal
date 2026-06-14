# Session Archaeology (core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Hooks panel, context-pressure gauge, and Markdown export — surfacing the #3 parser data + session export.

**Architecture:** Pure `toMarkdown` + a main `file:saveText` IPC; a `HooksPanel` and a compactions readout in `SessionView`, reusing its Timeline/Files toggle.

**Tech Stack:** React, Electron dialog/fs, node:test.

**Spec:** `docs/superpowers/specs/2026-06-14-archaeology-core-design.md`

**Test command:** `npm test`. Build: `npm run build`. `src/renderer/src/lib/` is ESM (tests dynamic import()). Data already present from #3: timeline `kind:'hook'` items (hookName/hookEvent/status/text), `detail.compactions`.

---

## Task 1: Markdown export

**Files:**
- Create: `src/renderer/src/lib/exportSession.js`, `tests/exportSession.test.js`
- Modify: `src/main/index.js`, `src/preload/index.js`, `src/renderer/src/components/SessionView.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/exportSession.test.js`:

```js
const { test, describe, before } = require('node:test')
const assert = require('node:assert')

describe('exportSession', () => {
  let toMarkdown
  before(async () => { ({ toMarkdown } = await import('../src/renderer/src/lib/exportSession.js')) })

  test('toMarkdown serialises a session timeline', () => {
    const md = toMarkdown({
      title: 'My session', cwd: '/p',
      timeline: [
        { kind: 'user', text: 'hello' },
        { kind: 'thinking', text: 'hmm' },
        { kind: 'text', text: 'hi there' },
        { kind: 'tool_use', toolName: 'Bash' },
        { kind: 'tool_result', text: 'output' }
      ]
    })
    assert.ok(md.startsWith('# My session'))
    assert.ok(md.includes('### You'))
    assert.ok(md.includes('hello'))
    assert.ok(md.includes('### Claude'))
    assert.ok(md.includes('> 💭 hmm'))
    assert.ok(md.includes('🔧 Bash'))
    assert.ok(md.includes('```'))
  })

  test('toMarkdown handles empty / missing input', () => {
    assert.strictEqual(typeof toMarkdown({}), 'string')
    assert.strictEqual(toMarkdown(null), '')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/exportSession.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement exportSession.js**

Create `src/renderer/src/lib/exportSession.js`:

```js
// Serialise a parsed session detail to Markdown.
function toMarkdown(detail) {
  if (!detail) return ''
  const out = ['# ' + (detail.title || 'Session')]
  if (detail.cwd) out.push('', '`' + detail.cwd + '`')
  out.push('')
  for (const it of detail.timeline || []) {
    switch (it.kind) {
      case 'user':
        out.push('### You', '', (it.text || '').trim(), '')
        break
      case 'text':
        out.push('### Claude', '', (it.text || '').trim(), '')
        break
      case 'thinking':
        out.push('> 💭 ' + (it.text || '').trim().replace(/\n/g, '\n> '), '')
        break
      case 'tool_use':
        out.push('**🔧 ' + (it.toolName || 'tool') + '**', '')
        break
      case 'tool_result':
        out.push('```', (it.text || '').slice(0, 2000), '```', '')
        break
      case 'hook':
        out.push('_hook: ' + (it.hookName || '') + '_', '')
        break
      default:
        break
    }
  }
  return out.join('\n')
}

export { toMarkdown }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/exportSession.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: file:saveText IPC + preload**

In `src/main/index.js`, add (near `dialog:pickFolder`; `dialog` and `fs` are already imported):

```js
ipcMain.handle('file:saveText', async (_e, { defaultName, content } = {}) => {
  try {
    const res = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName || 'export.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'All files', extensions: ['*'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    await fs.promises.writeFile(res.filePath, String(content || ''), 'utf-8')
    return { ok: true, path: res.filePath }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
```

In `src/preload/index.js`, add a bridge:

```js
  file: {
    saveText: (args) => ipcRenderer.invoke('file:saveText', args)
  },
```

- [ ] **Step 6: SessionView export button**

In `src/renderer/src/components/SessionView.jsx`: import `{ toMarkdown } from '../lib/exportSession'`. In the session header (`sv-header`, near the title/sub or the view toggle), add an Export button:

```jsx
        <button
          className="sv-export"
          title="Export this session as Markdown"
          onClick={() => window.flux.file.saveText({ defaultName: (detail.title || 'session').replace(/[^\w.-]+/g, '_') + '.md', content: toMarkdown(detail) })}
        >
          ⭳ Export
        </button>
```

- [ ] **Step 7: Build + commit**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3`
Expected: build succeeds.

```bash
git add src/renderer/src/lib/exportSession.js tests/exportSession.test.js src/main/index.js src/preload/index.js src/renderer/src/components/SessionView.jsx
git commit -m "feat(archaeology): Markdown session export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Hooks panel

**Files:**
- Create: `src/renderer/src/components/HooksPanel.jsx`
- Modify: `src/renderer/src/components/SessionView.jsx`, `src/renderer/src/index.css`

- [ ] **Step 1: Create HooksPanel.jsx**

```jsx
export default function HooksPanel({ timeline }) {
  const hooks = (timeline || []).filter((i) => i.kind === 'hook')
  if (!hooks.length) return <div className="sv-empty">No hook executions in this session.</div>
  return (
    <div className="hooks-panel">
      {hooks.map((h, i) => (
        <div key={i} className={'hook-row' + (h.status === 'hook_failure' ? ' fail' : '')}>
          <div className="hook-head">
            <span className="hook-name">{h.hookName || 'hook'}</span>
            {h.hookEvent && <span className="hook-event">{h.hookEvent}</span>}
            {h.status && <span className="hook-status">{h.status}</span>}
          </div>
          {h.text && <pre className="hook-out">{h.text}</pre>}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Wire the Hooks tab into SessionView**

In `src/renderer/src/components/SessionView.jsx` (which already has a `mainView` toggle of `'timeline' | 'files'` from #5):
- Import `HooksPanel from './HooksPanel'`.
- Compute `const hooksCount = (detail.timeline || []).filter((i) => i.kind === 'hook').length` (near `filesCount`).
- In the `sv-viewtoggle`, add a third button **only when `hooksCount > 0`**:

```jsx
          {hooksCount > 0 && (
            <button className={mainView === 'hooks' ? 'active' : ''} onClick={() => setMainView('hooks')}>Hooks ({hooksCount})</button>
          )}
```

- In the main-pane render switch, add a `mainView === 'hooks'` branch (alongside the existing files/timeline branches):

```jsx
      ) : mainView === 'hooks' ? (
        <div className="sv-timeline-wrap"><HooksPanel timeline={detail.timeline} /></div>
      ) : (
```

(Fit it into the existing `mainView === 'files' ? … : (timeline)` conditional so the three cases are files / hooks / timeline.)

- [ ] **Step 3: Styles**

In `src/renderer/src/index.css`, append:

```css
.hooks-panel { overflow-y: auto; height: 100%; padding: 6px 10px; }
.hook-row { border-bottom: 1px solid var(--border, #222); padding: 6px 2px; }
.hook-row.fail .hook-name { color: #d06060; }
.hook-head { display: flex; gap: 8px; align-items: center; }
.hook-name { font-family: var(--mono, monospace); font-size: 12px; color: var(--text); }
.hook-event, .hook-status { font-size: 11px; color: var(--text-faint); }
.hook-out { font-family: var(--mono, monospace); font-size: 11px; color: var(--text-faint); white-space: pre-wrap; margin: 4px 0 0; max-height: 160px; overflow: auto; }
```

- [ ] **Step 4: Build + commit**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3`
Expected: build succeeds.

```bash
git add src/renderer/src/components/HooksPanel.jsx src/renderer/src/components/SessionView.jsx src/renderer/src/index.css
git commit -m "feat(archaeology): hooks observability panel (Hooks tab)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Context-pressure gauge (compactions)

**Files:**
- Modify: `src/renderer/src/components/SessionView.jsx`, `src/renderer/src/index.css`

- [ ] **Step 1: Show the compaction count**

In `src/renderer/src/components/SessionView.jsx`, in the `sv-context` block (the context-window gauge), where the context label/percentage renders, append the compaction count when present:

```jsx
            {detail.compactions > 0 && (
              <span className="sv-compactions" title="History compactions in this session">· compacted {detail.compactions}×</span>
            )}
```

(Place it inside the `sv-context-top` row next to the percentage.)

- [ ] **Step 2: Style**

In `src/renderer/src/index.css`, append:

```css
.sv-compactions { color: var(--accent-2, #f5a97f); font-size: 11px; margin-left: 6px; }
```

- [ ] **Step 3: Build + full suite + commit**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3 && npm test 2>&1 | tail -5`
Expected: build succeeds; all tests pass (326 prior + 2 exportSession = 328).

```bash
git add src/renderer/src/components/SessionView.jsx src/renderer/src/index.css
git commit -m "feat(archaeology): context-pressure gauge shows compaction count

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Markdown export (toMarkdown + IPC + button) → Task 1; hooks panel + tab → Task 2; context-pressure compactions → Task 3. Heavy moat features (cinema scrubber, fork-from-here, Ask Flux, constellation, HTML export, chapters) deferred to the documented backlog in the spec.

**Placeholder scan:** exportSession + HooksPanel + IPC have full code; SessionView edits give exact JSX + the existing toggle/gauge anchors (implementer reads SessionView, which already has the `mainView` toggle from #5 and the `sv-context` gauge).

**Type/name consistency:** `toMarkdown` tested + used in the export button; `file:saveText` consistent main/preload/SessionView; `HooksPanel timeline=` filters `kind:'hook'` (the #3 shape); `detail.compactions` is the #3 model field.

**Notes for executor:** Tasks independent (all touch SessionView — do them in order to avoid edit churn). Commit after each. `toMarkdown` unit-tested; panels/gauge/IPC build-verified. No push/tag.
```
