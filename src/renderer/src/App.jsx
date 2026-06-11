import { useState, useCallback, useEffect, useRef } from 'react'
import Sidebar from './components/Sidebar'
import TerminalWorkspace from './components/TerminalWorkspace'
import SessionView from './components/SessionView'
import StatsView from './components/StatsView'
import SkillsView from './components/SkillsView'
import MissionControl from './components/MissionControl'
import SettingsPage from './components/SettingsPage'
import SearchOverlay from './components/SearchOverlay'
import UsageBar from './components/UsageBar'
import ControlBar from './components/ControlBar'
import NotificationBell from './components/NotificationBell'
import { DEFAULT_MODEL, isKnownModel } from './lib/models'
import ThemeBackground from './components/ThemeBackground'
import { resolveMotion, prefersReducedMotion } from './lib/appearance'
import { useSettings } from './lib/settings-context'

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
  const [newChat, setNewChat] = useState(null) // { cwd } when composing a new chat
  const [activePtyId, setActivePtyId] = useState(null)

  const { settings, update } = useSettings()
  const theme = settings.appearance.theme
  const animated = resolveMotion(settings.appearance.animations, prefersReducedMotion())
  const model = isKnownModel(settings.appearance.model) ? settings.appearance.model : DEFAULT_MODEL
  const setTheme = (t) => update('appearance.theme', t)
  const setModel = (m) => update('appearance.model', m)

  const openFileRef = useRef(null) // the file currently watched, for refresh matching
  const [searchOpen, setSearchOpen] = useState(false)
  const [scrollTarget, setScrollTarget] = useState(null) // { idx, key }

  const [live, setLive] = useState(null)
  useEffect(() => window.flux.live.onUpdate(setLive), [])

  // Ctrl+Shift+F opens the search overlay from anywhere in the app
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        setSearchOpen((o) => !o)
      } else if (e.ctrlKey && !e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault()
        setView((v) => (v === 'mission' ? 'terminal' : 'mission'))
      } else if (e.ctrlKey && !e.shiftKey && e.key === ',') {
        e.preventDefault()
        setView((v) => (v === 'settings' ? 'terminal' : 'settings'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
      if (state === 'running') setSendState('running')
      else if (state === 'error') {
        setSendState('error')
        setSendError(error)
      } else if (state === 'interrupted') {
        setSendState('interrupted')
        setSendError(null)
      } else setSendState(null)
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

  // A Mission Control card carries enough to open the session directly; if it's
  // already in our list use that object, else synthesize the minimum openSession needs.
  const openCard = useCallback(
    (card) => {
      const sess =
        sessions.find((s) => s.sessionId === card.sessionId) ||
        { sessionId: card.sessionId, file: card.file, title: card.title, cwd: card.cwd }
      openSession(sess)
    },
    [sessions, openSession]
  )

  const openSearchResult = useCallback(
    (sessionId, file, msgIdx) => {
      const sess = sessions.find((s) => s.sessionId === sessionId)
      if (!sess) return
      // Open the session (reuses existing openSession logic), then after the
      // detail loads we need scrollTarget to fire. We set it now with a unique
      // key so the effect re-triggers even if the same idx is selected twice.
      openSession(sess)
      setScrollTarget({ idx: msgIdx, key: Date.now() })
    },
    [sessions, openSession]
  )

  const startNewChat = useCallback(() => {
    setSelected(null)
    setDetail(null)
    setSendState(null)
    setSendError(null)
    setNewChat({ cwd: '' }) // '' => main defaults to home; user can pick a folder
    setView('session')
  }, [])

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
          const open = (tries) => {
            window.flux.sessions.list({ limit: 50 }).then((r) => {
              const found = r.ok && r.sessions.find((s) => s.sessionId === res.sessionId)
              if (found) {
                setNewChat(null)
                openSession(found)
              } else if (tries > 0) {
                setTimeout(() => open(tries - 1), 600)
              } else {
                setSendState('error')
                setSendError('New session did not appear — it may still be starting. Try again.')
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
          message,
          model
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
    [selected, detail, sendState, model]
  )

  // Tell main which session is open (+ null when not in a session view) so it can
  // suppress notifications for the session you're actively looking at.
  useEffect(() => {
    const id = view === 'session' ? (detail?.sessionId || selected?.sessionId || null) : null
    window.flux.notify.setOpenSession(id)
  }, [view, detail, selected])

  // A clicked notification asks us to open that session.
  useEffect(() => {
    return window.flux.notify.onOpenSession(({ sessionId }) => {
      const sess = sessions.find((s) => s.sessionId === sessionId)
      if (sess) openSession(sess)
    })
  }, [sessions, openSession])

  return (
    <div className="app-shell">
      <ThemeBackground theme={theme} animated={animated} />
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
        onNewChat={startNewChat}
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
          <button
            className={'tab' + (view === 'mission' ? ' active' : '')}
            onClick={() => setView('mission')}
            title="Mission Control — all active sessions (Ctrl+M)"
          >
            🛰 Mission
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
          <ControlBar
            model={model}
            onModel={setModel}
            agents={live && live.tracking ? live.subagents : null}
            liveActive={!!(live && live.tracking && live.state === 'live')}
            onAgentsClick={() => setView('terminal')}
            ptyId={activePtyId}
            onOpenSettings={() => setView('settings')}
          />
          <NotificationBell onOpenSession={(id) => {
            const sess = sessions.find((s) => s.sessionId === id)
            if (sess) openSession(sess)
          }} />
          <UsageBar />
        </div>

        {/* Terminal stays mounted; just hidden when not active. */}
        <div className="pane-slot" style={{ display: view === 'terminal' ? 'flex' : 'none' }}>
          <TerminalWorkspace theme={theme} onActivePty={setActivePtyId} />
        </div>
        {view === 'session' && (
          <div className="pane-slot">
            <SessionView
              detail={detail}
              loading={loadingDetail}
              sendState={sendState}
              sendError={sendError}
              onSend={newChat ? sendNewChat : sendMessage}
              newChat={newChat}
              scrollTarget={scrollTarget}
              onPickFolder={async () => {
                const r = await window.flux.dialog.pickFolder()
                if (r.ok) setNewChat((nc) => ({ ...(nc || {}), cwd: r.path }))
              }}
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
        {view === 'mission' && (
          <div className="pane-slot">
            <MissionControl onOpenCard={openCard} />
          </div>
        )}
        {view === 'settings' && (
          <div className="pane-slot">
            <SettingsPage />
          </div>
        )}
      </main>

      {searchOpen && (
        <SearchOverlay
          sessions={sessions}
          onOpen={openSearchResult}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  )
}
