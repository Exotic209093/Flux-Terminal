const fs = require('fs')
const path = require('path')
const os = require('os')

// Slash commands for composer autocomplete: curated builtins + custom command
// files (~/.claude/commands and <project>/.claude/commands, top-level *.md).

// [name, description, interactive] — interactive:true = only does something in a
// live interactive session (a no-op when sent via `claude -p`); interactive:false
// = works when sent as a chat message. The composer marks the interactive ones.
const BUILTINS = [
  ['/add-dir', 'Add a working directory to the session', true],
  ['/agents', 'Manage agent configurations', true],
  ['/bashes', 'List & manage background shells', true],
  ['/clear', 'Clear conversation history', true],
  ['/compact', 'Compact the conversation, keeping a summary', false],
  ['/config', 'Open the config panel', true],
  ['/context', 'Visualize current context usage', true],
  ['/cost', 'Show total cost of this session', true],
  ['/doctor', 'Check the health of your Claude Code install', true],
  ['/effort', 'Set the thinking/effort level', true],
  ['/exit', 'Exit the session', true],
  ['/export', 'Export the conversation', true],
  ['/fast', 'Toggle fast mode', true],
  ['/feedback', 'Send feedback to Anthropic', true],
  ['/goal', 'Set the goal for the current run', true],
  ['/help', 'Show help and available commands', true],
  ['/hooks', 'Manage hooks', true],
  ['/init', 'Generate a CLAUDE.md for this project', true],
  ['/install-github-app', 'Install the GitHub app', true],
  ['/login', 'Log in to your account', true],
  ['/logout', 'Log out of your account', true],
  ['/mcp', 'Manage MCP servers', true],
  ['/memory', 'Edit Claude memory files', true],
  ['/model', 'Switch model (use the topbar model picker)', true],
  ['/permissions', 'Manage tool permissions', true],
  ['/pr-comments', 'Get comments from a GitHub pull request', false],
  ['/privacy-settings', 'Open privacy settings', true],
  ['/release-notes', 'Show release notes', true],
  ['/remote-control', 'Toggle remote control (use the topbar toggle)', true],
  ['/resume', 'Resume a past conversation', true],
  ['/review', 'Review a pull request', false],
  ['/rewind', 'Rewind the conversation to an earlier point', true],
  ['/security-review', 'Review pending changes for vulnerabilities', false],
  ['/status', 'Show Claude Code status', true],
  ['/statusline', 'Configure the status line', true],
  ['/terminal-setup', 'Configure terminal key bindings', true],
  ['/todos', 'View and manage the todo list', true],
  ['/upgrade', 'Upgrade your Claude plan', true],
  ['/usage', 'Show plan usage limits (see the topbar gauges)', true],
  ['/vim', 'Toggle vim editing mode', true]
].map(([name, description, interactive]) => ({ name, description, source: 'builtin', interactive }))

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
    out.push({ name: '/' + e.name.slice(0, -3), description, source, interactive: false })
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
