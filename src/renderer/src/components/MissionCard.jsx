// src/renderer/src/components/MissionCard.jsx
import { estimateCost, formatUSD } from '../lib/pricing'

const CHIP_LABEL = { error: 'error', blocked: 'needs you', running: 'running', finished: 'done', idle: 'idle' }

function rel(ms, now) {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.round(s / 60) + 'm'
  if (s < 86400) return Math.round(s / 3600) + 'h'
  return Math.round(s / 86400) + 'd'
}

function todoSummary(todos) {
  const done = todos.filter((t) => t.status === 'completed').length
  const active = todos.find((t) => t.status === 'in_progress')
  return { done, total: todos.length, active: active ? active.content : null }
}

export default function MissionCard({ card, now, onOpen }) {
  const todos = Array.isArray(card.todos) && card.todos.length ? todoSummary(card.todos) : null
  return (
    <div className={'mcard ' + card.group} onClick={() => onOpen(card)}>
      <div className="mcard-top">
        <span className="mcard-title" title={card.title}>{card.title}</span>
        {card.attnSince && card.group === 'needsYou' && (
          <span className="mcard-age" title="time waiting on you">⏱ {rel(card.attnSince, now)}</span>
        )}
        <span className={'mcard-chip ' + card.status}>{CHIP_LABEL[card.status]}</span>
      </div>
      <div className="mcard-proj" title={card.cwd}>{card.cwd || card.project}</div>
      <div className="mcard-snippet">{card.lastSnippet || '—'}</div>
      {todos && (
        <div className="mcard-todos" title={todos.active || ''}>
          ✓ {todos.done}/{todos.total}{todos.active ? ' · ' + todos.active : ''}
        </div>
      )}
      <div className="mcard-meta">
        <span>{formatUSD(estimateCost(card.usage, card.model).total)}</span>
        {card.model && <span>{card.model.replace(/^claude-/, '')}</span>}
        {card.subagents.running > 0 && <span>▶ {card.subagents.running}</span>}
        <button
          className="mcard-snooze"
          title="Snooze notifications for 30 min"
          onClick={(e) => { e.stopPropagation(); window.flux.notify.snooze(card.sessionId, 30) }}
        >
          😴
        </button>
        <span style={{ marginLeft: 'auto' }}>{rel(card.lastActivityMs, now)} ago</span>
      </div>
    </div>
  )
}
