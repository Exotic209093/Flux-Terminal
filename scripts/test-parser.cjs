// Validate session discovery + the defensive parser against the real
// ~/.claude/projects data.  Run: node scripts/test-parser.cjs

const { listSessions, projectsDir } = require('../src/main/sessions')

function fmt(n) {
  return n.toLocaleString('en-US')
}

console.log('projects dir:', projectsDir())
const t0 = Date.now()
const sessions = listSessions({ limit: 1000 })
const ms = Date.now() - t0
console.log(`parsed ${sessions.length} sessions in ${ms}ms\n`)

// --- Per-session table (top 12 most recent) ---
console.log('Most recent sessions:')
for (const s of sessions.slice(0, 12)) {
  const tok = s.usage.input + s.usage.output + s.usage.cacheRead + s.usage.cacheCreation
  const title = (s.title || '').replace(/\s+/g, ' ').slice(0, 48)
  console.log(
    `  ${s.sessionId.slice(0, 8)}  ${String(s.counts.total).padStart(4)} msg  ` +
      `${String(fmt(tok)).padStart(12)} tok  ${(s.models[0] || '?').padEnd(22)} ${title}`
  )
}

// --- Aggregate stats (previews the gamification pillar) ---
const agg = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
const tools = {}
let totalMsgs = 0
let parseErrors = 0
for (const s of sessions) {
  agg.input += s.usage.input
  agg.output += s.usage.output
  agg.cacheRead += s.usage.cacheRead
  agg.cacheCreation += s.usage.cacheCreation
  totalMsgs += s.counts.total
  parseErrors += s.parseErrors
  for (const [name, c] of Object.entries(s.tools)) tools[name] = (tools[name] || 0) + c
}

const grand = agg.input + agg.output + agg.cacheRead + agg.cacheCreation
console.log('\nAggregate across all sessions:')
console.log(`  sessions:        ${fmt(sessions.length)}`)
console.log(`  messages:        ${fmt(totalMsgs)}`)
console.log(`  input tokens:    ${fmt(agg.input)}`)
console.log(`  output tokens:   ${fmt(agg.output)}`)
console.log(`  cache read:      ${fmt(agg.cacheRead)}`)
console.log(`  cache creation:  ${fmt(agg.cacheCreation)}`)
console.log(`  GRAND TOTAL:     ${fmt(grand)} tokens`)
console.log(`  parse errors:    ${parseErrors} (should be ~0)`)

const topTools = Object.entries(tools)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
console.log('\nTop tools used:')
for (const [name, c] of topTools) console.log(`  ${String(c).padStart(6)}  ${name}`)
