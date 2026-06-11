// Pure helpers for SearchOverlay keyboard navigation (unit-tested without React).

/** Group hits by session (render order) + a flat selection list aligned with it. */
export function groupHits(hits, sessions) {
  const grouped = []
  const seen = new Map()
  for (const h of hits) {
    if (!seen.has(h.sessionId)) {
      const meta = (sessions || []).find((s) => s.sessionId === h.sessionId) || {}
      const group = {
        sessionId: h.sessionId,
        project: h.project,
        title: h.title || meta.title || h.sessionId,
        // hits carry their own file (the FTS index spans every transcript);
        // the live store only holds the most recent 500 sessions
        file: h.file || meta.file || null,
        hits: []
      }
      seen.set(h.sessionId, group)
      grouped.push(group)
    }
    seen.get(h.sessionId).hits.push(h)
  }
  const flat = []
  for (const g of grouped) {
    for (const hit of g.hits) flat.push({ sessionId: g.sessionId, file: g.file, hit })
  }
  return { grouped, flat }
}

/** Clamped selection movement; -1 means nothing selected. */
export function moveSelection(flatLen, current, delta) {
  if (!flatLen) return -1
  if (current < 0) return 0 // first move selects the first hit
  return Math.max(0, Math.min(flatLen - 1, current + delta))
}
