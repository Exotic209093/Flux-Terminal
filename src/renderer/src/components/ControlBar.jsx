import { useState, useEffect } from 'react'
import ModelPicker from './ModelPicker'
import SettingsPopover from './SettingsPopover'

// Topbar control cluster: model picker, running-subagent badge, remote-control
// toggle. `agents` is the live summary { running, total } or null. `liveActive`
// is true when a tracked claude is running in the terminal.
export default function ControlBar({ model, onModel, agents, liveActive, onAgentsClick, ptyId, animations, onToggleAnimations }) {
  const [remoteOn, setRemoteOn] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // When the live session ends, the toggle can no longer reflect remote state.
  useEffect(() => {
    if (!liveActive) setRemoteOn(false)
  }, [liveActive])
  const toggleRemote = () => {
    if (!liveActive) return
    window.flux.pty.write(ptyId, '/remote-control\r')
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
      <div className="settings-anchor">
        <button
          className={'settings-gear' + (settingsOpen ? ' on' : '')}
          onClick={() => setSettingsOpen((o) => !o)}
          title="Notification settings"
        >
          ⚙
        </button>
        {settingsOpen && (
          <SettingsPopover
            onClose={() => setSettingsOpen(false)}
            animations={animations}
            onToggleAnimations={onToggleAnimations}
          />
        )}
      </div>
    </div>
  )
}
