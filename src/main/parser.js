const fs = require('fs')

// Defensive parser for Claude Code session JSONL files.
//
// Hard requirements (these files are read WHILE Claude Code is writing them):
//   - tolerate a truncated/half-written final line (don't crash, don't flicker)
//   - tolerate unknown event `type`s (the format drifts across releases)
//   - never throw on a single bad line; surface a parseErrors count instead
//
// The per-line logic (freshModel + applyEvent + finalize) is shared between the
// whole-file parse and the live incremental tailer (live.js) so the two can't
// drift apart.

const MAX_TEXT = 6000 // cap per-item text so a huge message can't bloat the UI
const MAX_IMAGE_B64 = 2_000_000 // ~1.5 MB decoded; bigger images become placeholders
const MAX_IMAGES = 40 // per parse — a screenshot-heavy session can't bloat the IPC payload

/** Parse one line; return the object or null if it isn't valid JSON yet. */
function parseLine(line) {
  const s = line.trim()
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
}

function addUsage(acc, u) {
  if (!u || typeof u !== 'object') return
  acc.input += u.input_tokens || 0
  acc.output += u.output_tokens || 0
  acc.cacheRead += u.cache_read_input_tokens || 0
  acc.cacheCreation += u.cache_creation_input_tokens || 0
}

function truncate(s, n = MAX_TEXT) {
  if (typeof s !== 'string') return ''
  return s.length > n ? s.slice(0, n) + '…' : s
}

function preview(value, n = 600) {
  if (value == null) return ''
  if (typeof value === 'string') return truncate(value, n)
  try {
    return truncate(JSON.stringify(value), n)
  } catch {
    return ''
  }
}

/** A fresh accumulator. `__models` is an internal Set, stripped by finalize(). */
function freshModel(file) {
  return {
    ok: true,
    file: file || null,
    sessionId: null,
    cwd: null,
    firstCwd: null, // creation cwd — maps to the project dir the file lives in (resume needs this)
    gitBranch: null,
    title: null,
    version: null,
    models: [],
    __models: new Set(),
    __usageIds: new Set(), // message.ids already counted (streamed blocks share an id)
    firstTimestamp: null,
    lastTimestamp: null,
    counts: { user: 0, assistant: 0, toolUse: 0, toolResult: 0, thinking: 0, system: 0, image: 0, total: 0 },
    usage: emptyUsage(),
    tools: {},
    lastTool: null,
    lastContextTokens: 0, // prompt size of the most recent assistant turn (= current context fill)
    lastUserPrompt: null,
    turnDurationCount: 0, // system/turn_duration records seen (exact turn closes)
    lastTurnDurationMs: 0,
    parseErrors: 0,
    errorCount: 0, // best-effort count of error/failure records (attention.js consumes deltas)
    lineCount: 0
  }
}

/**
 * Best-effort: does this record look like a turn/API error/failure?
 * The Claude Code JSONL schema drifts, so this is a tunable marker set, not a
 * contract — verify against a real errored transcript later.
 */
function isErrorRecord(o) {
  if (!o || typeof o !== 'object') return false
  if (o.isApiErrorMessage === true) return true
  if (o.type === 'result' && o.is_error === true) return true
  if (o.type === 'system' && o.subtype === 'error') return true
  return false
}

/**
 * Is this user record a real human prompt? Most type:'user' records (~87%
 * measured) are tool_result carriers, and isMeta marks injected context —
 * neither opens a turn nor counts as a message.
 */
function isRealUserPrompt(o) {
  if (o.isMeta) return false
  const content = o.message && o.message.content
  if (typeof content === 'string') return content.trim().length > 0
  if (Array.isArray(content)) return content.length > 0 && !content.some((b) => b && b.type === 'tool_result')
  return false
}

