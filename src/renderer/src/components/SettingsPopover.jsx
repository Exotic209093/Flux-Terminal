// src/renderer/src/components/SettingsPopover.jsx
import { useEffect, useState } from 'react'

const ROWS = [
  { key: 'turnFinished', label: 'Turn finished (long)' },
  { key: 'turnError', label: 'Error / failed' },
  { key: 'blocked', label: 'Blocked / waiting' },
  { key: 'usageThreshold', label: 'Usage limit ≥ 90%' }
]
const MODES = ['toast', 'badge', 'off']

export default function SettingsPopover({ onClose, animations, onToggleAnimations }) {
  const [notify, setNotify] = useState(null)

  useEffect(() => {
    window.flux.settings.get().then((s) => s && setNotify(s.notify))
  }, [])

  const setMode = (key, value) => {
    window.flux.settings.setNotify(key, value).then((res) => {
      if (res.ok) setNotify(res.settings.notify)
    })
  }

  if (!notify) return null
  return (
    <div className="settings-pop" onMouseLeave={onClose}>
      <div className="settings-pop-title">Appearance</div>
      <label className="settings-mute">
        <input
          type="checkbox"
          checked={!!animations}
          onChange={(e) => onToggleAnimations(e.target.checked)}
        />
        Background animation
      </label>
      <div className="settings-pop-title">Notifications</div>
      <label className="settings-mute">
        <input type="checkbox" checked={!!notify.muted} onChange={(e) => setMode('muted', e.target.checked)} />
        Mute all (do not disturb)
      </label>
      {ROWS.map((r) => (
        <div className="settings-row" key={r.key}>
          <span className="settings-row-label">{r.label}</span>
          <div className="settings-seg">
            {MODES.map((m) => (
              <button
                key={m}
                className={'seg' + (notify[r.key] === m ? ' on' : '')}
                onClick={() => setMode(r.key, m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      ))}
      <label className="settings-sound">
        <input
          type="checkbox"
          checked={notify.sound}
          onChange={(e) => setMode('sound', e.target.checked)}
        />
        Play a sound
      </label>
      <button className="settings-test" onClick={() => window.flux.notify.test()}>
        Send test notification
      </button>
    </div>
  )
}
