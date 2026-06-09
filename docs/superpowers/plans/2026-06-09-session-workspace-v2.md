# Session Workspace v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full slash-command set, new-chat-in-UI + topbar model switcher + interrupt, subagent sub-views, and a topbar control cluster (model / running-agents / remote-control) to Flux Terminal — without changing the live terminal.

**Architecture:** Chat (new + resumed) keeps flowing through `claude [--resume <id>] -p --model <m>` child processes spawned by the main process; new chats seed a fresh `--session-id`. A new `subagents.js` main module discovers per-session `subagents/*.jsonl` transcripts (labels from the sibling `.meta.json`); the live tracker adds a running/total summary. The renderer gains focused components (`ModelPicker`, `SubagentPanel`, `ControlBar`) wired into the existing `SessionView` and topbar.

**Tech Stack:** Electron 42 (main = CommonJS, global `fetch`/`spawn`), React 19, Node 24 built-in test runner (`node --test`). No new deps.

**Spec:** `docs/superpowers/specs/2026-06-09-session-workspace-v2-design.md`

---

## Verified facts the plan relies on

- `claude` flags: `--model <id>`, `--session-id <uuid>`, `--resume [id]`, `-p`. New chat: `claude -p --session-id <uuid> --model <m>` then the file is a normal resumable session.
- Subagent layout: session file `~/.claude/projects/<enc>/<sessionId>.jsonl`; its subagents live at `~/.claude/projects/<enc>/<sessionId>/subagents/agent-<agentId>.jsonl`, each with a sibling `agent-<agentId>.meta.json` = `{ agentType, description, name, toolUseId }`. Derive the subagents dir from a session file path by stripping `.jsonl` and appending `/subagents`.
- The defensive `parseSessionFile(file, {timeline})` (parser.js) parses any of these transcripts.
- `package.json` has no `"type"` → `tests/*.js` are CommonJS; `npm test` runs `node --test "tests/**/*.test.js"`.
- Vite gotcha: every `src/main/*.js` MUST be a rollup input in `electron.vite.config.mjs` or the app crashes at boot.
- CSS vars available: `--bg, --bg-elev, --bg-panel, --bg-hover, --border, --text, --text-dim, --text-faint, --accent`.
- Smoke harness: `FLUX_SMOKE_SHOT=<png>` (+ optional `FLUX_SMOKE_VIEW=session|stats|skills`) captures one screenshot then quits. First capture after cold start is sometimes black — re-run.
- `window.flux` bridge currently exposes: `pty, sessions, skills, live, usage, commands, image`.

---

# PHASE 1 — Full slash-command set

### Task 1: Full command list + `interactive` flag (`commands.js`) — TDD

**Files:**
- Test: `tests/commands.test.js` (append)
- Modify: `src/main/commands.js`

- [ ] **Step 1: Append failing tests to `tests/commands.test.js`**

```js
test('every command carries a boolean interactive flag', () => {
  const cmds = listCommands(null, { userDir: path.join(tmpdir(), 'none') })
  for (const c of cmds) assert.strictEqual(typeof c.interactive, 'boolean', c.name + ' missing interactive')
})

test('the full builtin set is present and richer than the old short list', () => {
  const cmds = listCommands(null, { userDir: path.join(tmpdir(), 'none') })
  const names = cmds.map((c) => c.name)
  for (const expected of ['/agents', '/hooks', '/login', '/rewind', '/security-review', '/vim']) {
    assert.ok(names.includes(expected), 'missing builtin ' + expected)
  }
  assert.ok(cmds.length >= 30, 'expected the full set, got ' + cmds.length)
})

test('interactive-only builtins are flagged; prompt-driven ones are not', () => {
  const cmds = listCommands(null, { userDir: path.join(tmpdir(), 'none') })
  const byName = Object.fromEntries(cmds.map((c) => [c.name, c]))
  assert.strictEqual(byName['/clear'].interactive, true)
  assert.strictEqual(byName['/model'].interactive, true)
  assert.strictEqual(byName['/compact'].interactive, false)
  assert.strictEqual(byName['/security-review'].interactive, false)
})

test('custom commands are interactive:false', () => {
  const userDir = tmpdir()
  fs.writeFileSync(path.join(userDir, 'deploy.md'), '---\ndescription: Ship it\n---\n')
  const cmds = listCommands(null, { userDir })
  const deploy = cmds.find((c) => c.name === '/deploy')
  assert.strictEqual(deploy.interactive, false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `interactive` is undefined; builtins like `/agents` missing.

- [ ] **Step 3: Replace the `BUILTINS` block in `src/main/commands.js`**

Replace lines 8–24 (the `const BUILTINS = [...]` array through its `.map(...)`) with:

```js
// [name, description, interactive] — interactive:true = only does something in a
// live interactive session (a no-op when sent via `claude -p`); interactive:false
// = works when sent as a chat message. The composer marks the interactive ones.
const BUILTINS = [
  ['/add-dir', 'Add a working directory to the session', true],
  ['/agents', 'Manage agent configurations', true],
  ['/bashes', 'List & manage background shells', true],
  ['/clear', 'Clear conversation history', true],
  ['/compact', 'Compact the conversation, keeping a summary', false],
  ['/config', 'Open the config panel', true],
  ['/context', 'Visualize current context usage', true],
  ['/cost', 'Show total cost of this session', true],
  ['/doctor', 'Check the health of your Claude Code install', true],
  ['/effort', 'Set the thinking/effort level', true],
  ['/exit', 'Exit the session', true],
  ['/export', 'Export the conversation', true],
  ['/fast', 'Toggle fast mode', true],
  ['/feedback', 'Send feedback to Anthropic', true],
  ['/goal', 'Set the goal for the current run', true],
  ['/help', 'Show help and available commands', true],
  ['/hooks', 'Manage hooks', true],
  ['/init', 'Generate a CLAUDE.md for this project', true],
  ['/install-github-app', 'Install the GitHub app', true],
  ['/login', 'Log in to your account', true],
  ['/logout', 'Log out of your account', true],
  ['/mcp', 'Manage MCP servers', true],
  ['/memory', 'Edit Claude memory files', true],
  ['/model', 'Switch model (use the topbar model picker)', true],
  ['/permissions', 'Manage tool permissions', true],
  ['/pr-comments', 'Get comments from a GitHub pull request', false],
  ['/privacy-settings', 'Open privacy settings', true],
  ['/release-notes', 'Show release notes', true],
  ['/remote-control', 'Toggle remote control (use the topbar toggle)', true],
  ['/resume', 'Resume a past conversation', true],
  ['/review', 'Review a pull request', false],
  ['/rewind', 'Rewind the conversation to an earlier point', true],
  ['/security-review', 'Review pending changes for vulnerabilities', false],
  ['/status', 'Show Claude Code status', true],
  ['/statusline', 'Configure the status line', true],
  ['/terminal-setup', 'Configure terminal key bindings', true],
  ['/todos', 'View and manage the todo list', true],
  ['/upgrade', 'Upgrade your Claude plan', true],
  ['/usage', 'Show plan usage limits (see the topbar gauges)', true],
  ['/vim', 'Toggle vim editing mode', true]
].map(([name, description, interactive]) => ({ name, description, source: 'builtin', interactive }))
```

- [ ] **Step 4: Mark custom commands `interactive: false` in `scanCommandsDir`**

In `src/main/commands.js`, change the `out.push(...)` line inside `scanCommandsDir` from:

```js
    out.push({ name: '/' + e.name.slice(0, -3), description, source })