/** Apply one parsed event object to the accumulator (and optional timeline). */
function applyEvent(o, model, timeline) {
  model.lineCount++
  if (isErrorRecord(o)) model.errorCount++
  if (o.sessionId && !model.sessionId) model.sessionId = o.sessionId
  if (o.cwd) {
    model.cwd = o.cwd
    // The session file lives in the project dir of the CREATION cwd; resuming
    // must run from there even if the user cd'd later in the session.
    if (!model.firstCwd) model.firstCwd = o.cwd
  }
  if (o.gitBranch) model.gitBranch = o.gitBranch
  if (o.version) model.version = o.version
  if (o.timestamp) {
    if (!model.firstTimestamp) model.firstTimestamp = o.timestamp
    model.lastTimestamp = o.timestamp
  }

  switch (o.type) {
    case 'ai-title':
      if (o.aiTitle) model.title = o.aiTitle
      break
    case 'last-prompt':
      if (typeof o.lastPrompt === 'string') model.lastUserPrompt = o.lastPrompt
      break
    case 'user':
      if (isRealUserPrompt(o)) model.counts.user++
      walkContent(o, model, timeline, 'user')
      break
    case 'assistant': {
      const msg = o.message || {}
      // Claude Code writes one record per streamed content block; records of the
      // same message share message.id with byte-identical usage. Count each
      // message once — otherwise tokens inflate 2.4-2.75x (verified 2026-06-11).
      const msgId = msg.id || null
      if (!msgId || !model.__usageIds.has(msgId)) {
        if (msgId) model.__usageIds.add(msgId)
        model.counts.assistant++
        if (msg.model) model.__models.add(msg.model)
        addUsage(model.usage, msg.usage)
        const u = msg.usage
        if (u) {
          // Prompt tokens for this turn = current context fill; keep the latest.
          model.lastContextTokens =
            (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
        }
      }
      walkContent(o, model, timeline, 'assistant')
      break
    }
    case 'system':
      model.counts.system++
      if (o.subtype === 'turn_duration') {
        model.turnDurationCount++
        if (typeof o.durationMs === 'number') model.lastTurnDurationMs = o.durationMs
      }
      break
    default:
      break
  }
}

/** Walk a message's content blocks: tally counts and (optionally) push timeline items. */
function walkContent(o, model, timeline, role) {
  const ts = o.timestamp || null
  const content = o.message && o.message.content

  if (role === 'user' && typeof content === 'string') {
    if (timeline && content.trim()) timeline.push({ kind: 'user', ts, text: truncate(content) })
    return
  }
  if (!Array.isArray(content)) return

  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    switch (block.type) {
      case 'text':
        if (timeline && block.text && block.text.trim()) {
          timeline.push({ kind: role === 'user' ? 'user' : 'text', ts, text: truncate(block.text) })
        }
        break
      case 'thinking':
        model.counts.thinking++
        if (timeline && block.thinking) timeline.push({ kind: 'thinking', ts, text: truncate(block.thinking) })
        break
      case 'tool_use':
        model.counts.toolUse++
        if (block.name) {
          model.tools[block.name] = (model.tools[block.name] || 0) + 1
          model.lastTool = block.name
        }
        if (timeline) timeline.push({ kind: 'tool_use', ts, toolName: block.name || 'tool', toolInput: preview(block.input) })
        break
      case 'image':
        pushImage(block, model, timeline, ts)
        break
      case 'tool_result': {
        model.counts.toolResult++
        const inner = Array.isArray(block.content) ? block.content : null
        if (timeline) {
          const text = inner
            ? truncate(
                inner
                  .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
                  .map((b) => b.text)
                  .join('\n'),
                600
              )
            : preview(block.content)
          timeline.push({ kind: 'tool_result', ts, isError: !!block.is_error, text })
        }
        if (inner) {
          for (const b of inner) {
            if (b && b.type === 'image') pushImage(b, model, timeline, ts)
          }
        }
        break
      }
      default:
        break
    }
  }
}

/** Push an image content block as a timeline item (with size/count caps). */
function pushImage(block, model, timeline, ts) {
  const src = block && block.source
  if (!src || src.type !== 'base64' || typeof src.data !== 'string') return
  model.counts.image++
  if (!timeline) return
  const mediaType = src.media_type || 'image/png'
  if (src.data.length > MAX_IMAGE_B64 || model.counts.image > MAX_IMAGES) {
    timeline.push({ kind: 'image', ts, truncated: true, mediaType })
    return
  }
  timeline.push({ kind: 'image', ts, mediaType, data: src.data })
}

/** Convert the internal model Set to a serializable array; compute totals. */
function finalize(model) {
  model.counts.total = model.counts.user + model.counts.assistant
  model.models = Array.from(model.__models)
  delete model.__models
  delete model.__usageIds
  return model
}

/**
 * Parse a whole session file into a structured summary.
 * Pass { timeline: true } to also collect an ordered list of replay items.
 */
function parseSessionFile(filePath, opts = {}) {
  const collectTimeline = !!opts.timeline
  let raw = ''
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    return { ok: false, error: err.message, file: filePath }
  }

  const timeline = collectTimeline ? [] : null
  const model = freshModel(filePath)
  const lines = raw.split('\n')

  lines.forEach((line, idx) => {
    if (!line.trim()) return
    const o = parseLine(line)
    if (!o) {
      // A truncated final line while the file is being written is expected.
      if (idx !== lines.length - 1) model.parseErrors++
      return
    }
    applyEvent(o, model, timeline)
  })

  if (timeline) model.timeline = timeline
  return finalize(model)
}

module.exports = { parseSessionFile, parseLine, freshModel, applyEvent, finalize, isErrorRecord, isRealUserPrompt }
