import { useState, useCallback, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import TerminalPane from './components/TerminalPane'
import SessionView from './components/SessionView'
import StatsView from './components/StatsView'
import { applyTheme, loadTheme, saveTheme } from './lib/themes'

// Milestone 2: live terminal + session replay + cross-session stats + themes.
// The terminal stays MOUNTED at all times so its PTY (and any running `claude`)
// survives switching to a session/stats view and back.
export default function App() {
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState(null)

  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [view, setView] = useState('terminal') // 'terminal' | 'session' | 'stats'

  const [theme, setThemeState] = useState(loadTheme())

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

  const openSession = useCallback((s) => {
    setSelected(s)
    setView('session')
    setDetail(null)
    setLoadingDetail(true)
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
          <TerminalPane theme={theme} />
        </div>
        {view === 'session' && (
          <div className="pane-slot">
            <SessionView detail={detail} loading={loadingDetail} />
          </div>
        )}
        {view === 'stats' && (
          <div className="pane-slot">
            <StatsView sessions={sessions} loading={sessionsLoading} />
          </div>
        )}
      </main>
    </div>
  )
}
