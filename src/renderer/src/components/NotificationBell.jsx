// src/renderer/src/components/NotificationBell.jsx
import { useEffect, useState } from 'react'

const ICON = { 'turn:finished': '✓', 'turn:error': '⚠', blocked: '⏳', 'usage:threshold': '📊', test: '🔔' }

function rel(ts, now) {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.round(s / 60) + 'm'
  return Math.round(s / 3600) + 'h'
}

export default function NotificationBell({ onOpenSession }) {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    window.flux.notify.history().then((h) => setItems(h || []))
    const off = window.flux.notify.onHistoryAdd((entry) => {
      setItems((prev) => [entry, ...prev].slice(0, 50))
      setUnread((u) => u + 1)
    })
    const tick = setInterval(() => setNow(Date.now()), 10000)
    return () => { off(); clearInterval(tick) }
  }, [])

  const toggle = () => { setOpen((o) => !o); setUnread(0) }

  return (
    <div className="bell-anchor">
      <button className={'bell-btn' + (unread > 0 ? ' has-unread' : '')} onClick={toggle} title="Notifications">
        🔔{unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" onMouseLeave={() => setOpen(false)}>
          <div className="bell-title">Recent notifications</div>
          {items.length === 0 && <div className="bell-empty">Nothing yet.</div>}
          {items.map((it, i) => (
            <div
              key={i}
              className="bell-item"
              onClick={() => { if (it.sessionId && it.sessionId !== '__test__') onOpenSession(it.sessionId); setOpen(false) }}
            >
              <span className="bell-icon">{ICON[it.type] || '•'}</span>
              <span className="bell-item-title">{it.title}</span>
              <span className="bell-item-time">{rel(it.ts, now)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
