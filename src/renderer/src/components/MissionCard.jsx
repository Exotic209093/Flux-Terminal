// src/renderer/src/components/MissionCard.jsx
const CHIP_LABEL = { error: 'error', blocked: 'needs you', running: 'running', finished: 'done', idle: 'idle' }

function rel(ms, now) {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.round(s / 60) + 'm ago'
  if (s < 86400) return Math.round(s / 3600) + 'h ago'
  return Math.round(s / 86400) + 'd ago'
}

export default function MissionCard({ card, now, onOpen }) {
  return (
    <div className={'mcard ' + card.group} onClick={() => onOpen(card)}>
      <div className="mcard-top">
        <span className="mcard-title" title={card.title}>{card.title}</span>
        <span className={'mcard-chip ' + card.status}>{CHIP_LABEL[card.status]}</span>
      </div>
      <div className="mcard-proj" title={card.cwd}>{card.cwd || card.project}</div>
      <div className="mcard-snippet">{card.lastSnippet || '—'}</div>
      <div className="mcard-meta">
        <span>${card.costUsd.toFixed(2)}</span>
        {card.model && <span>{card.model.replace(/^claude-/, '')}</span>}
        {card.subagents.running > 0 && <span>▶ {card.subagents.running}</span>}
        <span style={{ marginLeft: 'auto' }}>{rel(card.lastActivityMs, now)}</span>
      </div>
    </div>
  )
}
