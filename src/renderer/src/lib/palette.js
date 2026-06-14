import { fuzzyFilter } from './fuzzy.js'

const STATIC_ACTIONS = [
  { kind: 'action', label: 'New chat', action: 'new-chat' },
  { kind: 'action', label: 'Terminal', action: 'view:terminal' },
  { kind: 'action', label: 'Stats & achievements', action: 'view:stats' },
  { kind: 'action', label: 'Skills', action: 'view:skills' },
  { kind: 'action', label: 'Mission Control', action: 'view:mission' },
  { kind: 'action', label: 'Settings', action: 'view:settings' },
  { kind: 'action', label: 'Search sessions', action: 'open-search' },
  { kind: 'action', label: 'Launch tracked claude', action: 'launch-tracked' }
]

function buildCommands({ sessions = [], prompts = [] } = {}) {
  const cmds = STATIC_ACTIONS.slice()
  for (const s of sessions) {
    cmds.push({ kind: 'session', label: s.title || '(untitled session)', sub: s.project || s.cwd || '', sessionId: s.sessionId })
  }
  for (const p of prompts) {
    cmds.push({ kind: 'prompt', label: p.name, sub: (p.body || '').replace(/\s+/g, ' ').slice(0, 60), body: p.body })
  }
  return cmds
}

function filterCommands(query, commands, limit = 30) {
  return fuzzyFilter(query, commands, (c) => c.label + ' ' + (c.sub || '')).slice(0, limit)
}

export { STATIC_ACTIONS, buildCommands, filterCommands }
