import { useState } from 'react'
import { CATEGORIES, filterSettings } from './settings/registry'

export default function SettingsPage() {
  const [active, setActive] = useState('appearance')
  const [query, setQuery] = useState('')
  const visible = filterSettings(query)
  const current = CATEGORIES.find((c) => c.id === active) || CATEGORIES[0]
  const Section = current.Section
  return (
    <div className="settings-page">
      <div className="settings-rail">
        <div className="settings-rail-title">⚙ Settings</div>
        <input
          className="settings-search"
          placeholder="Search settings…"
          value={query}
          onChange={(e) => {
            const v = e.target.value
            setQuery(v)
            const vis = filterSettings(v)
            if (vis.length && !vis.includes(active)) setActive(vis[0])
          }}
        />
        {CATEGORIES.filter((c) => visible.includes(c.id)).map((c) => (
          <button
            key={c.id}
            className={'settings-nav' + (active === c.id ? ' active' : '')}
            onClick={() => setActive(c.id)}
          >
            <span className="settings-nav-icon">{c.icon}</span> {c.label}
          </button>
        ))}
      </div>
      <div className="settings-content">
        <Section />
      </div>
    </div>
  )
}
