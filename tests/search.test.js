const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

// ---- helpers ----------------------------------------------------------------

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flux-search-'))
}

/** Write a fake session JSONL and return its path + stat. */
function writeSession(dir, name, lines) {
  const p = path.join(dir, name)
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return p
}

/** Build a minimal injected-fs facade over a real tmpdir. */
function makeFakeFs(dir) {
  return {
    existsSync: (p) => fs.existsSync(p),
    statSync: (p) => fs.statSync(p),
    readFileSync: (p, enc) => fs.readFileSync(p, enc),
    mkdirSync: (p, opts) => fs.mkdirSync(p, opts),
    writeFileSync: (p, data) => fs.writeFileSync(p, data),
    readdirSync: (p, opts) => fs.readdirSync(p, opts),
    cacheDir: dir
  }
}

// Large base64-looking string (~3KB) to test stripping
const FAKE_B64 = 'A'.repeat(3000)

// ---- import the module under test -----------------------------------------

const {
  extractEntries,
  buildCache,
  loadOrBuildCache,
  search
} = require('../src/main/search')

// ============================================================================
// 1. Extraction
// ============================================================================

test('extractEntries: stable idx matches timeline position', () => {
  const dir = tmpdir()
  const file = writeSession(dir, 's.jsonl', [
    { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'hello world' } },
    {
      type: 'assistant',
      timestamp: '2026-01-01T00:00:01Z',
      message: { content: [{ type: 'text', text: 'response here' }] }
    }
  ])
  const entries = extractEntries(file)
  assert.ok(Array.isArray(entries))
  assert.ok(entries.length >= 2)
  for (let i = 0; i < entries.length; i++) {
    assert.strictEqual(entries[i].idx, i)
  }
})

test('extractEntries: each entry has required fields', () => {
  const dir = tmpdir()
  const file = writeSession(dir, 's.jsonl', [
    { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'hello' } }
  ])
  const entries = extractEntries(file)
  assert.ok(entries.length > 0)
  const e = entries[0]
  assert.strictEqual(typeof e.idx, 'number')
  assert.ok('role' in e)
  assert.ok('ts' in e)
  assert.ok('text' in e)
})

test('extractEntries: strips base64 image data — no long base64 strings in text', () => {
  const dir = tmpdir()
  const file = writeSession(dir, 's.jsonl', [
    {
      type: 'user',
      timestamp: '2026-01-01T00:00:00Z',
      message: {
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: FAKE_B64 } },
          { type: 'text', text: 'what is this?' }
        ]
      }
    }
  ])
  const entries = extractEntries(file)
  for (const e of entries) {
    assert.ok(!e.text.includes(FAKE_B64.slice(0, 50)), 'base64 data leaked into text')
    assert.ok(e.text.length < 2200, 'entry text too long: ' + e.text.length)
  }
})

test('extractEntries: caps each entry text at ~2KB', () => {
  const dir = tmpdir()
  const longText = 'x'.repeat(10000)
  const file = writeSession(dir, 's.jsonl', [
    {
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00Z',
      message: { content: [{ type: 'text', text: longText }] }
    }
  ])
  const entries = extractEntries(file)
  assert.ok(entries.length > 0)
  // 2KB cap = 2048 chars, allow a bit of slack for ellipsis
  for (const e of entries) {
    assert.ok(e.text.length <= 2200, 'entry text exceeds cap: ' + e.text.length)
  }
})

test('extractEntries: includes tool names in text', () => {
  const dir = tmpdir()
  const file = writeSession(dir, 's.jsonl', [
    {
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00Z',
      message: {
        content: [
          { type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'ls' } }
        ]
      }
    }
  ])
  const entries = extractEntries(file)
  const hasTool = entries.some((e) => e.text.includes('Bash'))
  assert.ok(hasTool, 'tool name not found in extracted entries')
})

test('extractEntries: returns empty array for missing file', () => {
  const entries = extractEntries('/no/such/file.jsonl')
  assert.deepStrictEqual(entries, [])
})

// ============================================================================
// 2. Cache validity
// ============================================================================

test('loadOrBuildCache: builds cache on first call (no existing cache)', () => {
  const sourceDir = tmpdir()
  const cacheDir = tmpdir()
  const fakeFs = makeFakeFs(cacheDir)

  const sessionFile = writeSession(sourceDir, 's.jsonl', [
    { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'test content' } }
  ])

  const stat = fs.statSync(sessionFile)
  const result = loadOrBuildCache('sess1', sessionFile, stat, fakeFs)

  assert.ok(result && typeof result === 'object')
  assert.ok(Array.isArray(result.entries))
  assert.strictEqual(result.mtimeMs, stat.mtimeMs)
  assert.strictEqual(result.size, stat.size)
})

