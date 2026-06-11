const fs = require('fs')
const os = require('os')
const path = require('path')
const { parseSessionFile } = require('./parser')

// Discovery + listing of Claude Code sessions stored under ~/.claude/projects.
//
// Layout (observed):
//   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl          ← top-level sessions
//   ~/.claude/projects/<encoded-cwd>/<sessionId>/subagents/...  ← nested agent transcripts
//
// The <encoded-cwd> dir name replaces path separators/colon with '-', which is
// lossy — so we never trust it for display. The real cwd lives inside each
// session's events; we read it from there and fall back to a best-effort decode.

function projectsDir() {
  return path.join(os.homedir(), '.claude', 'projects')
}

/** Best-effort, clearly-approximate decode of an encoded project dir name. */
function approxDecodeProject(dirName) {
  // "C--Users-james" -> "C:\Users\james" (heuristic; real value comes from cwd)
  let s = dirName
  if (/^[a-zA-Z]--/.test(s)) {
    s = s[0] + ':' + s.slice(2)
  }
  return s.replace(/-/g, '\\')
}

/** List every top-level session file with cheap filesystem metadata (no parse). */
function listSessionFiles() {
  const base = projectsDir()
  let projectDirs = []
  try {
    projectDirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {
    return []
  }

  const out = []
  for (const dir of projectDirs) {
    const projectPath = path.join(base, dir.name)
    let entries = []
    try {
      entries = fs.readdirSync(projectPath, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
      const full = path.join(projectPath, e.name)
      let stat
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      out.push({
        sessionId: e.name.replace(/\.jsonl$/, ''),
        file: full,
        projectDir: dir.name,
        projectApprox: approxDecodeProject(dir.name),
        size: stat.size,
        mtimeMs: stat.mtimeMs
      })
    }
  }
  // Newest first.
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return out
}

/**
 * List sessions with a parsed summary each. `limit` caps how many of the most
 * recent files we actually parse (cheap stat sort happens first).
 */
function listSessions({ limit = 200 } = {}) {
  const files = listSessionFiles()
  const sliced = typeof limit === 'number' ? files.slice(0, limit) : files
  return sliced.map((meta) => {
    const parsed = parseSessionFile(meta.file)
    return {
      ...meta,
      cwd: parsed.cwd || meta.projectApprox,
      title: parsed.title || parsed.lastUserPrompt || '(untitled session)',
      gitBranch: parsed.gitBranch,
      models: parsed.models,
      version: parsed.version,
      counts: parsed.counts,
      usage: parsed.usage,
      tools: parsed.tools,
      firstTimestamp: parsed.firstTimestamp,
      lastTimestamp: parsed.lastTimestamp,
      parseErrors: parsed.parseErrors
    }
  })
}

/**
 * Find the full path to a session file by its id (`<sessionId>.jsonl`), searching
 * every project dir. Used to exactly track a `claude --session-id <uuid>` launch.
 * Returns the path or null (the file may not exist yet right after launch).
 */
function findSessionFileById(sessionId) {
  if (!sessionId) return null
  const base = projectsDir()
  const target = sessionId + '.jsonl'
  let projectDirs = []
  try {
    projectDirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {
    return null
  }
  for (const dir of projectDirs) {
    const candidate = path.join(base, dir.name, target)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/**
 * May the renderer ask main to read/watch this file? Transcript reads are
 * boundary-checked to .jsonl files under ~/.claude — session:read and
 * session:watch would otherwise read+return any absolute path over IPC.
 * Pure for tests: baseDir/platform injectable.
 */
function isSessionPathAllowed(file, { baseDir, platform = process.platform } = {}) {
  if (typeof file !== 'string' || !file.toLowerCase().endsWith('.jsonl')) return false
  // Use the platform-appropriate path module so posix tests work on Windows hosts.
  const p = platform === 'win32' ? path.win32 : path.posix
  const base = p.normalize(baseDir || p.join(os.homedir(), '.claude'))
  let resolved
  try {
    resolved = p.normalize(p.resolve(file))
  } catch {
    return false
  }
  const a = platform === 'win32' ? resolved.toLowerCase() : resolved
  const b = platform === 'win32' ? base.toLowerCase() : base
  return a.startsWith(b + p.sep)
}

module.exports = {
  projectsDir,
  listSessionFiles,
  listSessions,
  approxDecodeProject,
  findSessionFileById,
  isSessionPathAllowed
}
