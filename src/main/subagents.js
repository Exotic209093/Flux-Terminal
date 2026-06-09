const fs = require('fs')
const path = require('path')
const { parseSessionFile } = require('./parser')

// Discovery of a session's subagents (sidechain transcripts). For a session file
// at <dir>/<id>.jsonl, the subagents live at <dir>/<id>/subagents/agent-*.jsonl,
// each with a sibling agent-*.meta.json = { agentType, description, name, toolUseId }.

const DEFAULT_FRESH_MS = 12000 // a live subagent file written within this window = "running"

/** Map a session .jsonl path to its subagents directory. */
function subagentsDirFor(sessionFile) {
  const dir = path.dirname(sessionFile)
  const id = path.basename(sessionFile).replace(/\.jsonl$/, '')
  return path.join(dir, id, 'subagents')
}

function firstUserLine(parsed) {
  const t = (parsed.timeline || []).find((x) => x.kind === 'user')
  if (!t || !t.text) return ''
  return t.text.split('\n')[0].slice(0, 120)
}

function readMeta(metaPath) {
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * List a session's subagents. opts: { live, now, freshMs } control status.
 * Returns [] if the session has no subagents dir.
 */
function listSubagents(sessionFile, opts = {}) {
  const dir = subagentsDirFor(sessionFile)
  let entries
  try {
    entries = fs.readdirSync(dir).filter((f) => /^agent-.*\.jsonl$/.test(f))
  } catch {
    return []
  }
  const live = !!opts.live
  const now = opts.now || Date.now()
  const freshMs = opts.freshMs || DEFAULT_FRESH_MS
  const out = []
  for (const f of entries) {
    const full = path.join(dir, f)
    const agentId = f.replace(/^agent-/, '').replace(/\.jsonl$/, '')
    let stat
    try {
      stat = fs.statSync(full)
    } catch {
      continue
    }
    const parsed = parseSessionFile(full, { timeline: true })
    const meta = readMeta(path.join(dir, `agent-${agentId}.meta.json`))
    const label =
      (meta && (meta.description || meta.name)) || firstUserLine(parsed) || agentId
    let status = 'done'
    if (live && now - stat.mtimeMs < freshMs) status = 'running'
    else if (parsed.parseErrors > 0 && parsed.counts.assistant === 0) status = 'error'
    out.push({
      agentId,
      label,
      agentType: (meta && meta.agentType) || null,
      name: (meta && meta.name) || null,
      status,
      counts: parsed.counts,
      usage: parsed.usage,
      models: parsed.models,
      firstTimestamp: parsed.firstTimestamp,
      lastTimestamp: parsed.lastTimestamp,
      mtimeMs: stat.mtimeMs
    })
  }
  out.sort((a, b) => (a.firstTimestamp || '').localeCompare(b.firstTimestamp || ''))
  return out
}

/** Full parse (incl. timeline) of one subagent, for drill-in. */
function readSubagent(sessionFile, agentId) {
  const file = path.join(subagentsDirFor(sessionFile), `agent-${agentId}.jsonl`)
  return parseSessionFile(file, { timeline: true })
}

module.exports = { listSubagents, readSubagent, subagentsDirFor }
