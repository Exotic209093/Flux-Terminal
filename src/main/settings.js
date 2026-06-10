// src/main/settings.js
const fs = require('fs')
const path = require('path')

// Notification preferences. Three-way per event (toast | badge | off) + a sound
// boolean. Defaults match the approved Milestone A table: routine = badge,
// "needs you" = toast, sound off.
const MODES = ['toast', 'badge', 'off']
const EVENT_KEYS = ['turnFinished', 'turnError', 'blocked', 'usageThreshold']

const DEFAULT_PROFILES = [
  { id: 'powershell', name: 'PowerShell (here)', shell: null, args: [], cwd: null },
  { id: 'claude', name: 'claude (tracked)', shell: null, args: [], cwd: null, tracked: true }
]

const DEFAULTS = {
  version: 1,
  notify: {
    turnFinished: 'badge',
    turnError: 'toast',
    blocked: 'toast',
    usageThreshold: 'toast',
    sound: false,
    muted: false
  },
  profiles: DEFAULT_PROFILES,
  workspace: null
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

module.exports = { SettingsStore, DEFAULTS, MODES, EVENT_KEYS, DEFAULT_PROFILES }
