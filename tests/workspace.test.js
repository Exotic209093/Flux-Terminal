// tests/workspace.test.js
const test = require('node:test')
const assert = require('node:assert')
const { reducer, initialState, allPtyIds, deriveTitle } = require('../src/renderer/src/lib/workspace.js')

function seed() {
  return initialState({ tabId: 't1', paneId: 'p1', ptyId: 'pty1', profileId: 'pf', title: 'PS' })
}

test('initialState has one tab, one pane, both active', () => {
  const s = seed()
  assert.strictEqual(s.tabs.length, 1)
  assert.strictEqual(s.activeTabId, 't1')
  assert.strictEqual(s.tabs[0].activePaneId, 'p1')
  assert.strictEqual(s.tabs[0].panes[0].ptyId, 'pty1')
})

test('NEW_TAB appends and activates', () => {
  let s = seed()
  s = reducer(s, { type: 'NEW_TAB', tabId: 't2', paneId: 'p2', ptyId: 'pty2', profileId: 'pf', title: 'PS' })
  assert.strictEqual(s.tabs.length, 2)
  assert.strictEqual(s.activeTabId, 't2')
})

test('CLOSE_TAB removes and re-activates a neighbor', () => {
  let s = seed()
  s = reducer(s, { type: 'NEW_TAB', tabId: 't2', paneId: 'p2', ptyId: 'pty2', profileId: 'pf', title: 'PS' })
  s = reducer(s, { type: 'CLOSE_TAB', tabId: 't2' })
  assert.strictEqual(s.tabs.length, 1)
  assert.strictEqual(s.activeTabId, 't1')
})

test('CLOSE_TAB on the last tab leaves tabs empty (caller opens default)', () => {
  let s = seed()
  s = reducer(s, { type: 'CLOSE_TAB', tabId: 't1' })
  assert.strictEqual(s.tabs.length, 0)
  assert.strictEqual(s.activeTabId, null)
})

test('SPLIT adds a second pane and sets splitDir + active pane', () => {
  let s = seed()
  s = reducer(s, { type: 'SPLIT', tabId: 't1', paneId: 'p2', ptyId: 'pty2', profileId: 'pf', dir: 'v' })
  const tab = s.tabs[0]
  assert.strictEqual(tab.panes.length, 2)
  assert.strictEqual(tab.splitDir, 'v')
  assert.strictEqual(tab.activePaneId, 'p2')
})

test('SPLIT is a no-op on an already-split tab (max 2 panes)', () => {
  let s = seed()
  s = reducer(s, { type: 'SPLIT', tabId: 't1', paneId: 'p2', ptyId: 'pty2', profileId: 'pf', dir: 'v' })
  s = reducer(s, { type: 'SPLIT', tabId: 't1', paneId: 'p3', ptyId: 'pty3', profileId: 'pf', dir: 'h' })
  assert.strictEqual(s.tabs[0].panes.length, 2)
})

test('CLOSE_PANE of a split keeps the tab, drops splitDir, focuses the survivor', () => {
  let s = seed()
  s = reducer(s, { type: 'SPLIT', tabId: 't1', paneId: 'p2', ptyId: 'pty2', profileId: 'pf', dir: 'v' })
  s = reducer(s, { type: 'CLOSE_PANE', paneId: 'p2' })
  const tab = s.tabs[0]
  assert.strictEqual(tab.panes.length, 1)
  assert.strictEqual(tab.splitDir, null)
  assert.strictEqual(tab.activePaneId, 'p1')
})

test('CLOSE_PANE of the only pane closes the whole tab', () => {
  let s = seed()
  s = reducer(s, { type: 'CLOSE_PANE', paneId: 'p1' })
  assert.strictEqual(s.tabs.length, 0)
})

test('FOCUS_PANE activates the containing tab and the pane', () => {
  let s = seed()
  s = reducer(s, { type: 'NEW_TAB', tabId: 't2', paneId: 'p2', ptyId: 'pty2', profileId: 'pf', title: 'PS' })
  s = reducer(s, { type: 'SPLIT', tabId: 't2', paneId: 'p3', ptyId: 'pty3', profileId: 'pf', dir: 'h' })
  s = reducer(s, { type: 'FOCUS_PANE', paneId: 'p2' })
  assert.strictEqual(s.activeTabId, 't2')
  assert.strictEqual(s.tabs[1].activePaneId, 'p2')
})

test('NEXT_TAB cycles and wraps', () => {
  let s = seed()
  s = reducer(s, { type: 'NEW_TAB', tabId: 't2', paneId: 'p2', ptyId: 'pty2', profileId: 'pf', title: 'PS' })
  s = reducer(s, { type: 'FOCUS_TAB', tabId: 't1' })
  s = reducer(s, { type: 'NEXT_TAB' })
  assert.strictEqual(s.activeTabId, 't2')
  s = reducer(s, { type: 'NEXT_TAB' })
  assert.strictEqual(s.activeTabId, 't1') // wrap
})

test('SET_RATIO and RENAME_TAB update the tab', () => {
  let s = seed()
  s = reducer(s, { type: 'SET_RATIO', tabId: 't1', ratio: 0.3 })
  s = reducer(s, { type: 'RENAME_TAB', tabId: 't1', title: 'build' })
  assert.strictEqual(s.tabs[0].ratio, 0.3)
  assert.strictEqual(s.tabs[0].title, 'build')
})

test('allPtyIds lists every pane ptyId across tabs', () => {
  let s = seed()
  s = reducer(s, { type: 'SPLIT', tabId: 't1', paneId: 'p2', ptyId: 'pty2', profileId: 'pf', dir: 'v' })
  s = reducer(s, { type: 'NEW_TAB', tabId: 't2', paneId: 'p3', ptyId: 'pty3', profileId: 'pf', title: 'PS' })
  assert.deepStrictEqual(allPtyIds(s).sort(), ['pty1', 'pty2', 'pty3'])
})

test('deriveTitle prefers an explicit title, else profile name, else cwd basename', () => {
  assert.strictEqual(deriveTitle({ title: 'X', profileName: 'PS', cwd: 'C:\\a\\b' }), 'X')
  assert.strictEqual(deriveTitle({ profileName: 'PS', cwd: 'C:\\a\\b' }), 'PS')
  assert.strictEqual(deriveTitle({ cwd: 'C:\\a\\b' }), 'b')
  assert.strictEqual(deriveTitle({}), 'shell')
})
