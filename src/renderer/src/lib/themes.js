// Theme presets. Each theme overrides the core CSS custom properties defined in
// index.css :root. Switching a theme just rewrites those variables on <html>.

export const THEMES = {
  midnight: {
    name: 'Midnight',
    vars: {
      '--bg': '#0b0e14',
      '--bg-panel': '#0e1320',
      '--bg-elev': '#141a2a',
      '--bg-hover': '#1a2236',
      '--border': '#1e2740',
      '--text': '#cdd6f4',
      '--text-dim': '#8b93a7',
      '--text-faint': '#5b6478',
      '--accent': '#89b4fa',
      '--accent-2': '#f5a97f',
      '--accent-glow': 'rgba(137, 180, 250, 0.35)'
    }
  },
  nord: {
    name: 'Nord',
    vars: {
      '--bg': '#2e3440',
      '--bg-panel': '#2b303b',
      '--bg-elev': '#3b4252',
      '--bg-hover': '#434c5e',
      '--border': '#3b4252',
      '--text': '#eceff4',
      '--text-dim': '#a9b1c2',
      '--text-faint': '#6c7689',
      '--accent': '#88c0d0',
      '--accent-2': '#ebcb8b',
      '--accent-glow': 'rgba(136, 192, 208, 0.35)'
    }
  },
  dracula: {
    name: 'Dracula',
    vars: {
      '--bg': '#282a36',
      '--bg-panel': '#21222c',
      '--bg-elev': '#343746',
      '--bg-hover': '#3c3f54',
      '--border': '#3a3d4d',
      '--text': '#f8f8f2',
      '--text-dim': '#a8acc0',
      '--text-faint': '#6272a4',
      '--accent': '#bd93f9',
      '--accent-2': '#ff79c6',
      '--accent-glow': 'rgba(189, 147, 249, 0.4)'
    }
  },
  matrix: {
    name: 'Matrix',
    vars: {
      '--bg': '#050a05',
      '--bg-panel': '#081208',
      '--bg-elev': '#0c1a0c',
      '--bg-hover': '#103010',
      '--border': '#16431a',
      '--text': '#b9f6c8',
      '--text-dim': '#5fae6f',
      '--text-faint': '#3c7a48',
      '--accent': '#39ff14',
      '--accent-2': '#a6ff8f',
      '--accent-glow': 'rgba(57, 255, 20, 0.4)'
    }
  },
  synthwave: {
    name: 'Synthwave',
    vars: {
      '--bg': '#1a1025',
      '--bg-panel': '#1f1430',
      '--bg-elev': '#2a1b40',
      '--bg-hover': '#392455',
      '--border': '#3a2659',
      '--text': '#f7e6ff',
      '--text-dim': '#b48ad6',
      '--text-faint': '#7a5a9c',
      '--accent': '#ff4fd8',
      '--accent-2': '#36e0ff',
      '--accent-glow': 'rgba(255, 79, 216, 0.45)'
    }
  }
}

const STORAGE_KEY = 'flux.theme'

export function applyTheme(key) {
  const theme = THEMES[key] || THEMES.midnight
  const root = document.documentElement
  for (const [k, v] of Object.entries(theme.vars)) {
    root.style.setProperty(k, v)
  }
  root.setAttribute('data-theme', key)
}

export function loadTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && THEMES[saved]) return saved
  } catch {
    /* ignore */
  }
  return 'midnight'
}

export function saveTheme(key) {
  try {
    localStorage.setItem(STORAGE_KEY, key)
  } catch {
    /* ignore */
  }
}

/** Read current theme vars for syncing the xterm canvas colors. */
export function themeColors(key) {
  const t = THEMES[key] || THEMES.midnight
  return {
    background: t.vars['--bg'],
    foreground: t.vars['--text'],
    cursor: t.vars['--accent']
  }
}
