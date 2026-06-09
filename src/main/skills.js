const fs = require('fs')
const os = require('os')
const path = require('path')

// Discover Claude Code skills installed locally, plus starter skills bundled
// with Flux Terminal that the user can install with one click.
//
// Sources:
//   user   — ~/.claude/skills/<name>/SKILL.md
//   plugin — ~/.claude/plugins/**/skills/<name>/SKILL.md
//   bundled — <appRoot>/skills/<name>/SKILL.md  (shipped with the app)

function userSkillsDir() {
  return path.join(os.homedir(), '.claude', 'skills')
}
function pluginsDir() {
  return path.join(os.homedir(), '.claude', 'plugins')
}

/** Parse `name` and `description` from a SKILL.md YAML frontmatter block. */
function parseFrontmatter(file) {
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf-8')
  } catch {
    return null
  }
  const out = { name: null, description: null }
  const m = /^---\s*[\r\n]([\s\S]*?)[\r\n]---/.exec(text)
  const block = m ? m[1] : text.slice(0, 1500)
  for (const raw of block.split(/\r?\n/)) {
    // trim() strips a trailing \r the block regex can leave on the last line
    // (CRLF files), which would otherwise break the `(.+)$` value match.
    const line = raw.trim()
    const nm = /^name:\s*(.+)$/.exec(line)
    if (nm && !out.name) out.name = nm[1].trim().replace(/^["']|["']$/g, '')
    const dm = /^description:\s*(.+)$/.exec(line)
    if (dm && !out.description) out.description = dm[1].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

function skillFrom(dir, source, extra = {}) {
  const skillMd = path.join(dir, 'SKILL.md')
  if (!fs.existsSync(skillMd)) return null
  const fm = parseFrontmatter(skillMd) || {}
  return {
    name: fm.name || path.basename(dir),
    description: fm.description || '',
    dir,
    source,
    ...extra
  }
}

function scanDirOfSkills(baseDir, source) {
  const out = []
  let names = []
  try {
    names = fs.readdirSync(baseDir)
  } catch {
    return out
  }
  // Don't filter on dirent type: ~/.claude/skills entries are often junctions/
  // symlinks (isDirectory() is false for those). Gate on SKILL.md existing,
  // which follows links.
  for (const name of names) {
    const s = skillFrom(path.join(baseDir, name), source)
    if (s) out.push(s)
  }
  return out
}

/** Bounded recursive walk collecting SKILL.md files (for the nested plugins tree). */
function findPluginSkills() {
  const out = []
  const root = pluginsDir()
  const walk = (dir, depth) => {
    if (depth > 8) return
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full, depth + 1)
      } else if (e.name === 'SKILL.md') {
        // plugin name = the marketplace/plugin folder a couple levels up, best-effort
        const parts = full.split(path.sep)
        const pluginIdx = parts.lastIndexOf('plugins')
        const plugin = pluginIdx >= 0 && parts[pluginIdx + 1] ? parts[pluginIdx + 1] : null
        const s = skillFrom(path.dirname(full), 'plugin', { plugin })
        if (s) out.push(s)
      }
    }
  }
  walk(root, 0)
  return out
}

function bundledSkillsDir(appPath) {
  return path.join(appPath, 'skills')
}

function listSkills(appPath) {
  const user = scanDirOfSkills(userSkillsDir(), 'user')
  const userNames = new Set(user.map((s) => s.name))
  const plugin = findPluginSkills()
  const bundled = scanDirOfSkills(bundledSkillsDir(appPath), 'bundled').map((s) => ({
    ...s,
    installed: userNames.has(s.name)
  }))
  return { user, plugin, bundled }
}

/** Install a bundled skill by copying its folder into ~/.claude/skills. */
function installBundledSkill(appPath, name) {
  const src = path.join(bundledSkillsDir(appPath), name)
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
    return { ok: false, error: 'bundled skill not found: ' + name }
  }
  const destRoot = userSkillsDir()
  const dest = path.join(destRoot, name)
  try {
    fs.mkdirSync(destRoot, { recursive: true })
    fs.cpSync(src, dest, { recursive: true })
    return { ok: true, dest }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

module.exports = { listSkills, installBundledSkill, userSkillsDir }
