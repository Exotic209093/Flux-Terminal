import { useState } from 'react'
import Sidebar from './components/Sidebar'
import TerminalPane from './components/TerminalPane'

// Milestone 1 vertical slice: a real terminal alongside a sidebar that lists
// your actual Claude Code sessions. (Replay/timeline land in Milestone 2.)
export default function App() {
  const [selected, setSelected] = useState(null)

  return (
    <div className="app-shell">
      <Sidebar selectedId={selected?.sessionId} onSelect={setSelected} />
      <main className="main-pane">
        <div className="topbar">
          <span className="topbar-label">{selected ? selected.title : 'Terminal'}</span>
          {selected && (
            <span className="topbar-sub" title={selected.cwd}>
              {selected.cwd}
            </span>
          )}
        </div>
        <TerminalPane />
      </main>
    </div>
  )
}
