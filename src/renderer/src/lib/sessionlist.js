// Pure helpers for the live sessions store (unit-tested without React).

/** Find a session by id, or synthesize the minimum openSession needs from
 *  fallback fields (a Mission Control card, a search hit). Null if neither. */
export function resolveSession(sessions, sessionId, fallback = {}) {
  const found = (sessions || []).find((s) => s.sessionId === sessionId)
  if (found) return found
  if (!fallback.file) return null
  return {
    sessionId,
    file: fallback.file,
    title: fallback.title || String(sessionId).slice(0, 8),
    cwd: fallback.cwd || ''
  }
}

/** Merge a session:append payload into the open detail object. */
export function mergeAppend(detail, payload) {
  if (!detail || detail.ok === false || !Array.isArray(detail.timeline)) return detail
  if (!payload || payload.file !== detail.file) return detail
  return { ...payload.session, timeline: [...detail.timeline, ...payload.items] }
}
