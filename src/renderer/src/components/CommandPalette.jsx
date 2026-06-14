import { useState, useEffect, useRef } from 'react'
import { filterCommands } from '../lib/palette'

const GLYPH = { action: '⚡', session: '💬', prompt: '✎' }

export default function CommandPalette({ commands, onRun, onClose }) {
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef(null)
  const results = filterCommands(query, commands)
  const selected = Math.max(0, Math.min(sel, results.length - 1))

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus()
  }, [])
  useEffect(() => {
    setSel(0)
  }, [query])

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[selected]) onRun(results[selected]) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Jump to a session, run an action, launch a prompt…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list">
          {results.length === 0 && <div className="palette-empty">No matches.</div>}
          {results.map((c, i) => (
            <div
              key={c.kind + ':' + (c.sessionId || c.action || c.label) + ':' + i}
              className={'palette-row' + (i === selected ? ' sel' : '')}
              onMouseEnter={() => setSel(i)}
              onClick={() => onRun(c)}
            >
              <span className="palette-glyph">{GLYPH[c.kind] || '•'}</span>
              <span className="palette-label">{c.label}</span>
              {c.sub && <span className="palette-sub">{c.sub}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
