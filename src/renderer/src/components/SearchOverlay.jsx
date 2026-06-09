import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * Cross-session search overlay.
 * Activated by Ctrl+Shift+F from App.jsx; dismissed by Esc or clicking the
 * backdrop. Calls window.flux.search.query(), groups results by session,
 * and invokes onOpen(sessionId, file, msgIdx) to navigate to the hit.
 */
export default function SearchOverlay({ sessions, onOpen, onClose }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total } or null
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  // Focus the input as soon as the overlay mounts
  useEffect(() => {
    inputRef.current && inputRef.current.focus()
    // Subscribe to progress events from the main process
    const off = window.flux.search.onProgress((p) => setProgress(p))
    return () => {
      off()
      clearTimeout(debounceRef.current)
    }
  }, [])

  const runSearch = useCallback((q) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setHits([])
      setBusy(false)
      setProgress(null)
      return
    }
    setBusy(true)
    setProgress(null)
    window.flux.search.query(trimmed).then((res) => {
      setBusy(false)
      setProgress(null)
      if (res && res.ok) setHits(res.hits || [])
      else setHits([])
    })
  }, [])

  const onChange = (e) => {
    const q = e.target.value
    setQuery(q)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(q), 250)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  // Group hits by sessionId, preserving the original (newest-first) order
  const grouped = []
  const seen = new Map()
  for (const h of hits) {
    if (!seen.has(h.sessionId)) {
      // Resolve session metadata from the sessions list the parent already has
      const meta = sessions.find((s) => s.sessionId === h.sessionId) || {}
      const group = {
        sessionId: h.sessionId,
        project: h.project,
        title: h.title || meta.title || h.sessionId,
        file: meta.file || null,
        hits: []
      }
      seen.set(h.sessionId, group)
      grouped.push(group)
    }
    seen.get(h.sessionId).hits.push(h)
  }

  return (
    <div className="search-overlay-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="search-overlay-modal" role="dialog" aria-modal="true" aria-label="Cross-session search">
        <div className="search-overlay-input-row">
          <span className="search-overlay-icon">?</span>
          <input
            ref={inputRef}
            className="search-overlay-input"
            type="text"
            placeholder="Search all sessions…  (Ctrl+Shift+F)"
            value={query}
            onChange={onChange}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
          {busy && <span className="search-overlay-spinner" aria-label="Searching" />}
          <button className="search-overlay-close" onClick={onClose} title="Close (Esc)">x</button>
        </div>

        {progress && (
          <div className="search-overlay-progress">
            Building search cache… {progress.done}/{progress.total}
          </div>
        )}

        <div className="search-overlay-results">
          {!query.trim() && (
            <div className="search-overlay-hint">
              Type to search across all session transcripts.
              <span className="search-overlay-hint-kbd">Ctrl+Shift+F</span> to open,
              <span className="search-overlay-hint-kbd">Esc</span> to close.
            </div>
          )}

          {query.trim() && !busy && hits.length === 0 && !progress && (
            <div className="search-overlay-hint">No results for &ldquo;{query.trim()}&rdquo;</div>
          )}

          {grouped.map((group) => (
            <div key={group.sessionId} className="search-group">
              <div className="search-group-header">
                <span className="search-group-project">{projectName(group.project)}</span>
                <span className="search-group-sep">·</span>
                <span className="search-group-title">{group.title}</span>
              </div>
              {group.hits.map((h, i) => (
                <button
                  key={i}
                  className="search-hit"
                  onClick={() => { onOpen(h.sessionId, group.file, h.msgIdx); onClose() }}
                >
                  <span className={'search-hit-role role-' + h.role}>{h.role}</span>
                  <span className="search-hit-snippet">
                    {h.snippet.slice(0, h.matchStart)}
                    <mark className="search-hit-mark">{h.snippet.slice(h.matchStart, h.matchEnd)}</mark>
                    {h.snippet.slice(h.matchEnd)}
                  </span>
                  {h.ts && (
                    <span className="search-hit-time">{shortDate(h.ts)}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function projectName(p) {
  if (!p) return '(unknown)'
  // Show only the last two path segments to keep it compact
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 2) return parts.join('/')
  return parts.slice(-2).join('/')
}

function shortDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
