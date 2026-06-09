const fs = require('fs')

// Defensive parser for Claude Code session JSONL files.
//
// Hard requirements (these files are often read WHILE Claude Code is writing them):
//   - tolerate a truncated/half-written final line (don't crash, don't flicker)
//   - tolerate unknown event `type`s (the format drifts across releases; there's a
//     `version` field) — unknown lines are counted, never fatal
//   - never throw on a single bad line; surface a parseErrors count instead

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

const MAX_TEXT = 6000 // cap per-item text so a huge message can't bloat the UI

function truncate(s, n = MAX_TEXT) {
  if (typeof s !== 'string') return ''
  return s.length > n ? s.slice(0, n) + '…' : s
}

/** Render a tool input/result block to a short preview string. */
function preview(value, n = 600) {
  if (value == null) return ''
  if (typeof value === 'string') return truncate(value, n)
  try {
    return truncate(JSON.stringify(value), n)
  } catch {
    return ''
  }
}

/**
 * Parse a session file into a structured summary model.
 * Reads the whole file (sessions are small — tens to low thousands of lines).
 * Pass { timeline: true } to also collect an ordered list of conversation items
 * (user prompts, thinking, assistant text, tool calls + results) for the replay view.
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
  const lines = raw.split('\n')
  const model = {
    ok: true,
    file: filePath,
    sessionId: null,
    cwd: null,
    gitBranch: null,
    title: null,
    version: null,
    models: [],
    firstTimestamp: null,
    lastTimestamp: null,
    counts: { user: 0, assistant: 0, toolUse: 0, toolResult: 0, thinking: 0, system: 0, total: 0 },
    usage: emptyUsage(),
    tools: {},
    lastUserPrompt: null,
    parseErrors: 0,
    lineCount: 0
  }

  const modelSet = new Set()

  lines.forEach((line, idx) => {
    if (!line.trim()) return
    const o = parseLine(line)
    if (!o) {
      // A truncated final line while the file is being written is expected;
      // anything earlier is a genuine parse error worth counting.
      const isLast = idx === lines.length - 1
      if (!isLast) model.parseErrors++
      return
    }

    model.lineCount++
    if (o.sessionId && !model.sessionId) model.sessionId = o.sessionId
    if (o.cwd) model.cwd = o.cwd
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
        model.counts.user++
        countContent(o, model, timeline, 'user')
        break
      case 'assistant': {
        model.counts.assistant++
        const msg = o.message || {}
        if (msg.model) modelSet.add(msg.model)
        addUsage(model.usage, msg.usage)
        countContent(o, model, timeline, 'assistant')
        break
      }
      case 'system':
        model.counts.system++
        break
      default:
        // mode / permission-mode / attachment / file-history-snapshot / unknown
        break
    }
  })

  model.counts.total = model.counts.user + model.counts.assistant
  model.models = Array.from(modelSet)
  if (timeline) model.timeline = timeline
  return model
}

/**
 * Walk a message's content blocks: tally counts, and (when `timeline` is given)
 * append ordered replay items. `role` is 'user' or 'assistant'.
 */
function countContent(o, model, timeline, role) {
  const ts = o.timestamp || null
  const content = o.message && o.message.content

  // A user turn may be a bare string prompt rather than a block array.
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
        if (timeline && block.thinking) {
          timeline.push({ kind: 'thinking', ts, text: truncate(block.thinking) })
        }
        break
      case 'tool_use':
        model.counts.toolUse++
        if (block.name) model.tools[block.name] = (model.tools[block.name] || 0) + 1
        if (timeline) {
          timeline.push({ kind: 'tool_use', ts, toolName: block.name || 'tool', toolInput: preview(block.input) })
        }
        break
      case 'tool_result':
        model.counts.toolResult++
        if (timeline) {
          timeline.push({ kind: 'tool_result', ts, isError: !!block.is_error, text: preview(block.content) })
        }
        break
      default:
        break
    }
  }
}

module.exports = { parseSessionFile, parseLine }
