import { MODELS } from '../lib/models'

// Chat model selector. Controlled by App; the chosen model is passed to every
// `claude` chat send (new + resumed). Does NOT affect the live terminal.
export default function ModelPicker({ model, onChange }) {
  return (
    <label className="model-picker" title="Model used for chats (new + resumed). Not the terminal.">
      <span className="model-picker-diamond">◆</span>
      <select value={model} onChange={(e) => onChange(e.target.value)}>
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  )
}
