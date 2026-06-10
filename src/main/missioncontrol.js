// src/main/missioncontrol.js
// PURE: turn monitor records into ordered Mission Control card DTOs. No fs/timers.

const STATUS_RANK = { error: 0, blocked: 1, running: 2, finished: 3, idle: 4 }
const GROUP_OF = { error: 'needsYou', blocked: 'needsYou', running: 'running', finished: 'idle', idle: 'idle' }
const FINISHED_MS = 5 * 60_000

function statusFor(rec, now) {
  if (rec.hasError) return 'error'
  if (rec.blocked) return 'blocked'
  if (rec.turnOpen) return 'running'
  if (rec.lastRole === 'assistant' && now - rec.lastActivityMs < FINISHED_MS) return 'finished'
  return 'idle'
}

function composeCards(records, now) {
  const cards = records.map((r) => {
    const status = statusFor(r, now)
    return {
      sessionId: r.sessionId,
      file: r.file,
      project: r.project,
      cwd: r.cwd,
      title: r.title,
      model: r.model,
      costUsd: r.costUsd,
      subagents: r.subagents || { running: 0, total: 0 },
      lastSnippet: r.lastSnippet || '',
      lastActivityMs: r.lastActivityMs,
      origin: r.origin || 'auto',
      status,
      group: GROUP_OF[status]
    }
  })
  cards.sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.lastActivityMs - a.lastActivityMs
  )
  return cards
}

function cardsChanged(prev, next) {
  if (!prev || prev.length !== next.length) return true
  for (let i = 0; i < next.length; i++) {
    const a = prev[i]
    const b = next[i]
    if (
      a.sessionId !== b.sessionId ||
      a.status !== b.status ||
      a.costUsd !== b.costUsd ||
      a.subagents.running !== b.subagents.running ||
      a.lastSnippet !== b.lastSnippet
    ) {
      return true
    }
  }
  return false
}

module.exports = { composeCards, cardsChanged, statusFor, STATUS_RANK, GROUP_OF, FINISHED_MS }