test('loadOrBuildCache: reuses cache when mtime+size match', () => {
  const sourceDir = tmpdir()
  const cacheDir = tmpdir()
  const fakeFs = makeFakeFs(cacheDir)

  const sessionFile = writeSession(sourceDir, 's.jsonl', [
    { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'initial content' } }
  ])
  const stat = fs.statSync(sessionFile)

  // Build the cache once
  const first = loadOrBuildCache('sess1', sessionFile, stat, fakeFs)
  assert.ok(first.entries.length > 0)

  // Now modify the source file but re-use the original stat (simulating a
  // stable file — the cache key matches so it should return the cached data)
  const second = loadOrBuildCache('sess1', sessionFile, stat, fakeFs)
  assert.deepStrictEqual(second.entries, first.entries)
})

test('loadOrBuildCache: rebuilds cache when mtime changes', () => {
  const sourceDir = tmpdir()
  const cacheDir = tmpdir()

  const sessionFile = writeSession(sourceDir, 's.jsonl', [
    { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'original' } }
  ])
  const stat1 = fs.statSync(sessionFile)

  // Build with stat1
  const fakeFs1 = makeFakeFs(cacheDir)
  const first = loadOrBuildCache('sess1', sessionFile, stat1, fakeFs1)
  assert.ok(first.entries.some((e) => e.text.includes('original')))

  // Rewrite the file with different content + a fake mtime to simulate change
  fs.writeFileSync(sessionFile,
    JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'updated content' } }) + '\n'
  )
  const stat2 = fs.statSync(sessionFile)
  // stat2 must differ from stat1 in at least mtime or size; if the write was
  // fast enough mtime might be identical in low-resolution FSes, so force it:
  const fakeStat2 = { mtimeMs: stat1.mtimeMs + 1, size: stat2.size }

  const fakeFs2 = makeFakeFs(cacheDir)
  const second = loadOrBuildCache('sess1', sessionFile, fakeStat2, fakeFs2)
  assert.ok(second.entries.some((e) => e.text.includes('updated content')))
})

test('loadOrBuildCache: rebuilds cache when size changes', () => {
  const sourceDir = tmpdir()
  const cacheDir = tmpdir()

  const sessionFile = writeSession(sourceDir, 's.jsonl', [
    { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'short' } }
  ])
  const stat1 = fs.statSync(sessionFile)

  const fakeFs1 = makeFakeFs(cacheDir)
  loadOrBuildCache('sess1', sessionFile, stat1, fakeFs1)

  // Force a different size
  fs.writeFileSync(sessionFile,
    JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'much longer content here for real' } }) + '\n'
  )
  const stat2 = fs.statSync(sessionFile)
  const fakeStat2 = { mtimeMs: stat1.mtimeMs, size: stat1.size + 100 }

  const fakeFs2 = makeFakeFs(cacheDir)
  const second = loadOrBuildCache('sess1', sessionFile, fakeStat2, fakeFs2)
  // A rebuild happened (we don't care what entries, just that it didn't crash)
  assert.ok(Array.isArray(second.entries))
})

// ============================================================================
// 3. Search semantics
// ============================================================================

function makeSearchFixture() {
  const sourceDir = tmpdir()
  const cacheDir = tmpdir()
  const fakeFs = makeFakeFs(cacheDir)

  // Session A — newer (higher mtime via sort key we control)
  const fileA = writeSession(sourceDir, 'sessA.jsonl', [
    { type: 'user', timestamp: '2026-06-01T10:00:00Z', message: { content: 'ConPTY bug fix needed here' } },
    {
      type: 'assistant', timestamp: '2026-06-01T10:00:01Z',
      message: { content: [{ type: 'text', text: 'I will fix the ConPTY issue for you' }] }
    }
  ])

  // Session B — older
  const fileB = writeSession(sourceDir, 'sessB.jsonl', [
    { type: 'user', timestamp: '2026-05-01T10:00:00Z', message: { content: 'unrelated terminal content' } },
    {
      type: 'assistant', timestamp: '2026-05-01T10:00:01Z',
      message: { content: [{ type: 'text', text: 'Here is the answer to your question' } ]}
    }
  ])

  const statA = fs.statSync(fileA)
  const statB = fs.statSync(fileB)

  // Newer session has a higher mtime
  const sessions = [
    { sessionId: 'sessA', file: fileA, projectDir: 'proj', projectApprox: 'C:/proj', size: statA.size, mtimeMs: statA.mtimeMs + 1000 },
    { sessionId: 'sessB', file: fileB, projectDir: 'proj', projectApprox: 'C:/proj', size: statB.size, mtimeMs: statB.mtimeMs }
  ]

  return { sessions, fakeFs, sourceDir, cacheDir }
}

test('search: finds hits case-insensitively', () => {
  const { sessions, fakeFs } = makeSearchFixture()
  const hits = search('CONPTY', sessions, { fakeFs })
  assert.ok(hits.length > 0, 'expected at least one hit')
  for (const h of hits) {
    assert.ok(h.snippet.toLowerCase().includes('conpty'), 'snippet missing match')
  }
})

test('search: multi-term AND — all terms must be present', () => {
  const { sessions, fakeFs } = makeSearchFixture()
  // 'ConPTY' appears in sessA but 'unrelated' only in sessB — no single doc has both
  const hits = search('conpty unrelated', sessions, { fakeFs })
  assert.strictEqual(hits.length, 0, 'AND of disjoint terms should yield no hits')
})

