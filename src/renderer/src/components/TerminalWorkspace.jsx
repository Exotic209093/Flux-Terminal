// src/renderer/src/components/TerminalWorkspace.jsx
import { useReducer, useEffect, useCallback, useRef } from 'react'
import TerminalPane from './TerminalPane'
import TabBar from './TabBar'
import LivePanel from './LivePanel'
import { reducer, initialState } from '../lib/workspace'

const uid = (p) => p + '-' + crypto.randomUUID().slice(0, 8)

function freshSeed() {
  return { tabId: uid('t'), paneId: uid('pane'), ptyId: uid('pty'), profileId: 'powershell', title: 'PowerShell' }
}

// Owns the tab/pane workspace. Task 4: tabs (one pane each). Hosts the docked
// LivePanel; "launch tracked claude" opens a tab and writes into its PTY.
export default function TerminalWorkspace({ theme, onActivePty }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(freshSeed()))
  const pendingInput = useRef({})

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) || state.tabs[0]
  const activePane = activeTab && activeTab.panes.find((p) => p.id === activeTab.activePaneId)

  useEffect(() => {
    if (onActivePty) onActivePty(activePane ? activePane.ptyId : null)
  }, [activePane, onActivePty])

  useEffect(() => {
    if (state.tabs.length === 0) dispatch({ type: 'NEW_TAB', ...freshSeed() })
  }, [state.tabs.length])

  const newTab = useCallback(() => dispatch({ type: 'NEW_TAB', ...freshSeed() }), [])
  const closeTab = useCallback((tabId) => dispatch({ type: 'CLOSE_TAB', tabId }), [])
  const selectTab = useCallback((tabId) => dispatch({ type: 'FOCUS_TAB', tabId }), [])
  const renameTab = useCallback((tabId, title) => dispatch({ type: 'RENAME_TAB', tabId, title }), [])

  const launchTracked = useCallback(() => {
    const seed = { tabId: uid('t'), paneId: uid('pane'), ptyId: uid('pty'), profileId: 'claude', title: 'claude ✦' }
    const uuid = crypto.randomUUID()
    pendingInput.current[seed.ptyId] = `claude --session-id ${uuid}\r`
    dispatch({ type: 'NEW_TAB', ...seed })
    window.flux.live.track(uuid)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey) return
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); newTab() }
      else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault()
        if (activeTab) {
          if (!window.confirm('Close this tab? Its shell will be terminated.')) return
          closeTab(activeTab.id)
        }
      } else if (e.key === 'Tab') { e.preventDefault(); dispatch({ type: 'NEXT_TAB' }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newTab, closeTab, activeTab])

  return (
    <div className="workspace">
      <LivePanel onLaunch={launchTracked} />
      <TabBar
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        onSelect={selectTab}
        onClose={closeTab}
        onRename={renameTab}
        onNew={newTab}
      />
      <div className="workspace-body">
        {state.tabs.map((t) => (
          <div
            key={t.id}
            className="tab-surface"
            style={{ display: t.id === state.activeTabId ? 'flex' : 'none' }}
          >
            {t.panes.map((p) => (
              <div key={p.id} className="pane-wrap">
                <TerminalPane
                  ptyId={p.ptyId}
                  theme={theme}
                  initialInput={pendingInput.current[p.ptyId]}
                  onFocus={() => dispatch({ type: 'FOCUS_PANE', paneId: p.id })}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
