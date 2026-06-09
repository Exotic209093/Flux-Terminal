import { useEffect, useState } from 'react'
import { formatTokens, totalTokens, relativeTime, projectName, modelLabel } from '../lib/format'

export default function Sidebar({ selectedId, onSelect }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    window.flux.sessions
      .list({ limit: 500 })
      .then((res) => {
        if (!alive) return
        if (res.ok) setSessions(res.sessions)
        else setError(res.error || 'failed to load sessions')
        setLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        setError(String(e))
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? sessions.filter(
        (s) =>
          (s.title || '').toLowerCase().includes(q) ||
          (s.cwd || '').toLowerCase().includes(q)
      )
    : sessions

  const grandTotal = sessions.reduce((acc, s) => acc + totalTokens(s.usage), 0)

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <div className="brand">
          <span className="brand-bolt">⚡</span> Flux Terminal
        </div>
        <div className="brand-sub">
          {sessions.length} sessions · {formatTokens(grandTotal)} tokens
        </div>
        <input
          className="search"
          placeholder="Search sessions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </header>

      <div className="session-list">
        {loading && <div className="hint">Loading sessions…</div>}
        {error && <div className="hint error">⚠ {error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="hint">No sessions match “{query}”.</div>
        )}
        {filtered.map((s) => (
          <button
            key={s.sessionId}
            className={'session-card' + (s.sessionId === selectedId ? ' selected' : '')}
            onClick={() => onSelect && onSelect(s)}
            title={s.cwd}
          >
            <div className="sc-title">{s.title}</div>
            <div className="sc-meta">
              <span className="sc-project">{projectName(s.cwd)}</span>
              <span className="sc-dot">·</span>
              <span>{relativeTime(s.lastTimestamp)}</span>
            </div>
            <div className="sc-stats">
              <span className="pill">{s.counts.total} msg</span>
              <span className="pill pill-tok">{formatTokens(totalTokens(s.usage))} tok</span>
              {s.models[0] && <span className="pill pill-model">{modelLabel(s.models[0])}</span>}
            </div>
          </button>
        ))}
      </div>
    </aside>
  )
}