```

to:

```js
    out.push({ name: '/' + e.name.slice(0, -3), description, source, interactive: false })
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all prior tests + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/main/commands.js tests/commands.test.js
git commit -m "feat: full slash-command set with interactive flags" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: SlashMenu — terminal badge + non-send hint

**Files:**
- Modify: `src/renderer/src/components/SlashMenu.jsx`
- Modify: `src/renderer/src/components/SessionView.jsx`
- Modify: `src/renderer/src/index.css`

- [ ] **Step 1: Rewrite `SlashMenu.jsx` to show the badge**

Replace the whole file with:

```jsx
// Autocomplete dropdown for slash commands, rendered above the composer.
// onMouseDown (not onClick) so picking an item doesn't blur the textarea.
// Interactive-only commands get a "terminal" badge; picking one is handled by
// the parent (it shows a hint instead of sending).
export default function SlashMenu({ items, selected, onPick }) {
  if (!items.length) return null
  return (
    <div className="slash-menu">
      {items.map((c, i) => (
        <button
          key={c.name + ':' + c.source}
          className={'slash-item' + (i === selected ? ' selected' : '')}
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(c)
          }}
        >
          <span className="slash-name">{c.name}</span>
          <span className="slash-desc">{c.description}</span>
          {c.interactive ? (
            <span className="slash-badge" title="Interactive command — run it in the Terminal tab">
              terminal
            </span>
          ) : (
            <span className={'slash-src slash-src-' + c.source}>{c.source}</span>
          )}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Handle interactive picks in `SessionView.jsx`**

Find `completeSlash` (added in the earlier slash-commands work) — it currently does:

```js
const completeSlash = (c) => {
  setDraft(c.name + ' ')
  setSlashIndex(0)
}
```

Add a `slashHint` state with the other `useState` calls (above the early returns):

```js
const [slashHint, setSlashHint] = useState(null)
```

Replace `completeSlash` with:

```js
const completeSlash = (c) => {
  if (c.interactive) {
    // No-op via `claude -p`; tell the user where it actually works.
    const where =
      c.name === '/model'
        ? 'Use the model picker in the top bar.'
        : c.name === '/remote-control'
          ? 'Use the Remote toggle in the top bar.'
          : 'Run this in the Terminal tab — it only works in a live session.'
    setSlashHint(`${c.name} is a terminal command. ${where}`)
    setSlashIndex(0)
    return
  }
  setSlashHint(null)
  setDraft(c.name + ' ')
  setSlashIndex(0)
}
```

In the composer JSX, render the hint just above the `SlashMenu` (inside `.composer-mid`, before the `{slashItems.length > 0 && (...)}` block):

```jsx
{slashHint && <div className="slash-hint">{slashHint}</div>}
```

Clear the hint when the draft changes — find the existing reset effect that depends on `slashFilter` and add `setSlashHint(null)` to it:

```js
useEffect(() => {
  setSlashIndex(0)
  setSlashDismissed(false)
  setSlashHint(null)
}, [slashFilter]) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Styles — append to `src/renderer/src/index.css`**

```css
.slash-badge {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #e8a33d;
  border: 1px solid #e8a33d55;
  border-radius: 4px;
  padding: 0 5px;
}
.slash-hint {
  align-self: flex-start;
  margin-bottom: 6px;
  font-size: 11.5px;
  color: var(--text-dim);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
}
```

- [ ] **Step 4: Build + manual verify**

Run: `npm run build`
Expected: success.

Run: `npm run preview`, open a past session, type `/`.
Expected: the menu lists the full command set; interactive commands show an amber "terminal" badge; picking `/model` shows a hint pointing to the topbar picker; picking `/compact` (no badge) inserts it for sending.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SlashMenu.jsx src/renderer/src/components/SessionView.jsx src/renderer/src/index.css
git commit -m "feat: mark terminal-only commands in the slash menu with a non-send hint" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PHASE 2 — Chat upgrade (new chat + model switcher + interrupt)

### Task 3: Model list lib (`models.js`) — TDD

**Files:**
- Test: `tests/models.test.js` (create)
- Create: `src/renderer/src/lib/models.js`

> Renderer libs are ESM, but this file is pure data + pure functions with no DOM/React, so it unit-tests cleanly under `node --test` via dynamic `import()`.

- [ ] **Step 1: Create `tests/models.test.js`**

```js
const test = require('node:test')
const assert = require('node:assert')

test('models list has id+label and a resolvable default', async () => {
  const { MODELS, DEFAULT_MODEL, isKnownModel } = await import('../src/renderer/src/lib/models.js')
  assert.ok(Array.isArray(MODELS) && MODELS.length >= 4)
  for (const m of MODELS) {
    assert.strictEqual(typeof m.id, 'string')
    assert.strictEqual(typeof m.label, 'string')
  }
  assert.ok(MODELS.some((m) => m.id === DEFAULT_MODEL), 'default must be in the list')
  assert.strictEqual(isKnownModel(DEFAULT_MODEL), true)
  assert.strictEqual(isKnownModel('nope'), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `models.js`.

- [ ] **Step 3: Create `src/renderer/src/lib/models.js`**

```js
// Selectable models for the chat composer's model picker. Kept in sync with the
// pricing table in lib/pricing.js. `id` is what we pass to `claude --model`.
export const MODELS = [
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' }
]

