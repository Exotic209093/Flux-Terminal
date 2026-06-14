const { test, describe, before } = require('node:test')
const assert = require('node:assert')

describe('palette', () => {
  let buildCommands, filterCommands, STATIC_ACTIONS
  before(async () => {
    const mod = await import('../src/renderer/src/lib/palette.js')
    ;({ buildCommands, filterCommands, STATIC_ACTIONS } = mod)
  })

  test('buildCommands merges actions, sessions, prompts', () => {
    const cmds = buildCommands({
      sessions: [{ sessionId: 's1', title: 'Fix the parser', cwd: '/p', project: 'flux' }],
      prompts: [{ name: 'standup', body: 'write my standup' }]
    })
    assert.strictEqual(cmds.length, STATIC_ACTIONS.length + 2)
    assert.ok(cmds.find((c) => c.kind === 'session' && c.sessionId === 's1'))
    assert.ok(cmds.find((c) => c.kind === 'prompt' && c.body === 'write my standup'))
  })

  test('filterCommands fuzzy-filters by label and caps results', () => {
    const cmds = buildCommands({ sessions: [{ sessionId: 's', title: 'Parser work', cwd: '/p' }] })
    const out = filterCommands('parser', cmds)
    assert.ok(out.some((c) => c.label === 'Parser work'))
    assert.ok(out.length <= 30)
  })

  test('empty query returns the full list (capped)', () => {
    const cmds = buildCommands({})
    const out = filterCommands('', cmds)
    assert.strictEqual(out.length, Math.min(30, cmds.length))
  })
})
