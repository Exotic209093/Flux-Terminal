// src/renderer/src/components/TabBar.jsx
import { useState } from 'react'

export default function TabBar({ tabs, activeTabId, onSelect, onClose, onRename, onNew }) {
  const [editing, setEditing] = useState(null) // tabId being renamed

  return (
    <div className="tabbar">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={'tab-chip' + (t.id === activeTabId ? ' active' : '')}
          onClick={() => onSelect(t.id)}
          onDoubleClick={() => setEditing(t.id)}
          title={t.title}
        >
          {editing === t.id ? (
            <input
              className="tab-rename"
              autoFocus
              defaultValue={t.title}
              onBlur={(e) => { onRename(t.id, e.target.value.trim() || t.title); setEditing(null) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.target.blur()
                if (e.key === 'Escape') setEditing(null)
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="tab-label">{t.title}</span>
          )}
          <button
            className="tab-close"
            title="Close tab"
            onClick={(e) => { e.stopPropagation(); onClose(t.id) }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-new" title="New tab (Ctrl+T)" onClick={onNew}>
        +
      </button>
    </div>
  )
}
