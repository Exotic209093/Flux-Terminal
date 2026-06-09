import { useState, useCallback, useEffect, useRef } from 'react'
import Sidebar from './components/Sidebar'
import TerminalPane from './components/TerminalPane'
import SessionView from './components/SessionView'
import StatsView from './components/StatsView'
import SkillsView from './components/SkillsView'
import LivePanel from './components/LivePanel'
import { applyTheme, loadTheme, saveTheme } from './lib/themes'

// The terminal stays MOUNTED at all times so its PTY (and any running `claude`)
// survives switching to a session/stats view and back. Opening a session also
// watches its file so newly-appended turns (e.g. from sending a message) stream in.
export default function App() {
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState(null)

  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [sendState, setSendState] = useState(null) // null | 'running' | 'error'
  const [sendError, setSendError] = useState(null)
  const [view, setView] = useState('terminal') // 'terminal' | 'session' | 'stats'

  const [theme, setThemeState] = useState(loadTheme())

  const openFileRef = useRef(null) // the file currently watched, for refresh matching

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = useCallback((t) => {
    saveTheme(t)
    setThemeState(t)
  }, [])

  // One session-list fetch, shared by the sidebar and the stats view.
  useEffect(() => {
    let alive = true
    window.flux.sessions
      .list({ limit: 500 })
      .then((res) => {
        if (!alive) return
        if (res.ok) setSessions(res.sessions)
        else setSessionsError(res.error || 'failed to load sessions')
        setSessionsLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        setSessionsError(String(e))
        setSessionsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  // Live refresh of the open session + send-status updates.
  useEffect(() => {
    const offRefresh = window.flux.sessions.onRefresh(({ file, session }) => {
      if (file === openFileRef.current && session && session.ok !== false) {
        setDetail(session)
      }
    })
    const offStatus = window.flux.sessions.onSendStatus(({ state, error }) => {
      setSendState(state === 'running' ? 'running' : state === 'error' ? 'error' : null)
      setSendError(state === 'error' ? error : null)
    })
    return () => {
      offRefresh()
      offStatus()
    }
  }, [])

  const openSession = useCallback((s) => {
    setSelected(s)
    setView('session')
    setDetail(null)
    setLoadingDetail(true)
    setSendState(null)
    setSendError(null)
    openFileRef.current = s.file
    window.flux.sessions.watch(s.file)
    window.flux.sessions
      .read(s.file)
      .then((res) => {
        setDetail(res.ok ? res.session : { ok: false, error: res.error })
        setLoadingDetail(false)
      })
      .catch((e) => {
        setDetail({ ok: false, error: String(e) })
        setLoadingDetail(false)
      })
  }, [])

  const sendMessage = useCallback(
    (message) => {
      if (!selected || !detail || sendState === 'running') return
      setSendState('running')
      setSendError(null)
      window.flux.sessions
        .send({
          sessionId: detail.sessionId || selected.sessionId,
          // resume must run from the session's creation cwd (where its file lives)
          cwd: detail.firstCwd || detail.cwd,
          message
        })
        .then((res) => {
          if (!res.ok) {
            setSendState('error')
            setSendError(res.error || 'failed to start claude')
          }
        })
        .catch((e) => {
          setSendState('error')
          setSendError(String(e))
        })
    },
    [selected, detail, sendState]
  )

  return (
    <div className="app-shell">
      <Sidebar
        sessions={sessions}
        loading={sessionsLoading}
        error={sessionsError}
        selectedId={view === 'session' ? selected?.sessionId : null}
        onSelect={openSession}
        onShowStats={() => setView('stats')}
        statsActive={view === 'stats'}
        theme={theme}
        onTheme={setTheme}
      />
      <main className="main-pane">
        <div className="topbar">
          <button
            className={'tab' + (view === 'terminal' ? ' active' : '')}
            onClick={() => setView('terminal')}
          >
            ⌨ Terminal
          </button>
          <button
            className={'tab' + (view === 'stats' ? ' active' : '')}
            onClick={() => setView('stats')}
          >
            📊 Stats
          </button>
          <button
            className={'tab' + (view === 'skills' ? ' active' : '')}
            onClick={() => setView('skills')}
          >
            🧩 Skills
          </button>
          {selected && (
            <button
              className={'tab' + (view === 'session' ? ' active' : '')}
              onClick={() => setView('session')}
              title={selected.cwd}
            >
              {selected.title}
            </button>
          )}
        </div>

        {/* Terminal stays mounted; just hidden when not active. */}
        <div className="pane-slot" style={{ display: view === 'terminal' ? 'flex' : 'none' }}>
          <LivePanel />
          <TerminalPane theme={theme} />
        </div>
        {view === 'session' && (
          <div className="pane-slot">
            <SessionView
              detail={detail}
              loading={loadingDetail}
              sendState={sendState}
              sendError={sendError}
              onSend={sendMessage}
            />
          </div>
        )}
        {view === 'stats' && (
          <div className="pane-slot">
            <StatsView sessions={sessions} loading={sessionsLoading} />
          </div>
        )}
        {view === 'skills' && (
          <div className="pane-slot">
            <SkillsView />
          </div>
        )}
      </main>
    </div>
  )
}
