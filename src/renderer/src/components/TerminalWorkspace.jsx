// src/renderer/src/components/TerminalWorkspace.jsx
import { useReducer, useEffect, useState, useCallback, useRef, Fragment } from 'react'
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
export default function TerminalWorkspace({ theme, onActivePty, active }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(freshSeed()))
  const pendingInput = useRef({})
  const pendingSpawn = useRef({}) // ptyId -> { cwd, shell }
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  const [profiles, setProfiles] = useState([])
  useEffect(() => { window.flux.settings.profiles().then((list) => setProfiles(list || [])) }, [])
  const profilesRef = useRef(profiles)
  useEffect(() => { profilesRef.current = profiles }, [profiles])

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) || state.tabs[0]
  const activePane = activeTab && activeTab.panes.find((p) => p.id === activeTab.activePaneId)

  useEffect(() => {
    if (onActivePty) onActivePty(activePane ? activePane.ptyId : null)
  }, [activePane, onActivePty])

  useEffect(() => {
    if (state.tabs.length === 0) dispatch({ type: 'NEW_TAB', ...freshSeed() })
  }, [state.tabs.length])

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

  const profileById = useCallback(
    (id) => profiles.find((p) => p.id === id) || profiles[0] || { id: 'powershell', name: 'PowerShell' },
    [profiles]
  )
  const openProfile = useCallback((profileId) => {
    const prof = profileById(profileId)
    if (prof && prof.tracked) { launchTracked(); return }
    const seed = { tabId: uid('t'), paneId: uid('pane'), ptyId: uid('pty'), profileId: prof.id, title: prof.name }
    pendingSpawn.current[seed.ptyId] = { cwd: prof.cwd || null, shell: prof.shell || null }
    dispatch({ type: 'NEW_TAB', ...seed })
  }, [profileById, launchTracked])
  const newTab = useCallback(() => openProfile((profiles[0] && profiles[0].id) || 'powershell'), [openProfile, profiles])

  const splitActive = useCallback((dir) => {
    if (!activeTab || activeTab.panes.length >= 2) return
    dispatch({ type: 'SPLIT', tabId: activeTab.id, paneId: uid('pane'), ptyId: uid('pty'), profileId: 'powershell', dir })
  }, [activeTab])

  const closePane = useCallback((paneId) => dispatch({ type: 'CLOSE_PANE', paneId }), [])

  const onDividerDrag = useCallback((tabId, e) => {
    const body = e.currentTarget.parentElement
    const horizontal = body.classList.contains('split-v') // 'v' = side-by-side (vertical divider)
    const rect = body.getBoundingClientRect()
    const move = (ev) => {
      const ratio = horizontal
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height
      dispatch({ type: 'SET_RATIO', tabId, ratio: Math.min(0.85, Math.max(0.15, ratio)) })
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (!active) return
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (activeTab && activeTab.panes.length === 2) {
          e.preventDefault()
          const cur = activeTab.panes.findIndex((p) => p.id === activeTab.activePaneId)
          const other = activeTab.panes[cur === 0 ? 1 : 0]
          dispatch({ type: 'FOCUS_PANE', paneId: other.id })
        }
        return
      }
      if (!e.ctrlKey) return
      if (e.shiftKey && (e.key === 'E' || e.key === 'e')) { e.preventDefault(); splitActive('v') }
      else if (e.shiftKey && (e.key === 'O' || e.key === 'o')) { e.preventDefault(); splitActive('h') }
      else if (e.key === 't' || e.key === 'T') { e.preventDefault(); newTab() }
      else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault()
        if (activeTab) closeTab(activeTab.id)
      } else if (e.key === 'Tab') { e.preventDefault(); dispatch({ type: 'NEXT_TAB' }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newTab, closeTab, activeTab, splitActive, active])

  // Restore the saved tab layout once on mount. Tabs reopen as FRESH shells in
  // their saved profile's cwd; tracked-claude tabs restore as a plain shell.
  useEffect(() => {
    window.flux.settings.getWorkspace().then((saved) => {
      if (!saved || !Array.isArray(saved.tabs) || saved.tabs.length === 0) return
      saved.tabs.forEach((t, i) => {
        const prof = (t.profileId && profilesRef.current.find((p) => p.id === t.profileId)) || null
        const seed = {
          tabId: uid('t'),
          paneId: uid('pane'),
          ptyId: uid('pty'),
          profileId: t.profileId || 'powershell',
          title: t.title || (prof && prof.name) || 'PowerShell'
        }
        pendingSpawn.current[seed.ptyId] = { cwd: (prof && prof.cwd) || null, shell: (prof && prof.shell) || null }
        if (i === 0) dispatch({ type: 'CLOSE_TAB', tabId: stateRef.current.activeTabId })
        dispatch({ type: 'NEW_TAB', ...seed })
      })
    })
  }, [])

  // Persist the layout (profile + title per tab) shortly after it changes.
  useEffect(() => {
    const id = setTimeout(() => {
      window.flux.settings.setWorkspace({
        tabs: state.tabs.map((t) => ({ profileId: t.panes[0].profileId, title: t.title }))
      })
    }, 400)
    return () => clearTimeout(id)
  }, [state.tabs])

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
        onSplit={splitActive}
        profiles={profiles}
        onNewProfile={openProfile}
      />
      <div className="workspace-body">
        {state.tabs.map((t) => {
          const split = t.panes.length === 2
          const cls = 'tab-surface' + (split ? (t.splitDir === 'v' ? ' split-v' : ' split-h') : '')
          return (
            <div key={t.id} className={cls} style={{ display: t.id === state.activeTabId ? 'flex' : 'none' }}>
              {t.panes.map((p, i) => (
                <Fragment key={p.id}>
                  <div
                    className={'pane-wrap' + (split && p.id === t.activePaneId ? ' focused' : '')}
                    style={split ? { flex: i === 0 ? t.ratio : 1 - t.ratio } : { flex: 1 }}
                  >
                    <TerminalPane
                      ptyId={p.ptyId}
                      theme={theme}
                      cwd={(pendingSpawn.current[p.ptyId] || {}).cwd}
                      shell={(pendingSpawn.current[p.ptyId] || {}).shell}
                      initialInput={pendingInput.current[p.ptyId]}
                      onFocus={() => dispatch({ type: 'FOCUS_PANE', paneId: p.id })}
                    />
                    {split && (
                      <button className="pane-close" title="Close pane" onClick={() => closePane(p.id)}>×</button>
                    )}
                  </div>
                  {split && i === 0 && (
                    <div className="pane-divider" onMouseDown={(e) => onDividerDrag(t.id, e)} />
                  )}
                </Fragment>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
