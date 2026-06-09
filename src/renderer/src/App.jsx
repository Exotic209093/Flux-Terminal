import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// Milestone 0 spike: a single, real terminal pane wired to a node-pty process
// in the main process. The acceptance test is: `claude` runs in here normally.
export default function App() {
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
        cursor: '#89b4fa'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    fit.fit()

    // Spawn the PTY sized to the current terminal, then pipe both directions.
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
    const t = setTimeout(syncSize, 60)

    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', syncSize)
      offData()
      offExit()
      onInput.dispose()
      term.dispose()
    }
  }, [])

  return <div id="terminal-host" ref={hostRef} />
}
