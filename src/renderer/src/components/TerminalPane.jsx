import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { themeColors } from '../lib/themes'

// The live terminal: a real PTY (node-pty/ConPTY) bridged through window.flux.
// `theme` sets the xterm colors at mount (the app chrome restyles live; the
// terminal canvas adopts a new theme on next mount).
export default function TerminalPane({ theme }) {
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

    window.flux.pty.spawn({ cols: term.cols, rows: term.rows })
    const offData = window.flux.pty.onData((data) => term.write(data))
    const offExit = window.flux.pty.onExit(() =>
      term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n')
    )
    const onInput = term.onData((data) => window.flux.pty.write(data))

    const syncSize = () => {
      fit.fit()
      window.flux.pty.resize({ cols: term.cols, rows: term.rows })
    }
    window.addEventListener('resize', syncSize)
    // Observe the container too (sidebar toggles, layout shifts), not just window.
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
    }
  }, [])

  return <div className="terminal-host" ref={hostRef} />
}
