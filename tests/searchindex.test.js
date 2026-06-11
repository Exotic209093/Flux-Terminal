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
  assert.deepStrictEqual(parseQuery('role:assistant').filters, { role: 'text' }) // alias for the stored kind
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

// ---- SearchIndex (in-memory DB, scripted world, manual tick draining) ----------
const { SearchIndex } = require('../src/main/searchindex')
const { DatabaseSync } = require('node:sqlite')

function searchWorld() {
  const world = {
    files: new Map(), // file -> { meta, lines, tailsMade: [] }
    ticks: [] // captured enqueueTick callbacks — tests drain manually
  }
  world.addFile = (name, lines, mtimeMs) => {
    const file = 'P:\\proj\\' + name + '.jsonl'
    world.files.set(file, {
      meta: { sessionId: name, file, projectDir: 'proj', projectApprox: 'P:\\proj', mtimeMs, size: lines.join('').length },
      lines: lines.slice(),
      tailsMade: []
    })
    return file
  }
  world.append = (file, lines, mtimeMs) => {
    const f = world.files.get(file)
    f.lines.push(...lines)
    f.meta.mtimeMs = mtimeMs
    f.meta.size = f.lines.join('').length
  }
  world.drain = () => {
    while (world.ticks.length) world.ticks.shift()()
  }
  return world
}

function lineFor(text, role = 'user') {
  if (role === 'user') return { type: 'user', message: { content: text }, timestamp: '2026-06-11T10:00:00Z' }
  return {
    type: 'assistant',
    timestamp: '2026-06-11T10:00:05Z',
    message: { id: 'm' + Math.abs(hash(text)), model: 'claude-test', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text }] }
  }
}
function hash(s) {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0
  return h
}

function searchIndexFor(world, opts = {}) {
  const db = opts.db || new DatabaseSync(':memory:')
  const progress = []
  const si = new SearchIndex({
    openDb: opts.openDb || (() => db),
    dbPath: null,
    listFiles: () => [...world.files.values()].map((f) => ({ ...f.meta })),
    makeTail: (file, startOffset) => {
      const f = world.files.get(file)
      if (f) f.tailsMade.push(startOffset)
      // lines consumed by index, not bytes: offset = number of lines consumed
      let consumed = startOffset
      return {
        get offset() {
          return consumed
        },
        readDelta() {
          const fw = world.files.get(file)
          if (!fw) throw new Error('ENOENT ' + file)
          if (fw.lines.length < consumed) {
            consumed = 0
            return { reset: true, objects: [], parseErrors: 0, size: fw.meta.size, mtimeMs: fw.meta.mtimeMs }
          }
          const objects = fw.lines.slice(consumed)
          consumed = fw.lines.length
          return { reset: false, objects: objects.slice(), parseErrors: 0, size: fw.meta.size, mtimeMs: fw.meta.mtimeMs }
        }
      }
    },
    enqueueTick: (fn) => world.ticks.push(fn),
    onProgress: (p) => progress.push(p)
  })
  return { si, db, progress }
}

test('reconcile indexes every file once and FTS queries hit with the legacy DTO', () => {
  const world = searchWorld()
  world.addFile('s1', [lineFor('the quick brown fox'), lineFor('jumped over', 'assistant')], 500)
  world.addFile('s2', [lineFor('nothing relevant here')], 400)
  const { si } = searchIndexFor(world)
  si.start()
  world.drain()

  const hits = si.query('quick fox')
  assert.strictEqual(hits.length, 1)
  const h = hits[0]
  assert.strictEqual(h.sessionId, 's1')
  assert.strictEqual(h.msgIdx, 0)
  assert.strictEqual(h.role, 'user')
  assert.ok(typeof h.snippet === 'string' && h.snippet.includes('quick'))
  assert.strictEqual(h.snippet.slice(h.matchStart, h.matchEnd).toLowerCase(), 'quick')
  assert.deepStrictEqual(Object.keys(h).sort(), ['file', 'matchEnd', 'matchStart', 'msgIdx', 'project', 'role', 'sessionId', 'snippet', 'title', 'ts'])
  assert.strictEqual(h.file, 'P:\\proj\\s1.jsonl') // hits open even when the session is outside the renderer's store window
})

test('incremental: an appended delta indexes from the persisted offset with correct msgIdx', () => {
  const world = searchWorld()
  const file = world.addFile('s1', [lineFor('first prompt')], 500)
  const { si } = searchIndexFor(world)
  si.start()
  world.drain()
  assert.deepStrictEqual(world.files.get(file).tailsMade, [0])

  world.append(file, [lineFor('zebra cadenza', 'assistant')], 700)
  si.enqueue(file)
  world.drain()
  assert.deepStrictEqual(world.files.get(file).tailsMade, [0, 1]) // resumed at offset 1, not 0
  const hits = si.query('zebra')
  assert.strictEqual(hits.length, 1)
  assert.strictEqual(hits[0].msgIdx, 1)
})

