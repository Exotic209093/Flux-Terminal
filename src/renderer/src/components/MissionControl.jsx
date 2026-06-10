// src/renderer/src/components/MissionControl.jsx
import { useEffect, useState } from 'react'
import MissionCard from './MissionCard'

const GROUPS = [
  { key: 'needsYou', title: 'Needs you' },
  { key: 'running', title: 'Running' },
  { key: 'idle', title: 'Idle / recently finished' }
]

export default function MissionControl({ onOpenCard }) {
  const [cards, setCards] = useState([])
  const [now, setNow] = useState(() => Date.now())
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    let alive = true
    window.flux.missioncontrol.list().then((res) => {
      if (alive && res.ok) setCards(res.cards)
    })
    const off = window.flux.missioncontrol.onUpdate((next) => setCards(next))
    const tick = setInterval(() => setNow(Date.now()), 5000) // refresh "x ago" labels
    return () => {
      alive = false
      off()
      clearInterval(tick)
    }
  }, [])

  const byGroup = (g) => cards.filter((c) => c.group === g)

  const refresh = () => window.flux.missioncontrol.list().then((res) => { if (res.ok) setCards(res.cards) })

  return (
    <div className="mission">
      <div className="mission-toolbar">
        <div className="mission-filter">
          {[['all', 'All'], ['needsYou', 'Needs you'], ['running', 'Running']].map(([k, label]) => (
            <button key={k} className={'mfilter' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
        <button className="mission-refresh" onClick={refresh} title="Refresh">⟳</button>
      </div>
      {cards.length === 0 && <div className="mission-empty">No active sessions in the last 24h.</div>}
      {GROUPS.filter((g) => filter === 'all' || g.key === filter).map((g) => {
        const items = byGroup(g.key)
        if (!items.length) return null
        return (
          <div key={g.key}>
            <div className="mission-group-title">{g.title} · {items.length}</div>
            <div className="mission-grid">
              {items.map((c) => (
                <MissionCard key={c.sessionId} card={c} now={now} onOpen={onOpenCard} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
