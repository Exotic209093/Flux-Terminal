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
