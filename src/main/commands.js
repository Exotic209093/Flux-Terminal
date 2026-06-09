const fs = require('fs')
const path = require('path')
const os = require('os')

// Slash commands for composer autocomplete: curated builtins + custom command
// files (~/.claude/commands and <project>/.claude/commands, top-level *.md).

const BUILTINS = [
  ['/clear', 'Clear conversation history'],
  ['/compact', 'Compact conversation, keeping a summary'],
  ['/config', 'Open config panel'],
  ['/context', 'Visualize current context usage'],
  ['/cost', 'Show total cost of current session'],
  ['/doctor', 'Check health of your Claude Code install'],
  ['/help', 'Show help and available commands'],
  ['/init', 'Generate a CLAUDE.md for this project'],
  ['/memory', 'Edit Claude memory files'],
  ['/model', 'Switch model'],
  ['/permissions', 'Manage tool permissions'],
  ['/pr-comments', 'Get comments from a GitHub pull request'],
  ['/review', 'Review a pull request'],
  ['/status', 'Show Claude Code status'],
  ['/usage', 'Show plan usage limits']
].map(([name, description]) => ({ name, description, source: 'builtin' }))

/** Read "description:" from an optional YAML frontmatter block. */
function frontmatterDescription(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  if (!m) return ''
  const d = /^description:\s*(.+)$/m.exec(m[1])
  return d ? d[1].trim().replace(/^['"]|['"]$/g, '') : ''
}

/** Scan a commands dir for top-level *.md files. Missing dir → []. */
function scanCommandsDir(dir, source) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue
    let description = ''
    try {
      description = frontmatterDescription(fs.readFileSync(path.join(dir, e.name), 'utf-8'))
    } catch {
      /* unreadable file — list it without a description */
    }
    out.push({ name: '/' + e.name.slice(0, -3), description, source })
  }
  return out
}

/**
 * Merged command list for a session cwd. Precedence on a name clash:
 * project > user > builtin. Sorted by name.
 */
function listCommands(cwd, opts = {}) {
  const userDir = opts.userDir || path.join(os.homedir(), '.claude', 'commands')
  const projectDir = cwd ? path.join(cwd, '.claude', 'commands') : null
  const byName = new Map()
  for (const c of BUILTINS) byName.set(c.name, c)
  for (const c of scanCommandsDir(userDir, 'user')) byName.set(c.name, c)
  if (projectDir) for (const c of scanCommandsDir(projectDir, 'project')) byName.set(c.name, c)
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
}

module.exports = { listCommands, scanCommandsDir, frontmatterDescription, BUILTINS }
