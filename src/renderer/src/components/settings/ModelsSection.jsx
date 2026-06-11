import { useSettings } from '../../lib/settings-context'
import { MODELS, DEFAULT_MODEL, isKnownModel } from '../../lib/models'

export default function ModelsSection() {
  const { settings, update } = useSettings()
  const current = isKnownModel(settings.appearance.model) ? settings.appearance.model : DEFAULT_MODEL
  return (
    <div>
      <div className="set-h">Models</div>
      <div className="set-sub">The model new chats and sends use by default.</div>
      <div className="set-row">
        <div className="set-row-l">
          <span className="set-row-name">Default model</span>
          <span className="set-row-desc">Also changeable from the topbar picker.</span>
        </div>
        <select
          className="settings-search"
          style={{ margin: 0 }}
          value={current}
          onChange={(e) => update('appearance.model', e.target.value)}
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
