// tests/searchindex.test.js
const test = require('node:test')
const assert = require('node:assert')
const { parseQuery, ftsMatchFor, entriesFromItems, snippetToOffsets, MARK_L, MARK_R } = require('../src/main/searchindex')

// ---- parseQuery ---------------------------------------------------------------

test('parseQuery splits operators from terms', () => {
  const r = parseQuery('null__NotFound tool:Bash role:tool_result project:pgw file:flow error:true deploy')
  assert.deepStrictEqual(r.terms, ['null__NotFound', 'deploy'])
  assert.deepStrictEqual(r.filters, { tool: 'Bash', role: 'tool_result', project: 'pgw', file: 'flow', isError: true })
})

test('parseQuery edge shapes', () => {
  assert.deepStrictEqual(parseQuery(''), { terms: [], filters: {} })
  assert.deepStrictEqual(parseQuery('   '), { terms: [], filters: {} })
  assert.deepStrictEqual(parseQuery('tool:'), { terms: ['tool:'], filters: {} }) // empty value = plain term
  assert.deepStrictEqual(parseQuery('error:false').filters, { isError: false })
  assert.deepStrictEqual(parseQuery('session:abc-123').filters, { sessionId: 'abc-123' })
})

test('ftsMatchFor quotes terms (FTS syntax injection dies) and prefix-stars them', () => {
  assert.strictEqual(ftsMatchFor(['hello', 'wor"ld']), '"hello"* "wor""ld"*')
  assert.strictEqual(ftsMatchFor(['NEAR(']), '"NEAR("*') // operators neutralized by quoting
})

// ---- entriesFromItems -----------------------------------------------------------

test('entriesFromItems mirrors the legacy extraction rules with timeline-aligned indices', () => {
  const items = [
    { kind: 'user', ts: 't0', text: 'find the bug' },
    { kind: 'image', ts: 't1', data: 'AAAA', mediaType: 'image/png' }, // skipped, but still counts an index
    { kind: 'tool_use', ts: 't2', toolName: 'Bash', toolInput: 'ls -la' },
    { kind: 'tool_result', ts: 't3', isError: true, text: 'boom' },
    { kind: 'text', ts: 't4', text: '   ' } // whitespace only — skipped
  ]
  const entries = entriesFromItems(items, 10)
  assert.deepStrictEqual(entries.map((e) => e.msgIdx), [10, 12, 13])
  assert.strictEqual(entries[0].role, 'user')
  assert.strictEqual(entries[1].text, 'Bash ls -la')
  assert.strictEqual(entries[1].tool, 'Bash')
  assert.strictEqual(entries[2].isError, 1)
  assert.strictEqual(entries[0].isError, 0)
})

test('entriesFromItems caps entry text at 2048 chars', () => {
  const entries = entriesFromItems([{ kind: 'text', ts: null, text: 'x'.repeat(5000) }], 0)
  assert.strictEqual(entries[0].text.length, 2049) // 2048 + ellipsis
})

// ---- snippetToOffsets -----------------------------------------------------------

test('snippetToOffsets maps the first marked region and strips all markers', () => {
  const marked = 'before ' + MARK_L + 'match' + MARK_R + ' middle ' + MARK_L + 'again' + MARK_R
  const r = snippetToOffsets(marked)
  assert.strictEqual(r.snippet, 'before match middle again')
  assert.strictEqual(r.snippet.slice(r.matchStart, r.matchEnd), 'match')
})

test('snippetToOffsets tolerates no markers', () => {
  const r = snippetToOffsets('plain text')
  assert.deepStrictEqual(r, { snippet: 'plain text', matchStart: 0, matchEnd: 0 })
})
