const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { listCommands, frontmatterDescription } = require('../src/main/commands')

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flux-cmds-'))
}

test('frontmatterDescription extracts description, tolerates absence', () => {
  assert.strictEqual(
    frontmatterDescription('---\ndescription: Review a PR\n---\nbody'),
    'Review a PR'
  )
  assert.strictEqual(frontmatterDescription('---\ndescription: "Quoted"\n---\n'), 'Quoted')
  assert.strictEqual(frontmatterDescription('no frontmatter here'), '')
  assert.strictEqual(frontmatterDescription('---\nother: x\n---\n'), '')
})

test('listCommands includes builtins', () => {
  const cmds = listCommands(null, { userDir: path.join(tmpdir(), 'none') })
  const usage = cmds.find((c) => c.name === '/usage')
  assert.ok(usage)
  assert.strictEqual(usage.source, 'builtin')
})

test('listCommands merges user + project commands with precedence project > user > builtin', () => {
  const userDir = tmpdir()
  const projRoot = tmpdir()
  const projDir = path.join(projRoot, '.claude', 'commands')
  fs.mkdirSync(projDir, { recursive: true })

  fs.writeFileSync(path.join(userDir, 'deploy.md'), '---\ndescription: User deploy\n---\nDo it')
  fs.writeFileSync(path.join(userDir, 'review.md'), 'overrides builtin /review')
  fs.writeFileSync(path.join(projDir, 'deploy.md'), '---\ndescription: Project deploy\n---\nDo it here')
  fs.writeFileSync(path.join(projDir, 'notes.txt'), 'ignored — not .md')

  const cmds = listCommands(projRoot, { userDir })
  const deploy = cmds.find((c) => c.name === '/deploy')
  assert.strictEqual(deploy.source, 'project')
  assert.strictEqual(deploy.description, 'Project deploy')
  const review = cmds.find((c) => c.name === '/review')
  assert.strictEqual(review.source, 'user')
  assert.ok(!cmds.find((c) => c.name === '/notes'))
  // sorted by name
  const names = cmds.map((c) => c.name)
  assert.deepStrictEqual(names, [...names].sort())
})

test('listCommands tolerates missing dirs', () => {
  const cmds = listCommands('Z:\\does\\not\\exist', { userDir: 'Z:\\nope' })
  assert.ok(cmds.length > 0) // builtins still present
})

test('every command carries a boolean interactive flag', () => {
  const cmds = listCommands(null, { userDir: path.join(tmpdir(), 'none') })
  for (const c of cmds) assert.strictEqual(typeof c.interactive, 'boolean', c.name + ' missing interactive')
})

test('the full builtin set is present and richer than the old short list', () => {
  const cmds = listCommands(null, { userDir: path.join(tmpdir(), 'none') })
  const names = cmds.map((c) => c.name)
  for (const expected of ['/agents', '/hooks', '/login', '/rewind', '/security-review', '/vim']) {
    assert.ok(names.includes(expected), 'missing builtin ' + expected)
  }
  assert.ok(cmds.length >= 30, 'expected the full set, got ' + cmds.length)
})

test('interactive-only builtins are flagged; prompt-driven ones are not', () => {
  const cmds = listCommands(null, { userDir: path.join(tmpdir(), 'none') })
  const byName = Object.fromEntries(cmds.map((c) => [c.name, c]))
  assert.strictEqual(byName['/clear'].interactive, true)
  assert.strictEqual(byName['/model'].interactive, true)
  assert.strictEqual(byName['/compact'].interactive, false)
  assert.strictEqual(byName['/security-review'].interactive, false)
  assert.strictEqual(byName['/pr-comments'].interactive, false)
  assert.strictEqual(byName['/review'].interactive, false)
})

test('custom commands are interactive:false', () => {
  const userDir = tmpdir()
  fs.writeFileSync(path.join(userDir, 'deploy.md'), '---\ndescription: Ship it\n---\n')
  const cmds = listCommands(null, { userDir })
  const deploy = cmds.find((c) => c.name === '/deploy')
  assert.strictEqual(deploy.interactive, false)
})
