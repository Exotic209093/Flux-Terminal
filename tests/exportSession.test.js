const { test, describe, before } = require('node:test')
const assert = require('node:assert')

describe('exportSession', () => {
  let toMarkdown
  before(async () => { ({ toMarkdown } = await import('../src/renderer/src/lib/exportSession.js')) })

  test('toMarkdown serialises a session timeline', () => {
    const md = toMarkdown({
      title: 'My session', cwd: '/p',
      timeline: [
        { kind: 'user', text: 'hello' },
        { kind: 'thinking', text: 'hmm' },
        { kind: 'text', text: 'hi there' },
        { kind: 'tool_use', toolName: 'Bash' },
        { kind: 'tool_result', text: 'output' }
      ]
    })
    assert.ok(md.startsWith('# My session'))
    assert.ok(md.includes('### You'))
    assert.ok(md.includes('hello'))
    assert.ok(md.includes('### Claude'))
    assert.ok(md.includes('> 💭 hmm'))
    assert.ok(md.includes('🔧 Bash'))
    assert.ok(md.includes('```'))
  })

  test('toMarkdown handles empty / missing input', () => {
    assert.strictEqual(typeof toMarkdown({}), 'string')
    assert.strictEqual(toMarkdown(null), '')
  })
})
