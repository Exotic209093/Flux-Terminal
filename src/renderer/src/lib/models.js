// Selectable models for the chat composer's model picker. Kept in sync with the
// pricing table in lib/pricing.js. `id` is what we pass to `claude --model`.
export const MODELS = [
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' }
]

export const DEFAULT_MODEL = 'claude-opus-4-8'

export function isKnownModel(id) {
  return MODELS.some((m) => m.id === id)
}

export function modelLabelFor(id) {
  const m = MODELS.find((x) => x.id === id)
  return m ? m.label : id
}
