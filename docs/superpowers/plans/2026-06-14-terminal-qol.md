# Terminal Power-User QoL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Clickable links/paths, copy-on-select + right-click paste, and launch-profile args + editor depth.

**Architecture:** Pure guards in `shellio.js` + main shell/clipboard IPC; TerminalPane gains web-links/path-links/copy/paste; `args` threaded through pty; the Terminal settings profile editor exposes cwd/shell/args/tracked.

**Tech Stack:** Electron (shell, clipboard), xterm + `@xterm/addon-web-links`, node:test.

**Spec:** `docs/superpowers/specs/2026-06-14-terminal-qol-design.md`

**Test command:** `npm test`. Build: `npm run build`. `pty.js`/`shellio.js` are CommonJS main modules (require() in tests). New main modules → `electron.vite.config.mjs` rollup inputs.

---

## Task 1: Main shell + clipboard IPC

**Files:**
- Create: `src/main/shellio.js`, `tests/shellio.test.js`
- Modify: `src/main/index.js`, `src/preload/index.js`, `electron.vite.config.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/shellio.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const { isAllowedExternalUrl, looksLikePath } = require('../src/main/shellio')

test('isAllowedExternalUrl allows http/https/mailto only', () => {
  assert.strictEqual(isAllowedExternalUrl('https://example.com'), true)
  assert.strictEqual(isAllowedExternalUrl('http://x.io/y'), true)
  assert.strictEqual(isAllowedExternalUrl('mailto:a@b.com'), true)
  assert.strictEqual(isAllowedExternalUrl('file:///c:/x'), false)
  assert.strictEqual(isAllowedExternalUrl('javascript:alert(1)'), false)
  assert.strictEqual(isAllowedExternalUrl('vbscript:x'), false)
  assert.strictEqual(isAllowedExternalUrl(''), false)
  assert.strictEqual(isAllowedExternalUrl(null), false)
})

test('looksLikePath matches windows + unix paths', () => {
  assert.strictEqual(looksLikePath('C:\\\\Users\\\\me\\\\file.txt'), true)
  assert.strictEqual(looksLikePath('/home/me/file'), true)
  assert.strictEqual(looksLikePath('./rel/path.js'), true)
  assert.strictEqual(looksLikePath('just text'), false)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/shellio.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement shellio.js**

Create `src/main/shellio.js`:

```js
// Pure guards for the shell/clipboard IPC. The renderer is untrusted, so a URL
// must be a safe external scheme before it reaches shell.openExternal.
function isAllowedExternalUrl(url) {
  if (typeof url !== 'string' || !url) return false
  return /^(https?:|mailto:)/i.test(url.trim())
}

