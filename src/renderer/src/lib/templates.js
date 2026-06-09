// Template engine for the prompt library.
// Pure functions — no side effects, no imports.
//
// Syntax:
//   {{varName}}  — named placeholder
//   {{cursor}}   — special: marks caret position after insertion
//   {{{{         — escaped literal "{{" in output
//   }}}}         — escaped literal "}}" in output

// Sentinels chosen to never appear in real template text
const SENT_OPEN = '\x00OPEN\x00'
const SENT_CLOSE = '\x00CLOSE\x00'
const PLACEHOLDER_RE = /\{\{([^{}]+)\}\}/g

function _stripEscapes(s) {
  return s.replace(/\{\{\{\{/g, SENT_OPEN).replace(/\}\}\}\}/g, SENT_CLOSE)
}

export function parsePlaceholders(template) {
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

export function expandTemplate(template, vars) {
  let result = _stripEscapes(template)
  result = result.replace(PLACEHOLDER_RE, (_match, name) => {
    return Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : _match
  })
  return result.replace(new RegExp(SENT_OPEN, 'g'), '{{').replace(new RegExp(SENT_CLOSE, 'g'), '}}')
}

export function nextPlaceholderRange(text, cursorPos) {
  const ranges = []
  let m
  PLACEHOLDER_RE.lastIndex = 0
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length })
  }
  if (ranges.length === 0) return null
  const forward = ranges.find((r) => r.start >= cursorPos)
  if (forward) return forward
  return ranges[0]
}

export function insertTemplate(value, triggerStart, template) {
  const before = value.slice(0, triggerStart)
  const after = value.slice(triggerStart + 2) // 2 = length of ";;"
  const newValue = before + template + after
  const offset = before.length

  PLACEHOLDER_RE.lastIndex = 0
  const m = PLACEHOLDER_RE.exec(template)
  if (m) {
    const start = offset + m.index
    const end = start + m[0].length
    return { value: newValue, selectionStart: start, selectionEnd: end }
  }

  const pos = offset + template.length
  return { value: newValue, selectionStart: pos, selectionEnd: pos }
}
