import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { themeColors } from '../lib/themes'

// One xterm bound to one PTY id. The PTY is spawned on mount and killed on
// unmount. Data/exit events are filtered to this pane's id.
export default function TerminalPane({ ptyId, theme, cwd, shell, onFocus }) {
  const hostRef = useRef(null)

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
    term.open(hostRef.current)
    fit.fit()

    window.flux.pty.spawn({ id: ptyId, cols: term.cols, rows: term.rows, cwd, shell })
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
      clearTimeout(t)
      window.removeEventListener('resize', syncSize)
      ro.disconnect()
      offData()
      offExit()
      onInput.dispose()
      term.dispose()
      window.flux.pty.kill(ptyId)
    }
  }, [ptyId])

  return <div className="terminal-host" ref={hostRef} onMouseDown={onFocus} />
}
