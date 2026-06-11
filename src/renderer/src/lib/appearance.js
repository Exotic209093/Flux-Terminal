// Renderer-only "background animation" preference. Stored in localStorage as
// '1'/'0'; absent means "follow the OS reduced-motion setting".
const STORAGE_KEY = 'flux.animations'

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// Pure resolver so the default logic is unit-testable. `saved` is '1' | '0' | null.
export function resolveAnimations(saved, reducedMotion) {
  if (saved === '1') return true
  if (saved === '0') return false
  return !reducedMotion
}

export function loadAnimations() {
  let saved = null
  try {
    saved = localStorage.getItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  return resolveAnimations(saved, prefersReducedMotion())
}

export function saveAnimations(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

// Tri-state animation pref -> concrete boolean. 'auto' follows the OS setting.
export function resolveMotion(animations, reducedMotion) {
  if (animations === 'on') return true
  if (animations === 'off') return false
  return !reducedMotion // 'auto'
}

// Merge legacy localStorage values into the stored appearance object. Legacy
// wins where present + valid. legacy = { theme, animations: '1'|'0'|null, model }.
export function mergeLegacyAppearance(current, legacy) {
  const out = { ...current }
  if (typeof legacy.theme === 'string' && legacy.theme) out.theme = legacy.theme
  if (legacy.animations === '1') out.animations = 'on'
  else if (legacy.animations === '0') out.animations = 'off'
  if (typeof legacy.model === 'string' && legacy.model) out.model = legacy.model
  return out
}
