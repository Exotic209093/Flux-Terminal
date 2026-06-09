// Small display helpers shared across the UI.

export function formatTokens(n) {
  if (!n || n < 1000) return String(n || 0)
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'K'
  if (n < 1_000_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  return (n / 1_000_000_000).toFixed(2) + 'B'
}

export function totalTokens(usage) {
  if (!usage) return 0
  return (usage.input || 0) + (usage.output || 0) + (usage.cacheRead || 0) + (usage.cacheCreation || 0)
}

export function relativeTime(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const s = Math.max(0, (Date.now() - then) / 1000)
  if (s < 60) return 'just now'
  const m = s / 60
  if (m < 60) return Math.floor(m) + 'm ago'
  const h = m / 60
  if (h < 24) return Math.floor(h) + 'h ago'
  const d = h / 24
  if (d < 7) return Math.floor(d) + 'd ago'
  if (d < 30) return Math.floor(d / 7) + 'w ago'
  return new Date(iso).toLocaleDateString()
}

export function projectName(cwd) {
  if (!cwd) return 'unknown'
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || cwd
}

/** Max context window (tokens) for a model id. Opus/Sonnet 4.x = 1M, Haiku = 200K. */
export function modelContext(model) {
  if (model && /haiku/i.test(model)) return 200_000
  return 1_000_000
}

/** Short, friendly model label: "claude-opus-4-8" -> "Opus 4.8". */
export function modelLabel(model) {
  if (!model) return ''
  const m = /claude-(opus|sonnet|haiku)-(\d+)-(\d+)/i.exec(model)
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`
  return model
}
