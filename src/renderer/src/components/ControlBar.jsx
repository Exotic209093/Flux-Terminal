import { useState } from 'react'
import ModelPicker from './ModelPicker'

// Topbar control cluster: model picker, running-subagent badge, remote-control
// toggle. `agents` is the live summary { running, total } or null. `liveActive`
// is true when a tracked claude is running in the terminal.
export default function ControlBar({ model, onModel, agents, liveActive, onAgentsClick }) {
  const [remoteOn, setRemoteOn] = useState(false)
  const toggleRemote = () => {
    if (!liveActive) return
    window.flux.pty.write('/remote-control\r')
    setRemoteOn((v) => !v)
  }
  const running = agents ? agents.running : 0
  return (
    <div className="control-bar">
      <ModelPicker model={model} onChange={onModel} />
      {running > 0 && (
        <button className="agents-badge" onClick={onAgentsClick} title="Running subagents — click to view">
          ▶ {running} agent{running === 1 ? '' : 's'}
        </button>
      )}
      <button
        className={'remote-toggle' + (remoteOn ? ' on' : '')}
        onClick={toggleRemote}
        disabled={!liveActive}
        title={
          liveActive
            ? "Send /remote-control to the live terminal (can't read true state)"
            : 'No live claude running in the terminal'
        }
      >
        ⊙ Remote{remoteOn ? ' on' : ''}
      </button>
    </div>
  )
}
