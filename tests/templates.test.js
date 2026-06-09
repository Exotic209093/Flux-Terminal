const test = require('node:test')
const assert = require('node:assert')

// templates.js is a renderer-side ES module, but it must be pure functions
// testable under Node's CJS runner. We load it via a small wrapper since
// electron-vite doesn't pre-build renderer libs for tests. The module uses
// named exports; we require the CommonJS-compatible sibling.
const {
  parsePlaceholders,
  expandTemplate,
  nextPlaceholderRange
} = require('../src/main/templates')

// -------------------------------------------------------------------------

test('parsePlaceholders: extracts unique variable names in order', () => {
  const vars = parsePlaceholders('Hello {{name}}, you have {{count}} messages.')
  assert.deepStrictEqual(vars, ['name', 'count'])
})

test('parsePlaceholders: deduplicates repeated placeholders', () => {
  const vars = parsePlaceholders('{{x}} and {{x}} and {{y}}')
  assert.deepStrictEqual(vars, ['x', 'y'])
})

test('parsePlaceholders: returns [] for template with no placeholders', () => {
  assert.deepStrictEqual(parsePlaceholders('plain text'), [])
  assert.deepStrictEqual(parsePlaceholders(''), [])
})

test('parsePlaceholders: recognises {{cursor}} as a placeholder name', () => {
  const vars = parsePlaceholders('before {{cursor}} after')
  assert.deepStrictEqual(vars, ['cursor'])
})

test('parsePlaceholders: escaped {{ is not treated as a placeholder', () => {
  // {{{{ renders as a literal {{ — must NOT parse as a placeholder start
  // {{{{name}}}} means literal "{{name}}" (open escape + name + close escape)
  const vars = parsePlaceholders('{{{{name}}}}')
  assert.deepStrictEqual(vars, [])
})

test('expandTemplate: replaces all placeholders with their values', () => {
  const result = expandTemplate('Hi {{name}}, you owe {{amount}}.', { name: 'Alice', amount: '$5' })
  assert.strictEqual(result, 'Hi Alice, you owe $5.')
})

test('expandTemplate: leaves unknown placeholders as-is', () => {
  const result = expandTemplate('Hello {{name}} {{unknown}}', { name: 'Bob' })
  assert.strictEqual(result, 'Hello Bob {{unknown}}')
})

test('expandTemplate: replaces {{cursor}} with empty string', () => {
  const result = expandTemplate('before{{cursor}}after', { cursor: '' })
  assert.strictEqual(result, 'beforeafter')
})

test('expandTemplate: {{{{name}}}} becomes {{name}} in output (escaped)', () => {
  // {{{{ = literal "{{", }}}} = literal "}}" — so {{{{name}}}} → "{{name}}"
  const result = expandTemplate('literal {{{{name}}}}', {})
  assert.strictEqual(result, 'literal {{name}}')
})

test('expandTemplate: replaces repeated occurrences of the same placeholder', () => {
  const result = expandTemplate('{{a}} and {{a}}', { a: 'X' })
  assert.strictEqual(result, 'X and X')
})

// -------------------------------------------------------------------------
// nextPlaceholderRange(text, cursorPos)
// Returns { start, end } of the next unreplaced {{...}} placeholder after
// cursorPos, or null if none remain.
// -------------------------------------------------------------------------

test('nextPlaceholderRange: finds first placeholder from start', () => {
  const text = 'Hello {{name}}, age {{age}}'
  const range = nextPlaceholderRange(text, 0)
  assert.deepStrictEqual(range, { start: 6, end: 14 })
})

test('nextPlaceholderRange: skips placeholder that cursorPos is already past', () => {
  const text = 'Hello {{name}}, age {{age}}'
  // {{name}} ends at index 14, {{age}} starts at 20 and ends at 27
  const range = nextPlaceholderRange(text, 14) // past {{name}}
  assert.deepStrictEqual(range, { start: 20, end: 27 })
})

test('nextPlaceholderRange: returns null when no more placeholders', () => {
  const text = 'Hello world'
  assert.strictEqual(nextPlaceholderRange(text, 0), null)
})

test('nextPlaceholderRange: wraps around to find first placeholder when past all', () => {
  const text = 'Hello {{name}}'
  // cursorPos past the only placeholder — should wrap to it
  const range = nextPlaceholderRange(text, 20)
  assert.deepStrictEqual(range, { start: 6, end: 14 })
})

test('nextPlaceholderRange: finds {{cursor}} placeholder', () => {
  const text = 'before {{cursor}} after'
  const range = nextPlaceholderRange(text, 0)
  assert.deepStrictEqual(range, { start: 7, end: 17 })
})

// -------------------------------------------------------------------------
// insertTemplate: given a textarea value and cursor position, return the
// updated {value, selectionStart, selectionEnd} after inserting the template
// at the current word-start (where ";;" was typed).
// -------------------------------------------------------------------------

const { insertTemplate } = require('../src/main/templates')

test('insertTemplate: replaces ";;" trigger and returns text with first placeholder selected', () => {
  // user typed ";;" at position 2 in "  ;;"
  const value = '  ;;'
  const triggerStart = 2 // where ";;" begins
  const template = 'Hello {{name}}!'
  const result = insertTemplate(value, triggerStart, template)
  assert.strictEqual(result.value, '  Hello {{name}}!')
  assert.strictEqual(result.selectionStart, 8)  // start of {{name}}
  assert.strictEqual(result.selectionEnd, 16)   // end of {{name}}
})

test('insertTemplate: when template has no placeholders, cursor lands at end', () => {
  const result = insertTemplate(';;', 0, 'plain text')
  assert.strictEqual(result.value, 'plain text')
  assert.strictEqual(result.selectionStart, 10)
  assert.strictEqual(result.selectionEnd, 10)
})

test('insertTemplate: {{cursor}} sets selection to that position (empty selection)', () => {
  const result = insertTemplate(';;', 0, 'before{{cursor}}after')
  assert.strictEqual(result.value, 'before{{cursor}}after')
  // Selection covers the {{cursor}} token itself (caller can replace on Tab)
  assert.strictEqual(result.selectionStart, 6)
  assert.strictEqual(result.selectionEnd, 16)
})
