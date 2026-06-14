// src/main/settings.js
const fs = require('fs')
const path = require('path')

// Notification preferences. Three-way per event (toast | badge | off) + a sound
// boolean. Defaults match the approved Milestone A table: routine = badge,
// "needs you" = toast, sound off.
const MODES = ['toast', 'badge', 'off']
const EVENT_KEYS = ['turnFinished', 'turnError', 'blocked', 'usageThreshold']
const ANIM_MODES = ['auto', 'on', 'off']
const INTENSITY = ['subtle', 'balanced', 'bold']

const DEFAULT_PROFILES = [
  { id: 'powershell', name: 'PowerShell (here)', shell: null, args: [], cwd: null },
  { id: 'claude', name: 'claude (tracked)', shell: null, args: [], cwd: null, tracked: true }
]

const DEFAULTS = {
  version: 3,
  appearance: { theme: 'midnight', animations: 'auto', model: null, intensity: 'balanced' },
  notify: {
    turnFinished: 'badge',
    turnError: 'toast',
    blocked: 'toast',
    usageThreshold: 'toast',
    sound: false,
    muted: false
  },
  profiles: DEFAULT_PROFILES,
  workspace: null,
  onboarding: { dismissed: false, version: 1 },
  appearanceMigrated: false,
  push: { enabled: false, url: '' },
  tray: { closeToTray: false }
}

function clone(o) {
  return JSON.parse(JSON.stringify(o))
}

class SettingsStore {
  constructor(file) {
    this.file = file
    this.data = clone(DEFAULTS)
    this._load()
  }

  _load() {
    let raw
    try {
      raw = fs.readFileSync(this.file, 'utf-8')
    } catch {
      return // no file yet → keep defaults
    }
    try {
      const parsed = JSON.parse(raw)
      // Merge known keys over defaults; ignore unknown/legacy fields.
      this.data = clone(DEFAULTS)
      if (parsed && typeof parsed.notify === 'object') {
        for (const k of EVENT_KEYS) {
          if (MODES.includes(parsed.notify[k])) this.data.notify[k] = parsed.notify[k]
        }
        if (typeof parsed.notify.sound === 'boolean') this.data.notify.sound = parsed.notify.sound
        if (typeof parsed.notify.muted === 'boolean') this.data.notify.muted = parsed.notify.muted
      }
      if (Array.isArray(parsed.profiles)) this.data.profiles = parsed.profiles
      if (parsed.workspace && typeof parsed.workspace === 'object') this.data.workspace = parsed.workspace
      if (parsed.appearance && typeof parsed.appearance === 'object') {
        const a = parsed.appearance
        if (typeof a.theme === 'string' && a.theme) this.data.appearance.theme = a.theme
        if (ANIM_MODES.includes(a.animations)) this.data.appearance.animations = a.animations
        if (typeof a.model === 'string' || a.model === null) this.data.appearance.model = a.model
        if (INTENSITY.includes(a.intensity)) this.data.appearance.intensity = a.intensity
      }
      if (typeof parsed.appearanceMigrated === 'boolean') this.data.appearanceMigrated = parsed.appearanceMigrated
      if (parsed.onboarding && typeof parsed.onboarding === 'object') {
        if (typeof parsed.onboarding.dismissed === 'boolean') this.data.onboarding.dismissed = parsed.onboarding.dismissed
        if (typeof parsed.onboarding.version === 'number') this.data.onboarding.version = parsed.onboarding.version
      }
      if (parsed.push && typeof parsed.push === 'object') {
        if (typeof parsed.push.enabled === 'boolean') this.data.push.enabled = parsed.push.enabled
        if (typeof parsed.push.url === 'string') this.data.push.url = parsed.push.url
      }
      if (parsed.tray && typeof parsed.tray === 'object') {
        if (typeof parsed.tray.closeToTray === 'boolean') this.data.tray.closeToTray = parsed.tray.closeToTray
      }
    } catch {
      this.data = clone(DEFAULTS) // corrupt → defaults
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
    } catch {
      /* best-effort; in-memory cache still authoritative this session */
    }
  }

