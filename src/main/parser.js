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

/**
 * Parse a session file into a structured summary model.
 * Reads the whole file (sessions are small — tens to low thousands of lines).
 */
function parseSessionFile(filePath) {
  let raw = ''
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    return { ok: false, error: err.message, file: filePath }
  }

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
        countContent(o, model)
        break
      case 'assistant': {
        model.counts.assistant++
        const msg = o.message || {}
        if (msg.model) modelSet.add(msg.model)
        addUsage(model.usage, msg.usage)
        countContent(o, model)
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
  return model
}

/** Walk a message's content blocks, tallying thinking / tool_use / tool_result. */
function countContent(o, model) {
  const content = o.message && o.message.content
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    switch (block.type) {
      case 'thinking':
        model.counts.thinking++
        break
      case 'tool_use':
        model.counts.toolUse++
        if (block.name) model.tools[block.name] = (model.tools[block.name] || 0) + 1
        break
      case 'tool_result':
        model.counts.toolResult++
        break
      default:
        break
    }
  }
}

module.exports = { parseSessionFile, parseLine }