test('search: multi-term AND — both terms in same entry matches', () => {
  const { sessions, fakeFs } = makeSearchFixture()
  // sessA user message has both 'ConPTY' and 'fix'
  const hits = search('conpty fix', sessions, { fakeFs })
  assert.ok(hits.length > 0, 'expected hits for co-occurring terms')
})

test('search: snippet is ±80 chars around the first match', () => {
  const { sessions, fakeFs } = makeSearchFixture()
  const hits = search('conpty', sessions, { fakeFs })
  assert.ok(hits.length > 0)
  for (const h of hits) {
    assert.strictEqual(typeof h.snippet, 'string')
    // snippet should be reasonably short
    assert.ok(h.snippet.length <= 200, 'snippet too long: ' + h.snippet.length)
  }
})

test('search: hit includes match offset fields', () => {
  const { sessions, fakeFs } = makeSearchFixture()
  const hits = search('conpty', sessions, { fakeFs })
  assert.ok(hits.length > 0)
  const h = hits[0]
  assert.strictEqual(typeof h.matchStart, 'number')
  assert.strictEqual(typeof h.matchEnd, 'number')
  assert.ok(h.matchEnd > h.matchStart)
  // The matched portion of snippet should contain the query term
  assert.ok(h.snippet.slice(h.matchStart, h.matchEnd).toLowerCase().includes('conpty'))
})

test('search: hit DTO has all expected fields', () => {
  const { sessions, fakeFs } = makeSearchFixture()
  const hits = search('conpty', sessions, { fakeFs })
  assert.ok(hits.length > 0)
  const h = hits[0]
  assert.strictEqual(typeof h.sessionId, 'string')
  assert.strictEqual(typeof h.project, 'string')
  assert.strictEqual(typeof h.msgIdx, 'number')
  assert.ok('role' in h)
  assert.ok('ts' in h)
  assert.strictEqual(typeof h.snippet, 'string')
})

test('search: respects N=200 cap', () => {
  const sourceDir = tmpdir()
  const cacheDir = tmpdir()
  const fakeFs = makeFakeFs(cacheDir)

  // Create many sessions, each with many hits
  const sessions = []
  for (let i = 0; i < 10; i++) {
    const lines = []
    for (let j = 0; j < 30; j++) {
      lines.push({
        type: 'user', timestamp: '2026-01-01T00:00:00Z',
        message: { content: 'needle content line ' + j }
      })
    }
    const file = writeSession(sourceDir, `sess${i}.jsonl`, lines)
    const stat = fs.statSync(file)
    sessions.push({ sessionId: 'sess' + i, file, projectDir: 'p', projectApprox: 'x', size: stat.size, mtimeMs: stat.mtimeMs })
  }

  const hits = search('needle', sessions, { fakeFs })
  assert.ok(hits.length <= 200, 'result cap exceeded: ' + hits.length)
})

test('search: results ordered newest-session first', () => {
  const sourceDir = tmpdir()
  const cacheDir = tmpdir()
  const fakeFs = makeFakeFs(cacheDir)

  const fileOld = writeSession(sourceDir, 'old.jsonl', [
    { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'alpha beta' } }
  ])
  const fileNew = writeSession(sourceDir, 'new.jsonl', [
    { type: 'user', timestamp: '2026-06-01T00:00:00Z', message: { content: 'alpha beta' } }
  ])

  const sessions = [
    { sessionId: 'old', file: fileOld, projectDir: 'p', projectApprox: 'x', size: 10, mtimeMs: 1000 },
    { sessionId: 'new', file: fileNew, projectDir: 'p', projectApprox: 'x', size: 10, mtimeMs: 9999 }
  ]

  const hits = search('alpha', sessions, { fakeFs })
  assert.ok(hits.length >= 2)
  // newest session hits should appear first
  const ids = hits.map((h) => h.sessionId)
  const newIdx = ids.indexOf('new')
  const oldIdx = ids.indexOf('old')
  assert.ok(newIdx < oldIdx, `expected 'new' before 'old', got indices ${newIdx} and ${oldIdx}`)
})

test('search: empty query returns no hits', () => {
  const { sessions, fakeFs } = makeSearchFixture()
  const hits = search('', sessions, { fakeFs })
  assert.deepStrictEqual(hits, [])
})

test('search: whitespace-only query returns no hits', () => {
  const { sessions, fakeFs } = makeSearchFixture()
  const hits = search('   ', sessions, { fakeFs })
  assert.deepStrictEqual(hits, [])
})

test('buildCache: returns object with entries, mtimeMs, size', () => {
  const sourceDir = tmpdir()
  const file = writeSession(sourceDir, 's.jsonl', [
    { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'test' } }
  ])
  const stat = fs.statSync(file)
  const cache = buildCache(file, stat)
  assert.ok(Array.isArray(cache.entries))
  assert.strictEqual(cache.mtimeMs, stat.mtimeMs)
  assert.strictEqual(cache.size, stat.size)
})