  /** A fresh deep copy so callers can't mutate the cache. */
  get() {
    return clone(this.data)
  }

  setNotify(key, value) {
    if (key === 'sound' || key === 'muted') {
      if (typeof value !== 'boolean') throw new Error(key + ' must be boolean')
      this.data.notify[key] = value
    } else if (EVENT_KEYS.includes(key)) {
      if (!MODES.includes(value)) throw new Error('invalid mode: ' + value)
      this.data.notify[key] = value
    } else {
      throw new Error('unknown setting key: ' + key)
    }
    this._save()
    return this.get()
  }

  getAppearance() {
    return clone(this.data.appearance)
  }

  setAppearance(key, value) {
    if (key === 'theme') {
      if (typeof value !== 'string' || !value) throw new Error('theme must be a non-empty string')
      this.data.appearance.theme = value
    } else if (key === 'animations') {
      if (!ANIM_MODES.includes(value)) throw new Error('invalid animations: ' + value)
      this.data.appearance.animations = value
    } else if (key === 'model') {
      if (value !== null && (typeof value !== 'string' || !value)) throw new Error('model must be a non-empty string or null')
      this.data.appearance.model = value
    } else if (key === 'intensity') {
      if (!INTENSITY.includes(value)) throw new Error('invalid intensity: ' + value)
      this.data.appearance.intensity = value
    } else {
      throw new Error('unknown appearance key: ' + key)
    }
    this._save()
    return this.get()
  }

  setMigrated(value) {
    this.data.appearanceMigrated = !!value
    this._save()
    return this.get()
  }

  setOnboarding(key, value) {
    if (key === 'dismissed') {
      if (typeof value !== 'boolean') throw new Error('onboarding.dismissed must be boolean')
      this.data.onboarding.dismissed = value
    } else if (key === 'version') {
      if (typeof value !== 'number') throw new Error('onboarding.version must be a number')
      this.data.onboarding.version = value
    } else {
      throw new Error('unknown onboarding key: ' + key)
    }
    this._save()
    return this.get()
  }

  setPush(key, value) {
    if (key === 'enabled') {
      if (typeof value !== 'boolean') throw new Error('push.enabled must be boolean')
      this.data.push.enabled = value
    } else if (key === 'url') {
      if (typeof value !== 'string') throw new Error('push.url must be a string')
      this.data.push.url = value
    } else throw new Error('unknown push key: ' + key)
    this._save()
    return this.get()
  }

  setTray(key, value) {
    if (key === 'closeToTray') {
      if (typeof value !== 'boolean') throw new Error('tray.closeToTray must be boolean')
      this.data.tray.closeToTray = value
    } else throw new Error('unknown tray key: ' + key)
    this._save()
    return this.get()
  }

  // Dotted-path setter used by the generic settings:set IPC.
  setByPath(path, value) {
    const [section, key] = String(path).split('.')
    if (section === 'appearance') return this.setAppearance(key, value)
    if (section === 'notify') return this.setNotify(key, value)
    if (path === 'appearanceMigrated') return this.setMigrated(value)
    if (section === 'onboarding') return this.setOnboarding(key, value)
    if (section === 'push') return this.setPush(key, value)
    if (section === 'tray') return this.setTray(key, value)
    throw new Error('unknown settings path: ' + path)
  }

  getProfiles() {
    return clone(this.data.profiles)
  }

  saveProfile(profile) {
    const list = this.data.profiles
    const id = profile.id || 'pf-' + Math.random().toString(36).slice(2, 9)
    const next = { ...profile, id }
    const idx = list.findIndex((p) => p.id === id)
    if (idx === -1) list.push(next)
    else list[idx] = next
    this._save()
    return clone(next)
  }

  deleteProfile(id) {
    this.data.profiles = this.data.profiles.filter((p) => p.id !== id)
    this._save()
  }

  getWorkspace() {
    return this.data.workspace ? clone(this.data.workspace) : null
  }

  setWorkspace(layout) {
    this.data.workspace = layout
    this._save()
  }
}

module.exports = { SettingsStore, DEFAULTS, MODES, EVENT_KEYS, DEFAULT_PROFILES, ANIM_MODES, INTENSITY }
