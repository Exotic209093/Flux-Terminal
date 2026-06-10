import { useState } from 'react'
import { formatTokens, totalTokens, relativeTime, projectName, modelLabel } from '../lib/format'
import { THEMES } from '../lib/themes'
import fluxIcon from '../assets/flux-icon.png'

export default function Sidebar({
  sessions,
  loading,
  error,
  selectedId,
  onSelect,
  onShowStats,
  statsActive,
  theme,
  onTheme,
  onNewChat
}) {
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const list = sessions || []
  const filtered = q
    ? list.filter(
        (s) => (s.title || '').toLowerCase().includes(q) || (s.cwd || '').toLowerCase().includes(q)
      )
    : list

  const grandTotal = list.reduce((acc, s) => acc + totalTokens(s.usage), 0)

  return (
    <aside className="sidebar">
      <button className="new-chat-btn" onClick={onNewChat}>+ New chat</button>
      <header className="sidebar-head">
        <div className="brand-row">
          <div className="brand">
            <img className="brand-bolt" src={fluxIcon} alt="" /> Flux Terminal
          </div>
          <select
            className="theme-select"
            value={theme}
            onChange={(e) => onTheme(e.target.value)}
            title="Theme"
          >
            {Object.entries(THEMES).map(([k, t]) => (
              <option key={k} value={k}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="brand-sub">
          {list.length} sessions · {formatTokens(grandTotal)} tokens
        </div>
        <button
          className={'stats-btn' + (statsActive ? ' active' : '')}
          onClick={onShowStats}
        >
          📊 Stats &amp; achievements
        </button>
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
