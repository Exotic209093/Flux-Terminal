// Pure template engine for the prompt library.
//
// Syntax:
//   {{varName}}   — a named placeholder (filled in by the user)
//   {{cursor}}    — special: marks where the caret lands after insertion
//   {{{{          — escaped literal "{{" in output  (double-brace escape)
//   }}}}          — escaped literal "}}" in output
//
// All functions are pure and have no side effects.

// Matches {{word}} tokens. Escaped {{{{ sequences must be pre-stripped.
const PLACEHOLDER_RE = /\{\{([^{}]+)\}\}/g

// Sentinels chosen to never appear in real template text
const SENT_OPEN = '\x00OPEN\x00'
const SENT_CLOSE = '\x00CLOSE\x00'

/** Strip escape sequences and return a string safe for placeholder matching. */
function _stripEscapes(s) {
  return s.replace(/\{\{\{\{/g, SENT_OPEN).replace(/\}\}\}\}/g, SENT_CLOSE)
}

/**
 * Return the ordered, deduplicated list of placeholder names in `template`.
 * Escaped sequences ({{{{ and }}}}) are not treated as placeholders.
 */
function parsePlaceholders(template) {
  const safe = _stripEscapes(template)
  const seen = new Set()
  const out = []
  let m
  PLACEHOLDER_RE.lastIndex = 0
  while ((m = PLACEHOLDER_RE.exec(safe)) !== null) {
    const name = m[1]
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

/**
 * Replace placeholders in `template` with values from `vars`.
 * Unknown placeholders are left as-is.
 * {{{{ sequences become literal "{{" and }}}} become "}}" in output.
 */
function expandTemplate(template, vars) {
  // Protect escape sequences from placeholder matching
  let result = _stripEscapes(template)
  // Replace known placeholders
  result = result.replace(PLACEHOLDER_RE, (_match, name) => {
    return Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : _match
  })
  // Restore escaped braces
  return result.replace(new RegExp(SENT_OPEN, 'g'), '{{').replace(new RegExp(SENT_CLOSE, 'g'), '}}')
}

/**
 * Find the next {{...}} placeholder in `text` at or after `cursorPos`.
 * If none is found after cursorPos, wraps around to find the first one.
 * Returns { start, end } (indices into `text`) or null if no placeholders exist.
 *
 * `end` points to the character after the closing `}}`, so
 * text.slice(start, end) === '{{name}}'.
 */
function nextPlaceholderRange(text, cursorPos) {
  // Collect all placeholder ranges
  const ranges = []
  let m
  PLACEHOLDER_RE.lastIndex = 0
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length })
  }
  if (ranges.length === 0) return null

  // Find first range that starts at or after cursorPos
  const forward = ranges.find((r) => r.start >= cursorPos)
  if (forward) return forward

  // Wrap around: return the very first one
  return ranges[0]
}

/**
 * Insert `template` into a textarea `value`, replacing the `;;` trigger that
 * starts at `triggerStart`.  Returns { value, selectionStart, selectionEnd }
 * ready to apply to the textarea state.
 *
 * If the template has placeholders, the first one is selected so the user can
 * type the replacement immediately.  If there are no placeholders, the cursor
 * is placed at the end of the inserted text.
 */
function insertTemplate(value, triggerStart, template) {
  const before = value.slice(0, triggerStart)
  const after = value.slice(triggerStart + 2) // 2 = length of ";;"
  const newValue = before + template + after

  const offset = before.length // where the template starts in newValue

  // Find first placeholder in the inserted template fragment
  PLACEHOLDER_RE.lastIndex = 0
  const m = PLACEHOLDER_RE.exec(template)
  if (m) {
    const start = offset + m.index
    const end = start + m[0].length
    return { value: newValue, selectionStart: start, selectionEnd: end }
  }

  // No placeholders — cursor lands at end of inserted text
  const pos = offset + template.length
  return { value: newValue, selectionStart: pos, selectionEnd: pos }
}

module.exports = { parsePlaceholders, expandTemplate, nextPlaceholderRange, insertTemplate }
