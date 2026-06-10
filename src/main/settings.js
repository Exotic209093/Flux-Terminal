// src/main/settings.js
const fs = require('fs')
const path = require('path')

// Notification preferences. Three-way per event (toast | badge | off) + a sound
// boolean. Defaults match the approved Milestone A table: routine = badge,
// "needs you" = toast, sound off.
const MODES = ['toast', 'badge', 'off']
const EVENT_KEYS = ['turnFinished', 'turnError', 'blocked', 'usageThreshold']

const DEFAULTS = {
  version: 1,
  notify: {
    turnFinished: 'badge',
    turnError: 'toast',
    blocked: 'toast',
    usageThreshold: 'toast',
    sound: false
  }
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
    if (key === 'sound') {
      if (typeof value !== 'boolean') throw new Error('sound must be boolean')
      this.data.notify.sound = value
    } else if (EVENT_KEYS.includes(key)) {
      if (!MODES.includes(value)) throw new Error('invalid mode: ' + value)
      this.data.notify[key] = value
    } else {
      throw new Error('unknown setting key: ' + key)
    }
    this._save()
    return this.get()
  }
}

module.exports = { SettingsStore, DEFAULTS, MODES, EVENT_KEYS }
