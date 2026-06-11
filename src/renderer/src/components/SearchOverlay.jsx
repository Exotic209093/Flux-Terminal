import { useState, useEffect, useRef, useCallback } from 'react'
import { groupHits, moveSelection } from '../lib/searchnav.js'

// Reopening the overlay restores the previous results ("back to results"
// after jumping to a hit). Module-level on purpose: survives unmount.
let lastState = { query: '', hits: [] }

/**
 * Cross-session search overlay (FTS-backed).
 * Ctrl+Shift+F from App.jsx; Esc closes (works from any focus inside the
 * modal); ArrowUp/Down + Enter navigate hits. Operators: role: tool: file:
 * project: error:true. onOpen(sessionId, file, msgIdx) navigates to the hit.
 */
export default function SearchOverlay({ sessions, onOpen, onClose }) {
  const [query, setQuery] = useState(lastState.query)
  const [hits, setHits] = useState(lastState.hits)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total } or null
  const [selected, setSelected] = useState(lastState.hits.length ? 0 : -1)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const selectedRef = useRef(null)

  useEffect(() => {
    inputRef.current && inputRef.current.focus()
    const off = window.flux.search.onProgress((p) => setProgress(p))
    return () => {
      off()
      clearTimeout(debounceRef.current)
    }
  }, [])

  // Keep the restore cache current.
  useEffect(() => {
    lastState = { query, hits }
  }, [query, hits])

  // Keep the selected hit visible.
  useEffect(() => {
    if (selectedRef.current) selectedRef.current.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const runSearch = useCallback((q) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setHits([])
      setSelected(-1)
      setBusy(false)
      setProgress(null)
      return
    }
    setBusy(true)
    window.flux.search.query(trimmed).then((res) => {
      setBusy(false)
      setProgress(null)
      const next = res && res.ok ? res.hits || [] : []
      setHits(next)
      setSelected(next.length ? 0 : -1)
    })
  }, [])

  const onChange = (e) => {
    const q = e.target.value
    setQuery(q)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(q), 250)
  }

  const { grouped, flat } = groupHits(hits, sessions)

  const openFlat = useCallback(
    (f) => {
      if (!f) return
      onOpen(f.sessionId, f.file, f.hit.msgIdx)
      onClose()
    },
    [onOpen, onClose]
  )

  // Modal-level keys: Esc always closes; arrows/Enter drive the selection even
  // while the input has focus.
  const onModalKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => moveSelection(flat.length, s, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => moveSelection(flat.length, s, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      openFlat(flat[selected] || flat[0])
    }
  }

  let flatIndex = -1

  return (
    <div className="search-overlay-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="search-overlay-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Cross-session search"
        onKeyDown={onModalKeyDown}
      >
        <div className="search-overlay-input-row">
          <span className="search-overlay-icon">⌕</span>
          <input
            ref={inputRef}
            className="search-overlay-input"
            type="text"
            placeholder="Search all sessions…  (Ctrl+Shift+F)"
            value={query}
            onChange={onChange}
            spellCheck={false}
          />
          {busy && <span className="search-overlay-spinner" aria-label="Searching" />}
          <button className="search-overlay-close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="search-overlay-ops">
          role:user&thinsp;·&thinsp;tool:Bash&thinsp;·&thinsp;file:&thinsp;·&thinsp;project:&thinsp;·&thinsp;error:true
          <span className="search-overlay-ops-kbd">↑↓ select · Enter open · Esc close</span>
        </div>

        {progress && (
          <div className="search-overlay-progress">
            Indexing sessions… {progress.done}/{progress.total}
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
              {group.hits.map((h, i) => {
                flatIndex++
                const isSelected = flatIndex === selected
                const idx = flatIndex
                return (
                  <button
                    key={i}
                    ref={isSelected ? selectedRef : null}
                    className={'search-hit' + (isSelected ? ' selected' : '')}
                    onMouseEnter={() => setSelected(idx)}
                    onClick={() => openFlat(flat[idx])}
                  >
                    <span className={'search-hit-role role-' + h.role}>{h.role}</span>
                    <span className="search-hit-snippet">
                      {h.snippet.slice(0, h.matchStart)}
                      <mark className="search-hit-mark">{h.snippet.slice(h.matchStart, h.matchEnd)}</mark>
                      {h.snippet.slice(h.matchEnd)}
                    </span>
                    {h.ts && <span className="search-hit-time">{shortDate(h.ts)}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function projectName(p) {
  if (!p) return '(unknown)'
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
