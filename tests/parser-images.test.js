const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { parseSessionFile } = require('../src/main/parser')

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function writeSession(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-parse-'))
  const file = path.join(dir, 'session.jsonl')
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return file
}

function imgBlock(data = PNG_B64) {
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data } }
}

test('direct image block in a user message becomes an image timeline item', () => {
  const file = writeSession([
    {
      type: 'user',
      timestamp: '2026-06-09T10:00:00Z',
      message: { content: [imgBlock(), { type: 'text', text: 'what is this?' }] }
    }
  ])
  const s = parseSessionFile(file, { timeline: true })
  const img = s.timeline.find((t) => t.kind === 'image')
  assert.ok(img)
  assert.strictEqual(img.mediaType, 'image/png')
  assert.strictEqual(img.data, PNG_B64)
  assert.strictEqual(s.counts.image, 1)
})

test('image nested in tool_result content is extracted; text excludes base64', () => {
  const file = writeSession([
    {
      type: 'user',
      timestamp: '2026-06-09T10:00:01Z',
      message: {
        content: [
          {
            type: 'tool_result',
            content: [{ type: 'text', text: 'screenshot taken' }, imgBlock()]
          }
        ]
      }
    }
  ])
  const s = parseSessionFile(file, { timeline: true })
  const result = s.timeline.find((t) => t.kind === 'tool_result')
  assert.strictEqual(result.text, 'screenshot taken')
  assert.ok(!result.text.includes(PNG_B64.slice(0, 20)))
  const img = s.timeline.find((t) => t.kind === 'image')
  assert.ok(img)
  assert.strictEqual(img.data, PNG_B64)
})

test('oversized image becomes a truncated placeholder without data', () => {
  const huge = 'A'.repeat(2_000_001)
  const file = writeSession([
    { type: 'user', message: { content: [imgBlock(huge)] } }
  ])
  const s = parseSessionFile(file, { timeline: true })
  const img = s.timeline.find((t) => t.kind === 'image')
  assert.strictEqual(img.truncated, true)
  assert.strictEqual(img.data, undefined)
})

test('non-base64 image sources are ignored', () => {
  const file = writeSession([
    {
      type: 'user',
      message: { content: [{ type: 'image', source: { type: 'url', url: 'https://x/y.png' } }] }
    }
  ])
  const s = parseSessionFile(file, { timeline: true })
  assert.ok(!s.timeline.find((t) => t.kind === 'image'))
  assert.strictEqual(s.counts.image, 0)
})

test('string tool_result content still renders as before', () => {
  const file = writeSession([
    {
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'plain output' }] }
    }
  ])
  const s = parseSessionFile(file, { timeline: true })
  const result = s.timeline.find((t) => t.kind === 'tool_result')
  assert.strictEqual(result.text, 'plain output')
})
