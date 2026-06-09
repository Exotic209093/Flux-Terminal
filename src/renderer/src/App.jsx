import { useState, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import TerminalPane from './components/TerminalPane'
import SessionView from './components/SessionView'

// Milestone 2: a live terminal AND a session replay view. The terminal stays
// mounted at all times (hidden, not unmounted) so its PTY — and any running
// `claude` — survives switching to a session and back.
export default function App() {
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [view, setView] = useState('terminal') // 'terminal' | 'session'

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
      <Sidebar selectedId={view === 'session' ? selected?.sessionId : null} onSelect={openSession} />
      <main className="main-pane">
        <div className="topbar">
          <button
            className={'tab' + (view === 'terminal' ? ' active' : '')}
            onClick={() => setView('terminal')}
          >
            ⌨ Terminal
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

        {/* Terminal stays mounted; just hidden when viewing a session. */}
        <div className="pane-slot" style={{ display: view === 'terminal' ? 'flex' : 'none' }}>
          <TerminalPane />
        </div>
        {view === 'session' && (
          <div className="pane-slot">
            <SessionView detail={detail} loading={loadingDetail} />
          </div>
        )}
      </main>
    </div>
  )
}
