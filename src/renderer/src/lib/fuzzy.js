// Lightweight fuzzy matcher for the command palette. No dependency.

function fuzzyScore(query, text) {
  if (query == null || query === '') return 1
  const q = String(query).toLowerCase()
  const t = String(text || '').toLowerCase()
  if (!t) return 0
  if (t === q) return 1000
  if (t.startsWith(q)) return 800
  // substring match only meaningful for multi-char queries
  if (q.length > 1) {
    const sub = t.indexOf(q)
    if (sub !== -1) return 600 - sub
  }
  // subsequence: first char must land on a word boundary (position 0 or after a separator)
  let ti = 0
  let score = 100
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]
    const found = t.indexOf(c, ti)
    if (found === -1) return 0
    const wordStart = found === 0 || /[\s/_\-.]/.test(t[found - 1])
    // first character of query must be a word-boundary match
    if (qi === 0 && !wordStart) return 0
    if (wordStart) score += 8
    score -= found - ti
    ti = found + 1
  }
  return Math.max(1, score)
}

function fuzzyFilter(query, items, keyFn) {
  const key = keyFn || ((x) => x)
  if (!query) return items.slice()
  const scored = []
  for (const it of items) {
    const s = fuzzyScore(query, key(it))
    if (s > 0) scored.push({ it, s })
  }
  scored.sort((a, b) => b.s - a.s)
  return scored.map((x) => x.it)
}

export { fuzzyScore, fuzzyFilter }
