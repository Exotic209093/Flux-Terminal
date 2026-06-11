import { createContext, useContext, useState, useEffect } from 'react'

const SessionsContext = createContext(null)

// The live sessions store: seeded by one sessions:list, then kept fresh by
// main's sessions:changed pushes (the SessionIndex watcher). Replaces the old
// fetch-once-at-mount list that went stale the moment a new session started.
export function SessionsProvider({ children }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    let pushed = false // a sessions:changed push is fresher than the seed reply
    window.flux.sessions
      .list({ limit: 500 })
      .then((res) => {
        if (!alive || pushed) return
        if (res.ok) setSessions(res.sessions)
        else setError(res.error || 'failed to load sessions')
        setLoading(false)
      })
      .catch((e) => {
        if (!alive || pushed) return
        setError(String(e))
        setLoading(false)
      })
    const off = window.flux.sessions.onChanged(({ sessions: next }) => {
      pushed = true
      setSessions(next)
      setLoading(false)
      setError(null)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  return <SessionsContext.Provider value={{ sessions, loading, error }}>{children}</SessionsContext.Provider>
}

export function useSessions() {
  const ctx = useContext(SessionsContext)
  if (!ctx) throw new Error('useSessions must be used within SessionsProvider')
  return ctx
}