test('restart resumes from the DB-persisted offset (no re-index)', () => {
  const world = searchWorld()
  const db = new DatabaseSync(':memory:')
  const file = world.addFile('s1', [lineFor('alpha')], 500)
  const a = searchIndexFor(world, { db })
  a.si.start()
  world.drain()

  world.append(file, [lineFor('bravo', 'assistant')], 700)
  const b = searchIndexFor(world, { db }) // "restart": same DB, fresh instance
  b.si.start()
  world.drain()
  assert.deepStrictEqual(world.files.get(file).tailsMade, [0, 1])
  assert.strictEqual(b.si.query('alpha').length, 1) // old rows survived
  assert.strictEqual(b.si.query('bravo').length, 1)
})

test('a reset (truncated file) purges and re-indexes; a deleted file purges', () => {
  const world = searchWorld()
  // two lines so the 1-line replacement is a genuine shrink (the fake tail
  // detects reset by line count: lines.length < consumed)
  const file = world.addFile('s1', [lineFor('old content here'), lineFor('second old line', 'assistant')], 500)
  const { si } = searchIndexFor(world)
  si.start()
  world.drain()
  assert.strictEqual(si.query('old').length, 2)

  world.files.get(file).lines = [lineFor('replacement text')]
  world.files.get(file).meta.mtimeMs = 900
  si.enqueue(file)
  world.drain()
  assert.strictEqual(si.query('old').length, 0)
  assert.strictEqual(si.query('replacement').length, 1)

  world.files.delete(file)
  si.remove(file)
  assert.strictEqual(si.query('replacement').length, 0)
})

test('operator queries filter and operator-only queries work without terms', () => {
  const world = searchWorld()
  world.addFile('s1', [
    lineFor('deploy the flow'),
    { type: 'assistant', timestamp: '2026-06-11T10:00:05Z', message: { id: 'mt', model: 'claude-test', usage: {}, content: [{ type: 'tool_use', name: 'Bash', input: { command: 'sf deploy' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'deploy FAILED hard' }] } }
  ], 500)
  const { si } = searchIndexFor(world)
  si.start()
  world.drain()

  assert.strictEqual(si.query('deploy').length, 3)
  assert.strictEqual(si.query('deploy role:user').length, 1)
  assert.strictEqual(si.query('deploy tool:bash').length, 1) // tool match is case-insensitive
  const errOnly = si.query('error:true')
  assert.strictEqual(errOnly.length, 1)
  assert.strictEqual(errOnly[0].role, 'tool_result')
  assert.strictEqual(si.query('deploy file:s1').length, 3)
  assert.strictEqual(si.query('deploy file:nope').length, 0)
})

test('openDb that throws once recovers; twice leaves the index unavailable with empty queries', () => {
  const world = searchWorld()
  world.addFile('s1', [lineFor('hello')], 500)
  let calls = 0
  const good = new DatabaseSync(':memory:')
  const flaky = searchIndexFor(world, {
    openDb: () => {
      calls++
      if (calls === 1) throw new Error('corrupt')
      return good
    }
  })
  flaky.si.start()
  world.drain()
  assert.strictEqual(flaky.si.available, true)
  assert.strictEqual(flaky.si.query('hello').length, 1)

  const dead = searchIndexFor(world, { openDb: () => { throw new Error('no sqlite') } })
  dead.si.start()
  assert.strictEqual(dead.si.available, false)
  assert.deepStrictEqual(dead.si.query('hello'), [])
})

test('a genuinely corrupt DB file on disk is deleted and rebuilt (default openDb, Windows handle-close path)', () => {
  const fsReal = require('fs')
  const os = require('os')
  const path = require('path')
  const dir = fsReal.mkdtempSync(path.join(os.tmpdir(), 'flux-fts-corrupt-'))
  const dbPath = path.join(dir, 'search-index.db')
  fsReal.writeFileSync(dbPath, 'this is not a sqlite database, not even close')
  const world = searchWorld()
  world.addFile('s1', [lineFor('phoenix from ashes')], 500)
  const si = new SearchIndex({
    dbPath, // default openDb — the real node:sqlite path
    listFiles: () => [...world.files.values()].map((f) => ({ ...f.meta })),
    makeTail: (file, startOffset) => {
      let consumed = startOffset
      return {
        get offset() { return consumed },
        readDelta() {
          const fw = world.files.get(file)
          const objects = fw.lines.slice(consumed)
          consumed = fw.lines.length
          return { reset: false, objects: objects.slice(), parseErrors: 0, size: fw.meta.size, mtimeMs: fw.meta.mtimeMs }
        }
      }
    },
    enqueueTick: (fn) => world.ticks.push(fn),
    onProgress: () => {}
  })
  si.start()
  world.drain()
  assert.strictEqual(si.available, true)
  assert.strictEqual(si.query('phoenix').length, 1)
  si.dispose()
})

test('progress fires during a multi-file build', () => {
  const world = searchWorld()
  for (let i = 0; i < 6; i++) world.addFile('s' + i, [lineFor('content ' + i)], 100 + i)
  const { si, progress } = searchIndexFor(world)
  si.start()
  world.drain()
  assert.ok(progress.length >= 6)
  assert.deepStrictEqual(progress[progress.length - 1], { done: 6, total: 6 })
})
