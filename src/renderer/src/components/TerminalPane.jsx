import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { themeColors } from '../lib/themes'

// One xterm bound to one PTY id. The PTY is spawned on mount and killed on
// unmount. Data/exit events are filtered to this pane's id.
export default function TerminalPane({ ptyId, theme, cwd, shell, initialInput, onFocus }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const searchRef = useRef(null)
  const [search, setSearch] = useState(null) // null = closed; string = open with query

  useEffect(() => {
    const c = themeColors(theme)
    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: c.background,
        foreground: c.foreground,
        cursor: c.cursor,
        selectionBackground: 'rgba(137,180,250,0.25)'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)
    termRef.current = term
    searchRef.current = searchAddon
    term.open(hostRef.current)
    fit.fit()

    // Don't send app-level shortcuts into the shell — the workspace keydown
    // handler (or App.jsx) owns these combos.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (e.altKey && /^Arrow/.test(e.key)) return false
      if (e.ctrlKey && e.shiftKey && /^[eEoO]$/.test(e.key)) return false
      if (e.ctrlKey && !e.shiftKey && /^[tTwW]$/.test(e.key)) return false
      if (e.ctrlKey && e.key === 'Tab') return false
      return true
    })

    let cancelled = false
    window.flux.pty.spawn({ id: ptyId, cols: term.cols, rows: term.rows, cwd, shell }).then(() => {
      if (cancelled) return
      if (initialInput) window.flux.pty.write(ptyId, initialInput)
    })
    const offData = window.flux.pty.onData(({ id, data }) => {
      if (id === ptyId) term.write(data)
    })
    const offExit = window.flux.pty.onExit(({ id }) => {
      if (id === ptyId) term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n')
    })
    const onInput = term.onData((data) => window.flux.pty.write(ptyId, data))

    const syncSize = () => {
      fit.fit()
      window.flux.pty.resize(ptyId, { cols: term.cols, rows: term.rows })
    }
    window.addEventListener('resize', syncSize)
    const ro = new ResizeObserver(() => syncSize())
    if (hostRef.current) ro.observe(hostRef.current)
    const t = setTimeout(syncSize, 60)

    return () => {
      cancelled = true
      clearTimeout(t)
      window.removeEventListener('resize', syncSize)
      ro.disconnect()
      offData()
      offExit()
      onInput.dispose()
      termRef.current = null
      searchRef.current = null
      term.dispose()
      window.flux.pty.kill(ptyId)
    }
  }, [ptyId])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onKey = (e) => {
      if (e.ctrlKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        e.stopPropagation()
        setSearch((s) => (s === null ? '' : null))
      }
    }
    host.addEventListener('keydown', onKey)
    return () => host.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="terminal-host-wrap">
      {search !== null && (
        <div className="pane-search">
          <input
            autoFocus
            className="pane-search-input"
            placeholder="search scrollback…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); searchRef.current && searchRef.current.findNext(e.target.value, { incremental: true }) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') searchRef.current && (e.shiftKey ? searchRef.current.findPrevious(search) : searchRef.current.findNext(search))
              if (e.key === 'Escape') { setSearch(null); termRef.current && termRef.current.focus() }
            }}
          />
          <button className="pane-search-btn" onClick={() => searchRef.current && searchRef.current.findPrevious(search)} title="Previous (Shift+Enter)">↑</button>
          <button className="pane-search-btn" onClick={() => searchRef.current && searchRef.current.findNext(search)} title="Next (Enter)">↓</button>
          <button className="pane-search-btn" onClick={() => { setSearch(null); termRef.current && termRef.current.focus() }} title="Close (Esc)">×</button>
        </div>
      )}
      <div className="terminal-host" ref={hostRef} onMouseDown={onFocus} />
    </div>
  )
}
