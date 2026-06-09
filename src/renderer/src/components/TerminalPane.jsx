import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// The live terminal: a real PTY (node-pty/ConPTY) bridged through window.flux.
export default function TerminalPane() {
  const hostRef = useRef(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: '#0b0e14',
        foreground: '#cdd6f4',
        cursor: '#89b4fa',
        selectionBackground: '#2a3045'
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
