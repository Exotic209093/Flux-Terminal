// Mechanism test for the live tailer (isolated from real correlation):
// synthesize a session file, append lines on a timer, and confirm LiveTracker
// finds it and the accumulated counts/tokens climb. Run: node scripts/test-live.cjs

const path = require('path')
const os = require('os')
const fs = require('fs')
const { LiveTracker } = require('../src/main/live')

const base = path.join(os.homedir(), '.claude', 'projects', 'flux-livetest')
fs.mkdirSync(base, { recursive: true })
const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const file = path.join(base, uuid + '.jsonl')
fs.writeFileSync(file, '')

const snaps = []
const tracker = new LiveTracker((s) => {
  snaps.push(s)
  const u = s.usage || {}
  const tok = (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheCreation || 0)
  console.log(`[${s.state || '-'}] msgs=${s.counts ? s.counts.total : 0} tok=${tok} lastTool=${s.lastTool || '-'}`)
})
tracker.track(uuid)

let n = 0
const appendTimer = setInterval(() => {
  n++
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: new Date(2026, 5, 9, 12, 0, n).toISOString(),
    sessionId: uuid,
    message: {
      model: 'claude-opus-4-8',
      role: 'assistant',
      content: [
        { type: 'text', text: 'step ' + n },
        { type: 'tool_use', name: n % 2 ? 'Bash' : 'Edit', input: { cmd: 'echo ' + n } }
      ],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10 }
    }
  })
  fs.appendFileSync(file, line + '\n')
  if (n >= 6) clearInterval(appendTimer)
}, 700)

setTimeout(() => {
  tracker.stop()
  const liveSnaps = snaps.filter((s) => s.state === 'live')
  const finalMsgs = liveSnaps.length ? liveSnaps[liveSnaps.length - 1].counts.total : 0
  const finalTok = liveSnaps.length
    ? (() => {
        const u = liveSnaps[liveSnaps.length - 1].usage
        return u.input + u.output + u.cacheRead + u.cacheCreation
      })()
    : 0
  console.log('--- RESULT ---')
  console.log('live snapshots:', liveSnaps.length, 'final msgs:', finalMsgs, 'final tok:', finalTok)
  try {
    fs.rmSync(base, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  const ok = finalMsgs === 6 && finalTok === 6 * 1160
  console.log(ok ? 'LIVE_OK' : 'LIVE_FAIL')
  process.exit(ok ? 0 : 1)
}, 9000)
