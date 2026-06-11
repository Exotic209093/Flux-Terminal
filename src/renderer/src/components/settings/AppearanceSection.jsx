import { useSettings } from '../../lib/settings-context'
import { THEMES } from '../../lib/themes'

const ANIM = [
  ['auto', 'Auto'],
  ['on', 'On'],
  ['off', 'Off']
]

export default function AppearanceSection() {
  const { settings, update } = useSettings()
  const a = settings.appearance
  return (
    <div>
      <div className="set-h">Appearance</div>
      <div className="set-sub">Theme, motion, and how Flux looks.</div>

      <div className="set-sec-label">Theme</div>
      <div className="set-swatches">
        {Object.entries(THEMES).map(([key, t]) => (
          <button
            key={key}
            className={'set-sw' + (a.theme === key ? ' active' : '')}
            onClick={() => update('appearance.theme', key)}
          >
            <span className="set-sw-prev" style={{ background: t.vars['--bg'] }}>
              <span style={{ color: t.vars['--accent'] }}>⚡</span>
            </span>
            <span className="set-sw-name">{t.name}</span>
          </button>
        ))}
      </div>

      <div className="set-sec-label">Motion</div>
      <div className="set-row">
        <div className="set-row-l">
          <span className="set-row-name">Background animation</span>
          <span className="set-row-desc">Animated theme backgrounds. Auto follows your OS reduced-motion setting.</span>
        </div>
        <div className="set-seg">
          {ANIM.map(([val, lbl]) => (
            <button
              key={val}
              className={'set-seg-btn' + (a.animations === val ? ' on' : '')}
              onClick={() => update('appearance.animations', val)}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
