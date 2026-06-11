export const CATEGORY_META = [
  { id: 'appearance', label: 'Appearance', icon: '🎨' },
  { id: 'notifications', label: 'Notifications', icon: '🔔' },
  { id: 'terminal', label: 'Terminal', icon: '⌨' },
  { id: 'models', label: 'Models', icon: '◆' },
  { id: 'about', label: 'About', icon: 'ℹ' }
]

export const SEARCH_INDEX = [
  { category: 'appearance', label: 'Theme', keywords: 'theme color midnight aurora nebula synthwave matrix nord dracula' },
  { category: 'appearance', label: 'Background animation', keywords: 'animation motion reduced' },
  { category: 'notifications', label: 'Notification events', keywords: 'notify toast badge turn finished error blocked usage' },
  { category: 'notifications', label: 'Sound', keywords: 'sound beep' },
  { category: 'notifications', label: 'Mute', keywords: 'mute do not disturb dnd' },
  { category: 'terminal', label: 'Shell profiles', keywords: 'terminal shell profile powershell claude' },
  { category: 'models', label: 'Default model', keywords: 'model opus sonnet haiku fable' },
  { category: 'about', label: 'About Flux', keywords: 'version about github' }
]

// Pure: returns the category ids whose label or any entry matches the query.
export function filterSettings(query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return CATEGORY_META.map((c) => c.id)
  const hits = new Set()
  for (const c of CATEGORY_META) if (c.label.toLowerCase().includes(q)) hits.add(c.id)
  for (const e of SEARCH_INDEX) {
    if (e.label.toLowerCase().includes(q) || e.keywords.includes(q)) hits.add(e.category)
  }
  return CATEGORY_META.filter((c) => hits.has(c.id)).map((c) => c.id)
}
