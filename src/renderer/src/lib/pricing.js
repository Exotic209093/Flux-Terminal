// Per-model pricing for the cost estimator.
//
// Rates are USD per 1,000,000 tokens, sourced from the claude-api reference:
//   - input / output: published per-model rates
//   - cache read:  ~0.10x the input rate
//   - cache write: 1.25x (5-minute TTL) or 2x (1-hour TTL) the input rate
//
// Claude Code sessions are overwhelmingly cache-read tokens, so input+output
// alone undercounts cost massively — we price all four token categories.
//
// NOTE: cache-write cost assumes the API default 5-minute TTL (1.25x). Treat
// the total as a close estimate, not a billed figure.

const OPUS = { input: 5, output: 25 }
const SONNET = { input: 3, output: 15 }
const HAIKU = { input: 1, output: 5 }

const BASE_RATES = {
  'claude-opus-4-8': OPUS,
  'claude-opus-4-7': OPUS,
  'claude-opus-4-6': OPUS,
  'claude-opus-4-5': OPUS,
  'claude-opus-4-1': OPUS,
  'claude-sonnet-4-6': SONNET,
  'claude-sonnet-4-5': SONNET,
  'claude-haiku-4-5': HAIKU
}

const CACHE_READ_MULT = 0.1
const CACHE_WRITE_MULT = 1.25 // 5-minute TTL default

function ratesFor(model) {
  if (model && BASE_RATES[model]) return BASE_RATES[model]
  // Fall back by family if an exact id isn't listed.
  if (model && /opus/i.test(model)) return OPUS
  if (model && /sonnet/i.test(model)) return SONNET
  if (model && /haiku/i.test(model)) return HAIKU
  return OPUS // sensible default for Claude Code sessions
}

/**
 * Estimate USD cost from a usage object {input, output, cacheRead, cacheCreation}.
 * Returns a breakdown plus the total.
 */
export function estimateCost(usage, model) {
  const r = ratesFor(model)
  const u = usage || {}
  const input = ((u.input || 0) * r.input) / 1e6
  const output = ((u.output || 0) * r.output) / 1e6
  const cacheRead = ((u.cacheRead || 0) * r.input * CACHE_READ_MULT) / 1e6
  const cacheWrite = ((u.cacheCreation || 0) * r.input * CACHE_WRITE_MULT) / 1e6
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite
  }
}

export function formatUSD(n) {
  if (n == null) return '$0.00'
  if (n >= 1000) return '$' + (n / 1000).toFixed(2) + 'k'
  if (n >= 1) return '$' + n.toFixed(2)
  if (n >= 0.01) return '$' + n.toFixed(2)
  return '$' + n.toFixed(4)
}
