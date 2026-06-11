import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { SettingsProvider } from './lib/settings-context'
import { SessionsProvider } from './lib/sessions-context'
import { applyTheme } from './lib/themes'
import { resolveMotion, prefersReducedMotion, mergeLegacyAppearance } from './lib/appearance'
import './index.css'

// 1. Settings arrive synchronously from main (no flash).
const initial = window.flux.settings.initial || { appearance: { theme: 'midnight', animations: 'auto', model: null }, appearanceMigrated: true }

// 2. One-time migration from the old localStorage prefs.
let appearance = initial.appearance
if (!initial.appearanceMigrated) {
  const legacy = {
    theme: localStorage.getItem('flux.theme'),
    animations: localStorage.getItem('flux.animations'),
    model: localStorage.getItem('flux.model')
  }
  appearance = mergeLegacyAppearance(initial.appearance, legacy)
  window.flux.settings.set('appearance.theme', appearance.theme)
  window.flux.settings.set('appearance.animations', appearance.animations)
  window.flux.settings.set('appearance.model', appearance.model)
  window.flux.settings.set('appearanceMigrated', true)
  localStorage.removeItem('flux.theme')
  localStorage.removeItem('flux.animations')
  localStorage.removeItem('flux.model')
}

// 3. Theme the very first paint.
applyTheme(appearance.theme, { motion: resolveMotion(appearance.animations, prefersReducedMotion()) })

const seeded = { ...initial, appearance, appearanceMigrated: true }
createRoot(document.getElementById('root')).render(
  <SettingsProvider initial={seeded}>
    <SessionsProvider>
      <App />
    </SessionsProvider>
  </SettingsProvider>
)