// Heuristic: does this token look like a filesystem path worth linkifying?
function looksLikePath(s) {
  if (typeof s !== 'string' || !s) return false
  if (/^[a-zA-Z]:[\\/]/.test(s)) return true // C:\... or C:/...
  if (/^\.{0,2}\//.test(s)) return true // /abs, ./rel, ../rel
  return false
}

module.exports = { isAllowedExternalUrl, looksLikePath }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/shellio.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire IPC + preload + rollup**

In `electron.vite.config.mjs`, add to `rollupOptions.input` (after `tray`):

```js
          shellio: resolve('src/main/shellio.js'),
```

In `src/main/index.js`:
- Add `clipboard` and `shell` to the `require('electron')` destructure (shell is already used via `require('electron').shell` in beep — add top-level `shell, clipboard`).
- Require: `const { isAllowedExternalUrl } = require('./shellio')`.
- Add handlers (near other `ipcMain.handle`s):

```js
ipcMain.handle('shell:openExternal', (_e, url) => {
  if (!isAllowedExternalUrl(url)) return { ok: false, error: 'blocked url' }
  shell.openExternal(url)
  return { ok: true }
})
ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(String(p || '')))
ipcMain.handle('clipboard:readText', () => clipboard.readText())
```

In `src/preload/index.js`, add bridges:

```js
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    openPath: (p) => ipcRenderer.invoke('shell:openPath', p)
  },
  clipboard: {
    readText: () => ipcRenderer.invoke('clipboard:readText')
  },
```

- [ ] **Step 6: Build + commit**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3`
Expected: build succeeds; `out/main/shellio.js` emitted.

```bash
git add src/main/shellio.js tests/shellio.test.js src/main/index.js src/preload/index.js electron.vite.config.mjs
git commit -m "feat(terminal): guarded shell.openExternal/openPath + clipboard read IPC

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Launch-profile args passthrough

**Files:**
- Modify: `src/main/pty.js`, `src/main/index.js`
- Test: `tests/pty-args.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/pty-args.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const { validArgs } = require('../src/main/pty')

test('validArgs accepts a string array, rejects non-strings, caps length', () => {
  assert.deepStrictEqual(validArgs(['-l', '--color']), ['-l', '--color'])
  assert.deepStrictEqual(validArgs(undefined), [])
  assert.deepStrictEqual(validArgs(null), [])
  assert.deepStrictEqual(validArgs('not array'), [])
  assert.deepStrictEqual(validArgs([1, 'ok', {}]), ['ok']) // drops non-strings
  assert.strictEqual(validArgs(Array.from({ length: 100 }, () => 'x')).length, 32) // capped
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/pty-args.test.js`
Expected: FAIL (`validArgs` not exported).

- [ ] **Step 3: Implement in pty.js**

In `src/main/pty.js`, add:

```js
function validArgs(args) {
  if (!Array.isArray(args)) return []
  return args.filter((a) => typeof a === 'string').slice(0, 32)
}
```

Change `createPty` to accept + use args:

```js
function createPty({ cols = 80, rows = 30, cwd, shell, args } = {}) {
  if (!isAllowedShell(shell)) throw new Error('shell not allowed: ' + shell)
  return pty.spawn(shell || defaultShell(), validArgs(args), {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: cwd || os.homedir(),
    env: process.env
  })
}
```

Update the export to add `validArgs`.

In `src/main/index.js`, the `pty:spawn` handler — forward `args`:

```js
ipcMain.handle('pty:spawn', (_e, { id, cols, rows, cwd, shell, args }) => {
  const p = ptyManager ? ptyManager.spawn(id, { cols, rows, cwd, shell, args }) : null
  return p ? { ok: true, id } : { ok: false, id, error: (ptyManager && ptyManager.lastSpawnError) || 'failed to start terminal' }
})
```

(`ptymanager.spawn` already forwards its opts object to `createPty`, so no change there.)

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/pty-args.test.js tests/pty.test.js`
Expected: PASS (new + existing pty allowlist tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/pty.js src/main/index.js tests/pty-args.test.js
git commit -m "feat(terminal): thread validated launch-profile args through pty:spawn

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: TerminalPane — links, paths, copy-on-select, paste, args

**Files:**
- Modify: `src/renderer/src/components/TerminalPane.jsx`, `src/renderer/src/components/TerminalWorkspace.jsx`, `package.json`

- [ ] **Step 1: Add the dep**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm install @xterm/addon-web-links`
Expected: appears under dependencies.

- [ ] **Step 2: TerminalPane — addons + copy/paste + args**

In `src/renderer/src/components/TerminalPane.jsx`:
- Import: `import { WebLinksAddon } from '@xterm/addon-web-links'` and `import { looksLikePath } from '../lib/...'` — NO: `looksLikePath` is a main module. Inline a small path regex in the renderer instead (don't import main code). Use `const PATH_RE = /(?:[a-zA-Z]:\\\\[^\\s"']+|(?:\\.{0,2}\\/)[^\\s"':]+)/g`.
- Accept an `args` prop in the signature: `export default function TerminalPane({ ptyId, theme, cwd, shell, args, initialInput, onFocus })`.
- After `term.loadAddon(searchAddon)`, add:

```js
    term.loadAddon(new WebLinksAddon((_e, uri) => { window.flux.shell.openExternal(uri) }))
    // File-path links → open/reveal via the main process.
    term.registerLinkProvider({
      provideLinks(lineNo, cb) {
        const line = term.buffer.active.getLine(lineNo - 1)
        if (!line) return cb(undefined)
        const text = line.translateToString(true)
        const links = []
        const re = /(?:[a-zA-Z]:\\[^\s"']+|(?:\.{0,2}\/)[^\s"':]+)/g
        let m
        while ((m = re.exec(text))) {
          const start = m.index
          links.push({
            range: { start: { x: start + 1, y: lineNo }, end: { x: start + m[0].length, y: lineNo } },
            text: m[0],
            activate: () => window.flux.shell.openPath(m[0])
          })
        }
        cb(links.length ? links : undefined)
      }
    })
```

- After `const onInput = term.onData(...)`, add copy-on-select:

```js
    const onSel = term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (sel) navigator.clipboard.writeText(sel).catch(() => {})
    })
```

  and dispose it in cleanup (`onSel.dispose()`).
- Right-click paste: on the host element add a contextmenu handler. In the host-keydown effect (or a new effect), add:

```js
    const onCtx = (e) => {
      e.preventDefault()
      window.flux.clipboard.readText().then((t) => { if (t) window.flux.pty.write(ptyId, t) })
    }
    host.addEventListener('contextmenu', onCtx)
```

  (remove it in that effect's cleanup). Note: `host` and `ptyId` are in scope.
- Pass args to spawn: change the spawn call to `window.flux.pty.spawn({ id: ptyId, cols: term.cols, rows: term.rows, cwd, shell, args })`.

- [ ] **Step 3: TerminalWorkspace passes profile args**

Read `src/renderer/src/components/TerminalWorkspace.jsx`. Where it renders `<TerminalPane … shell={profile.shell} cwd={profile.cwd} … />` (the pane spawn from a profile), also pass `args={profile.args}`. (If panes are created from a profile object, thread `args` from the same profile.)

- [ ] **Step 4: Build + manual**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3`
Expected: build succeeds.

Manual (`npm run dev`): echo a URL and a path in the terminal → both are clickable (URL opens browser, path opens/reveals); select text → it's on the clipboard; right-click → pastes.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TerminalPane.jsx src/renderer/src/components/TerminalWorkspace.jsx package.json package-lock.json
git commit -m "feat(terminal): clickable links/paths, copy-on-select, right-click paste, profile args

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Profile editor depth (cwd/shell/args/tracked)

**Files:**
- Modify: `src/renderer/src/components/settings/TerminalSection.jsx`, `src/renderer/src/index.css`

- [ ] **Step 1: Extend the profile editor**

Read `src/renderer/src/components/settings/TerminalSection.jsx`. It currently edits a profile's **name** (local state + save-on-blur via `settings.saveProfile`). Add fields, saved the same way (save-on-blur), to the per-profile editor:
- **cwd**: a text input bound to the profile's `cwd` (empty = home).
- **shell**: a text input (or select of the allowlist) bound to `shell` (empty = default PowerShell).
- **args**: a text input that splits on whitespace into an array on save (`value.trim() ? value.trim().split(/\s+/) : []`), displayed as `(profile.args || []).join(' ')`.
- **tracked**: a checkbox bound to `tracked`.

Each writes through the existing `saveProfile({ ...profile, cwd, shell, args, tracked })` path (mirroring how name is saved on blur). Keep the save-on-blur pattern (not save-on-keystroke) noted in the code.

- [ ] **Step 2: Styles (if needed)**

Reuse existing settings/profile CSS classes; add minimal rules only if the new fields need layout (e.g. a `.profile-field` row). Keep consistent with the section's current look.

- [ ] **Step 3: Build + manual**

Run: `cd "C:/Users/james/Projects/Flux Terminal" && npm run build 2>&1 | tail -3 && npm test 2>&1 | tail -5`
Expected: build succeeds; all tests pass (317 prior + 2 shellio + 1 pty-args = 320).

Manual: edit a profile's cwd/shell/args/tracked in Settings → Terminal; launch it from the terminal and confirm it opens in that cwd with those args.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/settings/TerminalSection.jsx src/renderer/src/index.css
git commit -m "feat(terminal): profile editor exposes cwd/shell/args/tracked

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** shell/clipboard IPC + guards → Task 1; args passthrough → Task 2; links/paths/copy/paste + args wiring → Task 3; profile editor depth → Task 4. OSC 133 + split/ratio layout restore deferred (flagged in spec).

**Placeholder scan:** shellio + validArgs + IPC + TerminalPane edits have full code; TerminalWorkspace + TerminalSection edits give exact field/behavior + the existing save path to follow (implementer reads those two files).

**Type/name consistency:** `isAllowedExternalUrl`/`looksLikePath` (shellio) tested + used in IPC; `validArgs` (pty) tested + used in createPty; `shell.openExternal/openPath` + `clipboard.readText` consistent across main/preload/TerminalPane; `args` prop threaded TerminalWorkspace→TerminalPane→pty:spawn→createPty(validArgs).

**Notes for executor:** Tasks 1-2 independent (pure + IPC); 3 depends on 1 (uses shell/clipboard bridges) + 2 (args); 4 independent (settings UI). Commit after each. Pure guards + validArgs are unit-tested; the rest build- + manual-verified. No push/tag. The right-click paste uses the main clipboard IPC (reliable under sandbox); copy-on-select uses navigator.clipboard.writeText (allowed on user-gesture selection).
```
