// Pure helpers for activity-reactive visuals.
function tokensPerSecFrom(prevTokens, prevTs, tokens, ts) {
  if (!prevTs || !ts || ts <= prevTs) return 0
  const dt = (ts - prevTs) / 1000
  const dTok = Math.max(0, (tokens || 0) - (prevTokens || 0))
  return dt > 0 ? dTok / dt : 0
}

function reactiveSpeed(base, tokensPerSec) {
  const t = Math.max(0, tokensPerSec || 0)
  return base * (1 + Math.min(2, t / 50)) // up to 3x at ~100+ tok/s
}

export { tokensPerSecFrom, reactiveSpeed }