export const DEFAULT_MODEL = 'claude-opus-4-8'

export function isKnownModel(id) {
  return MODELS.some((m) => m.id === id)
}

export function modelLabelFor(id) {
  const m = MODELS.find((x) => x.id === id)
  return m ? m.label : id
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/models.test.js src/renderer/src/lib/models.js
git commit -m "feat: selectable model list for the composer model picker" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: ModelPicker component + persisted model state

**Files:**
- Create: `src/renderer/src/components/ModelPicker.jsx`
- Modify: `src/renderer/src/App.jsx`
- Modify: `src/renderer/src/index.css`

> The picker is built and mounted in the topbar now; Phase 4 repositions it inside `ControlBar`. The selected model is owned by `App` so both the topbar and the send calls read one source.

- [ ] **Step 1: Create `src/renderer/src/components/ModelPicker.jsx`**

```jsx
import { MODELS } from '../lib/models'

// Chat model selector. Controlled by App; the chosen model is passed to every
// `claude` chat send (new + resumed). Does NOT affect the live terminal.
export default function ModelPicker({ model, onChange }) {
  return (
    <label className="model-picker" title="Model used for chats (new + resumed). Not the terminal.">
      <span className="model-picker-diamond">◆</span>
      <select value={model} onChange={(e) => onChange(e.target.value)}>
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  )
}
```

- [ ] **Step 2: Own the model state in `App.jsx`**

Add imports:

```js
import ModelPicker from './components/ModelPicker'
import { DEFAULT_MODEL, isKnownModel } from './lib/models'
```

Add state with the other `useState` hooks in `App()`:

```js
const [model, setModelState] = useState(() => {
  const saved = localStorage.getItem('flux.model')
  return saved && isKnownModel(saved) ? saved : DEFAULT_MODEL
})
const setModel = useCallback((m) => {
  localStorage.setItem('flux.model', m)
  setModelState(m)
}, [])
```

In the topbar JSX, render the picker just before `<UsageBar />` (it moves into ControlBar in Phase 4):

```jsx
<ModelPicker model={model} onChange={setModel} />
```

- [ ] **Step 3: Styles — append to `src/renderer/src/index.css`**

```css
.model-picker {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-dim);
  margin-left: auto;
  padding-right: 10px;
}
.model-picker-diamond { color: var(--accent); }
.model-picker select {
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 12px;
  cursor: pointer;
}
```

(If `.usage-bar` also sets `margin-left: auto`, that's fine — the first auto-margin wins the spacer role; the bars sit together on the right.)

- [ ] **Step 4: Build + smoke**

Run: `npm run build`
Expected: success.

Run (PowerShell): `$env:FLUX_SMOKE_SHOT="C:\tmp\flux-modelpicker.png"; npm run preview` then `Remove-Item Env:FLUX_SMOKE_SHOT`.
Expected: `FLUX_SMOKE_SHOT_OK`; topbar shows a model dropdown (default "Opus 4.8") left of the usage gauges.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ModelPicker.jsx src/renderer/src/App.jsx src/renderer/src/index.css
git commit -m "feat: topbar model picker with persisted selection" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Main-process — model passthrough, `session:new`, folder picker, interrupt

**Files:**
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

- [ ] **Step 1: Add `model` passthrough to `session:send`**

In `src/main/index.js`, change the `session:send` handler signature and the spawn args. Replace:

```js
ipcMain.handle('session:send', (_e, { sessionId, cwd, message }) => {
```

with:

```js
ipcMain.handle('session:send', (_e, { sessionId, cwd, message, model }) => {
```

And replace the spawn line:

```js
    const child = spawn('claude', ['--resume', sessionId, '-p'], {
```

with:

```js
    const args = ['--resume', sessionId, '-p']
    if (model) args.push('--model', model)
    const child = spawn('claude', args, {
```

- [ ] **Step 2: Add the `session:new` handler**

Immediately after the `session:send` handler's closing `})`, add:

```js
// ---- New chat -------------------------------------------------------------
// Start a fresh session in the rich UI: generate a uuid, run
// `claude -p --session-id <uuid> --model <m>` from the chosen cwd, prompt on
// stdin. Afterwards <uuid>.jsonl exists and is a normal resumable session.
const { randomUUID } = require('crypto')
ipcMain.handle('session:new', (_e, { message, cwd, model }) => {
  if (!message) return { ok: false, error: 'missing message' }
  const dir = cwd || os.homedir()
  if (!fs.existsSync(dir)) return { ok: false, error: 'Working folder does not exist:\n' + dir }
  const sessionId = randomUUID()
  try {
    const args = ['-p', '--session-id', sessionId]
    if (model) args.push('--model', model)
    const child = spawn('claude', args, { cwd: dir, shell: true, windowsHide: true })
    sendChild = child
    lastSentAt = Date.now()
    emit('session:sendstatus', { sessionId, state: 'running' })

    let stderr = ''
    let settled = false
    const finish = (state, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      emit('session:sendstatus', { sessionId, state, error: error || null })
      sendChild = null
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish('error', "claude didn't respond in time.")
    }, 150000)
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', (err) => finish('error', err.message))
    child.on('exit', (code) =>
      finish(code === 0 ? 'done' : 'error', code === 0 ? null : stderr.slice(0, 400) || 'claude exited ' + code)
    )
    child.stdin.write(message)
    child.stdin.end()
    return { ok: true, sessionId, cwd: dir }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ---- Interrupt ------------------------------------------------------------
ipcMain.handle('session:interrupt', () => {
  if (!sendChild) return { ok: false, error: 'nothing running' }
  try {
    sendChild.kill()
  } catch {
    /* already gone */
  }
  // The child's 'exit' handler emits the terminal status; flag it interrupted.
  emit('session:sendstatus', { state: 'interrupted', error: null })
  return { ok: true }
})

// ---- Folder picker (new-chat working dir) ---------------------------------
ipcMain.handle('dialog:pickFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  if (res.canceled || !res.filePaths[0]) return { ok: false }
  return { ok: true, path: res.filePaths[0] }
})
```

- [ ] **Step 3: Import `dialog`**

At the top of `src/main/index.js`, add `dialog` to the electron import:

```js
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
```

(If the existing line is `const { app, BrowserWindow, ipcMain } = require('electron')`, just add `, dialog`.)

- [ ] **Step 4: Bridge the new IPC in `src/preload/index.js`**

In the `sessions` namespace, add `newChat`, `interrupt`; add a top-level `dialog` namespace. Change the `sessions` object's `send` area to include:

```js
    send: (args) => ipcRenderer.invoke('session:send', args),
    newChat: (args) => ipcRenderer.invoke('session:new', args),
    interrupt: () => ipcRenderer.invoke('session:interrupt'),
```

And after the `image` namespace, add:

```js
  ,
  dialog: {
    pickFolder: () => ipcRenderer.invoke('dialog:pickFolder')
  }
```

(Ensure valid object syntax — the `dialog` key is a sibling of `pty`/`sessions`/etc.)

- [ ] **Step 5: Build to verify wiring**

Run: `npm run build`
Expected: all three bundles succeed.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat: session:new + session:interrupt + folder picker + model passthrough" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: New-chat UI flow

**Files:**
- Modify: `src/renderer/src/App.jsx`
- Modify: `src/renderer/src/components/Sidebar.jsx`
- Modify: `src/renderer/src/components/SessionView.jsx`
- Modify: `src/renderer/src/index.css`

- [ ] **Step 1: "+ New chat" button in `Sidebar.jsx`**

`Sidebar` receives props from App. Add an `onNewChat` prop and a button at the top of the sidebar (above the session list / search). Add near the top of the sidebar's returned JSX, as the first child:

```jsx
<button className="new-chat-btn" onClick={onNewChat}>+ New chat</button>
```

Add `onNewChat` to the component's destructured props.

- [ ] **Step 2: New-chat state + handler in `App.jsx`**

Add state with the other hooks:

```js
const [newChat, setNewChat] = useState(null) // { cwd } when composing a new chat
```

Add the handler (near `openSession`):

```js
const startNewChat = useCallback(() => {
  setSelected(null)
  setDetail(null)
  setSendState(null)
  setSendError(null)
  setNewChat({ cwd: '' }) // '' => main defaults to home; user can pick a folder
  setView('session')
}, [])
```

Add a `sendNewChat` handler that calls `session:new`, then opens the created session:

```js
const sendNewChat = useCallback(
  (message) => {
    if (sendState === 'running') return
    setSendState('running')
    setSendError(null)
    window.flux.sessions
      .newChat({ message, cwd: newChat?.cwd || null, model })
      .then((res) => {
        if (!res.ok) {
          setSendState('error')
          setSendError(res.error || 'failed to start chat')
          return
        }
        // Poll briefly for the new session file, then open it like any session.
        const open = (tries) => {
          window.flux.sessions.list({ limit: 50 }).then((r) => {
            const found = r.ok && r.sessions.find((s) => s.sessionId === res.sessionId)
            if (found) {
              setNewChat(null)
              openSession(found)
            } else if (tries > 0) {
              setTimeout(() => open(tries - 1), 600)
            }
          })
        }
        open(8)
      })
      .catch((e) => {
        setSendState('error')
        setSendError(String(e))
      })
  },
  [newChat, model, sendState, openSession]
)
```

Pass new-chat props to `Sidebar` and `SessionView`. Update the `<Sidebar ... />` usage to include `onNewChat={startNewChat}`. Update the `view === 'session'` render to pass new-chat info:

```jsx
{view === 'session' && (
  <div className="pane-slot">
    <SessionView
      detail={detail}
      loading={loadingDetail}
      sendState={sendState}
      sendError={sendError}
      onSend={newChat ? sendNewChat : sendMessage}
      newChat={newChat}
      onPickFolder={async () => {
        const r = await window.flux.dialog.pickFolder()
        if (r.ok) setNewChat((nc) => ({ ...(nc || {}), cwd: r.path }))
      }}
    />
  </div>
)}
```

- [ ] **Step 3: Render the new-chat composer in `SessionView.jsx`**

`SessionView` currently early-returns "Select a session to relive it." when `!detail`. Replace that branch so that in new-chat mode it shows an empty composer instead. Add `newChat` and `onPickFolder` to the destructured props, and change the early return:

```js
if (loading) return <div className="sv-empty">Loading session…</div>
if (!detail && !newChat) return <div className="sv-empty">Select a session to relive it.</div>
if (detail && detail.ok === false) return <div className="sv-empty error">⚠ {detail.error}</div>
```

When `newChat && !detail`, render a minimal header + the composer. Just before the main `return (...)`, add:

```jsx
if (newChat && !detail) {
  return (
    <div className="session-view">
      <div className="sv-header">
        <h2 className="sv-title">New chat</h2>
        <div className="sv-sub">
          <span className="sv-project">{newChat.cwd || 'home folder'}</span>
          <button className="folder-pick" onClick={onPickFolder} title="Choose working folder">
            📁 choose folder
          </button>
        </div>
      </div>
      <div className="sv-timeline-wrap">
        <div className="sv-timeline">
          <div className="sv-empty">Type a message to start a new chat with the selected model.</div>
          {sendState === 'running' && (
            <div className="tl-working">
              <span className="live-dot" /> claude is working…
            </div>
          )}
          {sendState === 'error' && <div className="tl-senderror">⚠ {sendError}</div>}
        </div>
      </div>
      <Composer
        draft={draft}
        setDraft={setDraft}
        onKeyDown={onKeyDown}
        onSubmit={submit}
        sendState={sendState}
        slashItems={slashItems}
        slashSel={slashSel}
        completeSlash={completeSlash}
        slashHint={slashHint}
        attachment={attachment}
        setAttachment={setAttachment}
        fileInputRef={fileInputRef}
        stashImage={stashImage}
        onPaste={onPaste}
      />
    </div>
  )
}
```

> **Refactor note:** the composer markup currently lives inline at the bottom of the main return. To reuse it for new-chat, extract it into a local `Composer` component at the bottom of `SessionView.jsx` (move the existing `<div className="sv-composer">…</div>` JSX into `function Composer({...props}) { return (...) }`, replacing the local identifiers with the passed props) and render `<Composer .../>` in both the main return and the new-chat return. This keeps one composer implementation. If extraction risks breaking the existing wiring, report DONE_WITH_CONCERNS and keep the new-chat composer as a duplicated block instead.

- [ ] **Step 4: Styles — append to `src/renderer/src/index.css`**

```css
.new-chat-btn {
  width: 100%;
  margin: 0 0 10px;
  padding: 8px 10px;
  background: var(--accent);
  color: #0b0e14;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.new-chat-btn:hover { filter: brightness(1.08); }
.folder-pick {
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 8px;
}
.folder-pick:hover { color: var(--text); background: var(--bg-hover); }
```

- [ ] **Step 5: Build + manual verify**

Run: `npm run build`
Expected: success.

Run: `npm run preview`. Click "+ New chat", optionally pick a folder, type "say hello" and send.
Expected: status shows "claude is working…", then the view switches to the newly-created session with claude's reply in the timeline. Switching the model picker first and starting a new chat uses that model.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.jsx src/renderer/src/components/Sidebar.jsx src/renderer/src/components/SessionView.jsx src/renderer/src/index.css
git commit -m "feat: start new chats in the rich UI with folder + model selection" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Interrupt button (Stop while running)

**Files:**
- Modify: `src/renderer/src/components/SessionView.jsx`
- Modify: `src/renderer/src/App.jsx`
- Modify: `src/renderer/src/index.css`

- [ ] **Step 1: Handle the `interrupted` status in `App.jsx`**

The `onSendStatus` subscription currently maps states to `running`/`error`/`null`. Update it to recognize `interrupted` as a terminal non-error state. Find:

```js
const offStatus = window.flux.sessions.onSendStatus(({ state, error }) => {
  setSendState(state === 'running' ? 'running' : state === 'error' ? 'error' : null)
  setSendError(state === 'error' ? error : null)
})
```

Replace with:

```js
const offStatus = window.flux.sessions.onSendStatus(({ state, error }) => {
  if (state === 'running') setSendState('running')
  else if (state === 'error') { setSendState('error'); setSendError(error) }
  else if (state === 'interrupted') { setSendState('interrupted'); setSendError(null) }
  else setSendState(null)
})
```

- [ ] **Step 2: Stop button in the `Composer` (in `SessionView.jsx`)**

In the extracted `Composer`, the send button currently renders Send/`…`. Replace the send `<button>` with a Stop variant while running:

```jsx
{sendState === 'running' ? (
  <button className="composer-stop" onClick={() => window.flux.sessions.interrupt()} title="Stop">
    ◼ Stop
  </button>
) : (
  <button
    className="composer-send"
    onClick={onSubmit}
    disabled={!draft.trim() && !attachment}
  >
    Send
  </button>
)}
```

- [ ] **Step 3: Show the interrupted state in the timeline**

In `SessionView.jsx`'s main return, where `sendState === 'error'` is handled in the timeline, add an interrupted line. Find the `{sendState === 'error' && ...}` line in the timeline and add before/after it:

```jsx
{sendState === 'interrupted' && <div className="tl-senderror tl-interrupted">◼ Interrupted</div>}
```

(Add the same line to the new-chat return's timeline block from Task 6.)

- [ ] **Step 4: Styles — append to `src/renderer/src/index.css`**

```css
.composer-stop {
  background: #e8503d;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  align-self: flex-end;
}
.composer-stop:hover { filter: brightness(1.08); }
.tl-interrupted { color: #e8a33d; }
```

- [ ] **Step 5: Build + manual verify**

Run: `npm run build`
Expected: success.

Run: `npm run preview`, open a session, send a message that takes a while, click **Stop** mid-turn.
Expected: the child is killed; the timeline shows "◼ Interrupted"; the composer returns to Send.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/SessionView.jsx src/renderer/src/App.jsx src/renderer/src/index.css
git commit -m "feat: interrupt a running chat turn with a Stop button" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PHASE 3 — Subagent sub-views

### Task 8: Subagent discovery (`subagents.js`) — TDD

**Files:**
- Test: `tests/subagents.test.js` (create)
- Create: `src/main/subagents.js`
- Modify: `electron.vite.config.mjs`

- [ ] **Step 1: Create `tests/subagents.test.js`**

```js
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { listSubagents, readSubagent, subagentsDirFor } = require('../src/main/subagents')

function makeSession() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-sa-'))
  const sessionId = 'sess-123'
  const file = path.join(proj, sessionId + '.jsonl')
  fs.writeFileSync(file, JSON.stringify({ type: 'user', sessionId, message: { content: 'hi' } }) + '\n')
  const sub = path.join(proj, sessionId, 'subagents')
  fs.mkdirSync(sub, { recursive: true })
  return { file, sub }
}

function writeAgent(sub, id, meta, lines) {
  fs.writeFileSync(path.join(sub, `agent-${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  if (meta) fs.writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify(meta))
}

test('subagentsDirFor maps a session file to its subagents dir', () => {
  const d = subagentsDirFor('/x/y/sess-123.jsonl')
  assert.strictEqual(d, path.join('/x/y/sess-123', 'subagents'))
})

test('listSubagents returns label from meta + aggregated counts; missing dir -> []', () => {
  const { file, sub } = makeSession()
  writeAgent(sub, 'aaa', { agentType: 'Explore', description: 'Find the bug', name: 'scout' }, [
    { type: 'user', message: { content: 'go' } },
    { type: 'assistant', message: { model: 'claude-opus-4-8', usage: { output_tokens: 5 }, content: [{ type: 'text', text: 'done' }] } }
  ])
  const list = listSubagents(file, { liveFresh: false })
  assert.strictEqual(list.length, 1)
  assert.strictEqual(list[0].agentId, 'aaa')
  assert.strictEqual(list[0].label, 'Find the bug')
  assert.strictEqual(list[0].agentType, 'Explore')
  assert.strictEqual(list[0].status, 'done')
  assert.ok(list[0].counts.total >= 1)

  assert.deepStrictEqual(listSubagents('/no/such/sess.jsonl'), [])
})

test('label falls back to first user line when meta is absent', () => {
  const { file, sub } = makeSession()
  writeAgent(sub, 'bbb', null, [{ type: 'user', message: { content: 'You are implementing Task 8: do the thing.' } }])
  const list = listSubagents(file, { liveFresh: false })
  const b = list.find((a) => a.agentId === 'bbb')
  assert.match(b.label, /implementing Task 8/)
})

test('status is running only when live + file mtime is fresh', () => {
  const { file, sub } = makeSession()
  writeAgent(sub, 'ccc', { description: 'Busy agent' }, [{ type: 'user', message: { content: 'go' } }])
  const live = listSubagents(file, { live: true, now: Date.now(), freshMs: 60000 })
  assert.strictEqual(live.find((a) => a.agentId === 'ccc').status, 'running')
  const old = listSubagents(file, { live: true, now: Date.now() + 10 * 60000, freshMs: 60000 })
  assert.strictEqual(old.find((a) => a.agentId === 'ccc').status, 'done')
})

test('readSubagent returns a parsed timeline', () => {
  const { file, sub } = makeSession()
  writeAgent(sub, 'ddd', { description: 'x' }, [
    { type: 'user', message: { content: 'go' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }
  ])
  const detail = readSubagent(file, 'ddd')
  assert.ok(detail.ok !== false)
  assert.ok(Array.isArray(detail.timeline))
  assert.ok(detail.timeline.some((t) => t.kind === 'text' && /hello/.test(t.text)))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `subagents.js`.

- [ ] **Step 3: Create `src/main/subagents.js`**

```js
const fs = require('fs')
const path = require('path')
const { parseSessionFile } = require('./parser')

// Discovery of a session's subagents (sidechain transcripts). For a session file
// at <dir>/<id>.jsonl, the subagents live at <dir>/<id>/subagents/agent-*.jsonl,
// each with a sibling agent-*.meta.json = { agentType, description, name, toolUseId }.

const DEFAULT_FRESH_MS = 12000 // a live subagent file written within this window = "running"

/** Map a session .jsonl path to its subagents directory. */
function subagentsDirFor(sessionFile) {
  const dir = path.dirname(sessionFile)
  const id = path.basename(sessionFile).replace(/\.jsonl$/, '')
  return path.join(dir, id, 'subagents')
}

function firstUserLine(parsed) {
  const t = (parsed.timeline || []).find((x) => x.kind === 'user')
  if (!t || !t.text) return ''
  return t.text.split('\n')[0].slice(0, 120)
}

function readMeta(metaPath) {
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * List a session's subagents. opts: { live, now, freshMs } control status.
 * Returns [] if the session has no subagents dir.
 */
function listSubagents(sessionFile, opts = {}) {
  const dir = subagentsDirFor(sessionFile)
  let entries
  try {
    entries = fs.readdirSync(dir).filter((f) => /^agent-.*\.jsonl$/.test(f))
  } catch {
    return []
  }
  const live = !!opts.live
  const now = opts.now || Date.now()
  const freshMs = opts.freshMs || DEFAULT_FRESH_MS
  const out = []
  for (const f of entries) {
    const full = path.join(dir, f)
    const agentId = f.replace(/^agent-/, '').replace(/\.jsonl$/, '')
    let stat
    try {
      stat = fs.statSync(full)
    } catch {
      continue
    }
    const parsed = parseSessionFile(full, { timeline: true })
    const meta = readMeta(path.join(dir, `agent-${agentId}.meta.json`))
    const label =
      (meta && (meta.description || meta.name)) || firstUserLine(parsed) || agentId
    let status = 'done'
    if (live && now - stat.mtimeMs < freshMs) status = 'running'
    else if (parsed.parseErrors > 0 && parsed.counts.assistant === 0) status = 'error'
    out.push({
      agentId,
      label,
      agentType: (meta && meta.agentType) || null,
      name: (meta && meta.name) || null,
      status,
      counts: parsed.counts,
      usage: parsed.usage,
      models: parsed.models,
      firstTimestamp: parsed.firstTimestamp,
      lastTimestamp: parsed.lastTimestamp,
      mtimeMs: stat.mtimeMs
    })
  }
  out.sort((a, b) => (a.firstTimestamp || '').localeCompare(b.firstTimestamp || ''))
  return out
}

/** Full parse (incl. timeline) of one subagent, for drill-in. */
function readSubagent(sessionFile, agentId) {
  const file = path.join(subagentsDirFor(sessionFile), `agent-${agentId}.jsonl`)
  return parseSessionFile(file, { timeline: true })
}

module.exports = { listSubagents, readSubagent, subagentsDirFor }
```

- [ ] **Step 4: Register in `electron.vite.config.mjs`**

In the `main.build.rollupOptions.input` object, add (after the `usage`/`commands` lines):

```js
          subagents: resolve('src/main/subagents.js'),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/subagents.test.js src/main/subagents.js electron.vite.config.mjs
git commit -m "feat: subagent discovery from session subagents/ dirs (labels via meta.json)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Subagent IPC + bridge

**Files:**
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

- [ ] **Step 1: IPC handlers in `src/main/index.js`**

Add to the require block at the top:

```js
const { listSubagents, readSubagent } = require('./subagents')
```

Add a new handler section (after the skills handlers):

```js
// ---- Subagents ------------------------------------------------------------
ipcMain.handle('subagents:list', (_e, { file, live }) => {
  try {
    return { ok: true, subagents: listSubagents(file, { live: !!live }) }
  } catch (err) {
    return { ok: false, error: err.message, subagents: [] }
  }
})
ipcMain.handle('subagent:read', (_e, { file, agentId }) => {
  try {
    return { ok: true, detail: readSubagent(file, agentId) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
```

- [ ] **Step 2: Bridge in `src/preload/index.js`**

Add a `subagents` namespace (sibling of `sessions`), e.g. after the `commands` namespace:

```js
  subagents: {
    list: (args) => ipcRenderer.invoke('subagents:list', args),
    read: (args) => ipcRenderer.invoke('subagent:read', args)
  },
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat: subagents:list + subagent:read IPC bridge" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Live subagent summary in the tracker

**Files:**
- Modify: `src/main/live.js`
- Test: `tests/subagents.test.js` (append a summary helper test)

> `live.js` re-emits its snapshot every ~1.5s. Add a `subagents: { running, total }` summary computed from `listSubagents(file, { live: true })`, keyed to the tracked session's file. Extract the counting into a tiny pure helper so it's testable.

- [ ] **Step 1: Append a helper test to `tests/subagents.test.js`**

```js
const { summarizeSubagents } = require('../src/main/subagents')

test('summarizeSubagents counts running vs total', () => {
  const s = summarizeSubagents([{ status: 'running' }, { status: 'done' }, { status: 'running' }])
  assert.deepStrictEqual(s, { running: 2, total: 3 })
  assert.deepStrictEqual(summarizeSubagents([]), { running: 0, total: 0 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `summarizeSubagents is not a function`.

- [ ] **Step 3: Add `summarizeSubagents` to `src/main/subagents.js`**

Add before `module.exports`:

```js
/** Reduce a subagent list to a small live summary. */
function summarizeSubagents(list) {
  let running = 0
  for (const s of list) if (s.status === 'running') running++
  return { running, total: list.length }
}
```

And add it to the exports:

```js
module.exports = { listSubagents, readSubagent, subagentsDirFor, summarizeSubagents }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Wire the summary into `live.js`**

At the top of `src/main/live.js`, add to the requires:

```js
const { listSubagents, summarizeSubagents } = require('./subagents')
```

In `_emit`, compute the summary from the tracked file and include it in the emitted object. Find the `this.onUpdate({ ... })` call in `_emit` and add a `subagents` field:

```js
    let subagents = { running: 0, total: 0 }
    if (this.file) {
      try {
        subagents = summarizeSubagents(listSubagents(this.file, { live: true }))
      } catch {
        /* dir may not exist yet */
      }
    }
    this.onUpdate({
      tracking: true,
      state,
      sessionId: this.sessionId,
      file: this.file,
      mtimeMs: mtimeMs || null,
      title: snap.title,
      cwd: snap.cwd,
      models: snap.models,
      counts: snap.counts,
      usage: snap.usage,
      tools: snap.tools,
      lastTool: snap.lastTool,
      subagents,
      recent: this.timeline
        ? this.timeline
            .slice(-MAX_RECENT)
            .map((it) => (it.kind === 'image' && it.data ? { ...it, data: undefined, truncated: true } : it))
        : []
    })
```

(Adjust to match the exact existing `this.onUpdate({...})` — only the `subagents` field and the `let subagents = ...` block are new; keep every existing field.)

- [ ] **Step 6: Build + run tests**

Run: `npm test` then `npm run build`
Expected: tests pass; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add tests/subagents.test.js src/main/subagents.js src/main/live.js
git commit -m "feat: live subagent running/total summary in tracker snapshots" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: SubagentPanel UI

**Files:**
- Create: `src/renderer/src/components/SubagentPanel.jsx`
- Modify: `src/renderer/src/components/SessionView.jsx`
- Modify: `src/renderer/src/index.css`

- [ ] **Step 1: Create `src/renderer/src/components/SubagentPanel.jsx`**

```jsx
import { useEffect, useState } from 'react'

const DOT = { running: '●', done: '✓', error: '⚠' }

// Collapsible list of a session's subagents. Click one to drill into its
// timeline (reuses the same item rendering via the renderItem prop).
export default function SubagentPanel({ file, live, renderTimeline }) {
  const [subagents, setSubagents] = useState([])
  const [open, setOpen] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      window.flux.subagents.list({ file, live }).then((r) => {
        if (alive && r.ok) setSubagents(r.subagents)
      })
    load()
    const t = live ? setInterval(load, 2000) : null
    return () => {
      alive = false
      if (t) clearInterval(t)
    }
  }, [file, live])

  useEffect(() => {
    if (!openId) {
      setDetail(null)
      return
    }
    window.flux.subagents.read({ file, agentId: openId }).then((r) => {
      if (r.ok) setDetail(r.detail)
    })
  }, [openId, file])

  if (!subagents.length) return null

  return (
    <div className="subagent-panel">
      <button className="subagent-head" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} Subagents ({subagents.length})
      </button>
      {open && (
        <div className="subagent-list">
          {subagents.map((s) => (
            <div key={s.agentId} className="subagent-row">
              <button className="subagent-item" onClick={() => setOpenId(openId === s.agentId ? null : s.agentId)}>
                <span className={'subagent-dot ' + s.status}>{DOT[s.status] || '·'}</span>
                {s.agentType && <span className="subagent-type">{s.agentType}</span>}
                <span className="subagent-label">{s.label}</span>
                <span className="subagent-meta">{s.counts ? s.counts.total + ' msg' : ''}</span>
              </button>
              {openId === s.agentId && detail && (
                <div className="subagent-timeline">{renderTimeline(detail.timeline || [])}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Render it in `SessionView.jsx`**

Add the import:

```js
import SubagentPanel from './SubagentPanel'
```

In the main return (an open existing session), after the `</div>` of `sv-header` and before `sv-timeline-wrap`, add:

```jsx
{detail.file && (
  <SubagentPanel
    file={detail.file}
    live={false}
    renderTimeline={(items) => items.map((item, i) => <TimelineItem key={i} item={item} onImage={setLightbox} />)}
  />
)}
```

> `parseSessionFile` includes `file` on its result (it's set in `freshModel(file)`), so `detail.file` is the session's path — no extra prop needed.

- [ ] **Step 3: Styles — append to `src/renderer/src/index.css`**

```css
.subagent-panel {
  margin: 8px 0 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
  overflow: hidden;
}
.subagent-head {
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 8px 12px;
  font-size: 12.5px;
  font-weight: 600;
}
.subagent-list { padding: 0 6px 6px; }
.subagent-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: var(--text);
  cursor: pointer;
  padding: 6px 8px;
  font-size: 12px;
  border-radius: 6px;
}
.subagent-item:hover { background: var(--bg-hover); }
.subagent-dot.running { color: #4ade80; }
.subagent-dot.done { color: var(--text-faint); }
.subagent-dot.error { color: #e8503d; }
.subagent-type {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--accent);
  white-space: nowrap;
}
.subagent-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.subagent-meta { color: var(--text-faint); font-size: 11px; }
.subagent-timeline {
  margin: 4px 4px 10px;
  padding: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  max-height: 320px;
  overflow-y: auto;
}
```

- [ ] **Step 4: Build + manual verify**

Run: `npm run build`
Expected: success.

Run: `npm run preview`, open a session known to have subagents (e.g. one where the implementation ran — the `bc45bb8e-...` session has 20). Expand "Subagents (N)", click one.
Expected: the list shows each subagent with type + label + status; clicking drills into its timeline.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SubagentPanel.jsx src/renderer/src/components/SessionView.jsx src/renderer/src/index.css
git commit -m "feat: subagent sub-views with drill-in timelines" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PHASE 4 — Topbar control cluster + remote toggle

### Task 12: ControlBar (model + agents badge + remote toggle)

**Files:**
- Create: `src/renderer/src/components/ControlBar.jsx`
- Modify: `src/renderer/src/App.jsx`
- Modify: `src/renderer/src/index.css`

- [ ] **Step 1: Create `src/renderer/src/components/ControlBar.jsx`**

```jsx
import { useState } from 'react'
import ModelPicker from './ModelPicker'

// Topbar control cluster: model picker, running-subagent badge, remote-control
// toggle. `agents` is the live summary { running, total } or null. `liveActive`
// is true when a tracked claude is running in the terminal.
export default function ControlBar({ model, onModel, agents, liveActive, onAgentsClick }) {
  const [remoteOn, setRemoteOn] = useState(false)
  const toggleRemote = () => {
    if (!liveActive) return
    window.flux.pty.write('/remote-control\r')
    setRemoteOn((v) => !v)
  }
  const running = agents ? agents.running : 0
  return (
    <div className="control-bar">
      <ModelPicker model={model} onChange={onModel} />
      {running > 0 && (
        <button className="agents-badge" onClick={onAgentsClick} title="Running subagents — click to view">
          ▶ {running} agent{running === 1 ? '' : 's'}
        </button>
      )}
      <button
        className={'remote-toggle' + (remoteOn ? ' on' : '')}
        onClick={toggleRemote}
        disabled={!liveActive}
        title={
          liveActive
            ? 'Send /remote-control to the live terminal (can’t read true state)'
            : 'No live claude running in the terminal'
        }
      >
        ⊙ Remote{remoteOn ? ' on' : ''}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Wire into `App.jsx`**

`App` already owns `model`/`setModel`. Add live-state subscription (if not already present) to get `agents` + `liveActive`:

```js
const [live, setLive] = useState(null)
useEffect(() => window.flux.live.onUpdate(setLive), [])
```

Replace the standalone `<ModelPicker .../>` added in Task 4 with the `ControlBar` (remove the direct ModelPicker usage + its import from App since ControlBar renders it):

```jsx
<ControlBar
  model={model}
  onModel={setModel}
  agents={live && live.tracking ? live.subagents : null}
  liveActive={!!(live && live.tracking && live.state === 'live')}
  onAgentsClick={() => setView('terminal')}
/>
```

Add the import: `import ControlBar from './components/ControlBar'` (and drop `import ModelPicker ...` from App — ModelPicker is now only imported by ControlBar).

- [ ] **Step 3: Styles — append to `src/renderer/src/index.css`**

```css
.control-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}
.control-bar .model-picker { margin-left: 0; padding-right: 0; }
.agents-badge {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  color: #4ade80;
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11.5px;
  cursor: pointer;
}
.agents-badge:hover { background: var(--bg-hover); }
.remote-toggle {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11.5px;
  cursor: pointer;
}
.remote-toggle.on { color: #4ade80; border-color: #4ade8055; }
.remote-toggle:disabled { opacity: 0.45; cursor: default; }
```

(With `.control-bar { margin-left: auto }`, remove the `margin-left:auto` from `.usage-bar` if it now causes a double-spacer; otherwise leave it — the control bar + usage bar sit together on the right.)

- [ ] **Step 4: Build + smoke**

Run: `npm run build`
Expected: success.

Run (PowerShell): `$env:FLUX_SMOKE_SHOT="C:\tmp\flux-controlbar.png"; npm run preview` then `Remove-Item Env:FLUX_SMOKE_SHOT`.
Expected: `FLUX_SMOKE_SHOT_OK`; topbar shows the model picker + remote toggle (disabled, since no live claude in the smoke run) + usage gauges. Then `npm run preview` interactively, launch a tracked claude in the terminal that spawns subagents → the agents badge appears and the Remote toggle enables.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ControlBar.jsx src/renderer/src/App.jsx src/renderer/src/index.css
git commit -m "feat: topbar control cluster — model, running-agents badge, remote toggle" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: README + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README roadmap**

In `README.md`, under the existing checked roadmap items, add:

```markdown
- [x] **Session Workspace v2:** start new chats in the rich UI (folder + model
      selection), a topbar model switcher, interrupt a running turn, the full
      slash-command set (terminal-only ones marked), subagent sub-views with
      drill-in timelines, and a topbar control cluster (model · running-agents ·
      remote-control toggle).
```

Remove any now-done "next steps" lines this supersedes (e.g. a subagent/timeline bullet, if present).

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS — all tests green (Phase 1–3 unit tests included).

- [ ] **Step 3: Full build**

Run: `npm run build`
Expected: all three bundles succeed.

- [ ] **Step 4: Smoke screenshots**

Run (PowerShell, one at a time, clearing the env var between):

```powershell
$env:FLUX_SMOKE_SHOT="C:\tmp\flux-v2-terminal.png"; npm run preview
Remove-Item Env:FLUX_SMOKE_SHOT
$env:FLUX_SMOKE_SHOT="C:\tmp\flux-v2-session.png"; $env:FLUX_SMOKE_VIEW="session"; npm run preview
Remove-Item Env:FLUX_SMOKE_SHOT; Remove-Item Env:FLUX_SMOKE_VIEW
```

Expected: both print `FLUX_SMOKE_SHOT_OK`. Inspect: terminal shot shows the control cluster + usage in the topbar; session shot shows the model picker and (if the opened session has subagents) the Subagents panel.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: README roadmap for Session Workspace v2" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- `src/main/*` is CommonJS (`require`); `src/renderer/*` is ESM/JSX. Don't mix.
- **Register `subagents.js` in `electron.vite.config.mjs`** (Task 8 Step 4) — forgetting this builds clean but crashes the app at boot.
- Renderer components can't be unit-tested here (no DOM runner — intentional). Verify via `npm run build` + the FLUX_SMOKE_SHOT harness + the manual checks in each task. First smoke capture after a cold start is sometimes black — re-run.
- Close any running Flux instance before a fresh `npm run preview` (PTY + watchers are singletons; two instances also fight over the Electron GPU cache → black screenshots).
- Never read `~/.claude/.credentials.json` from your shell.
- The `Composer` extraction in Task 6 is the riskiest edit (it rewires the existing composer). Do it carefully; if it threatens the working composer, keep a duplicated composer block for new-chat and report DONE_WITH_CONCERNS so the controller can decide.

## Self-review notes (coverage)

- Spec Phase 1 → Tasks 1–2. Phase 2 (new chat, model switcher, interrupt) → Tasks 3–7. Phase 3 (discovery, IPC, live summary, UI) → Tasks 8–11. Phase 4 (control cluster, remote toggle) → Task 12. README/verify → Task 13.
- Types are consistent: command objects carry `{name, description, source, interactive}`; subagent objects carry `{agentId, label, agentType, name, status, counts, usage, models, firstTimestamp, lastTimestamp, mtimeMs}`; live snapshot adds `subagents: {running, total}`; `session:new` returns `{ok, sessionId, cwd}`; send/new/interrupt all emit `session:sendstatus` with `state ∈ running|done|error|interrupted`.
