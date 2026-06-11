import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { applyTheme } from './themes'
import { resolveMotion, prefersReducedMotion } from './appearance'

const SettingsContext = createContext(null)

// `initial` is the already-migrated settings object (from main.jsx).
export function SettingsProvider({ initial, children }) {
  const [settings, setSettings] = useState(initial)

  // Single place that turns settings into the live theme + motion attributes.
  useEffect(() => {
    const a = settings.appearance
    applyTheme(a.theme, { motion: resolveMotion(a.animations, prefersReducedMotion()) })
  }, [settings.appearance.theme, settings.appearance.animations])

  // Optimistically update local state, then persist through main. If main
  // rejects, fall back to its authoritative copy.
  const update = useCallback((path, value) => {
    setSettings((prev) => applyPath(prev, path, value))
    window.flux.settings.set(path, value).then((res) => {
      if (res && res.ok) setSettings(res.settings)
    })
  }, [])

  return <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}

// Immutable dotted-path set for the two-level paths we use (e.g. appearance.theme,
// notify.sound) and the single key appearanceMigrated.
function applyPath(obj, path, value) {
  const parts = String(path).split('.')
  if (parts.length === 1) return { ...obj, [parts[0]]: value }
  const [section, key] = parts
  return { ...obj, [section]: { ...obj[section], [key]: value } }
}
