import { useSettings } from '../../lib/settings-context'

const ROWS = [
  ['turnFinished', 'Turn finished (long)'],
  ['turnError', 'Error / failed'],
  ['blocked', 'Blocked / waiting'],
  ['usageThreshold', 'Usage limit ≥ 90%']
]
const MODES = ['toast', 'badge', 'off']

export default function NotificationsSection() {
  const { settings, update } = useSettings()
  const n = settings.notify
  return (
    <div>
      <div className="set-h">Notifications</div>
      <div className="set-sub">How Flux alerts you about background sessions.</div>

      <div className="set-row">
        <div className="set-row-l">
          <span className="set-row-name">Mute all</span>
          <span className="set-row-desc">Do not disturb — suppress every notification.</span>
        </div>
        <input type="checkbox" checked={!!n.muted} onChange={(e) => update('notify.muted', e.target.checked)} />
      </div>

      <div className="set-sec-label">Per event</div>
      {ROWS.map(([key, label]) => (
        <div className="set-row" key={key}>
          <div className="set-row-l"><span className="set-row-name">{label}</span></div>
          <div className="set-seg">
            {MODES.map((m) => (
              <button key={m} className={'set-seg-btn' + (n[key] === m ? ' on' : '')} onClick={() => update('notify.' + key, m)}>
                {m}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="set-row">
        <div className="set-row-l"><span className="set-row-name">Play a sound</span></div>
        <input type="checkbox" checked={!!n.sound} onChange={(e) => update('notify.sound', e.target.checked)} />
      </div>

      <button className="set-test-btn" onClick={() => window.flux.notify.test()}>Send test notification</button>
    </div>
  )
}
