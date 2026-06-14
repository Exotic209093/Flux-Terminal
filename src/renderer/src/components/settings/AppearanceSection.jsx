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

      <div className="set-sec-label">Intensity</div>
      <div className="set-row">
        <div className="set-row-l"><span className="set-row-name">Background intensity</span><span className="set-row-desc">How much the animated scene shows through the terminal.</span></div>
        <div className="set-seg">
          {['subtle', 'balanced', 'bold'].map((v) => (
            <button key={v} className={'set-seg-btn' + ((settings.appearance.intensity || 'balanced') === v ? ' on' : '')} onClick={() => update('appearance.intensity', v)}>{v}</button>
          ))}
        </div>
      </div>

      <div className="set-sec-label">Sound</div>
      <div className="set-row">
        <div className="set-row-l"><span className="set-row-name">Sound cues (in-app)</span><span className="set-row-desc">A soft WebAudio blip on turn-finished / error / blocked.</span></div>
        <input type="checkbox" checked={!!(settings.audio && settings.audio.enabled)} onChange={(e) => update('audio.enabled', e.target.checked)} />
      </div>
    </div>
  )
}
