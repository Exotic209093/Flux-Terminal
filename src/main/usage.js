const fs = require('fs')
const path = require('path')
const os = require('os')

// Live plan usage: the same endpoint `claude /usage` hits, called with the
// Claude Code OAuth token from ~/.claude/.credentials.json. The token never
// leaves this machine except to api.anthropic.com.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA = 'oauth-2025-04-20'

function credentialsPath() {
  return path.join(os.homedir(), '.claude', '.credentials.json')
}

/** Access token from the Claude Code credentials store, or null. */
function readAccessToken(file = credentialsPath()) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch {
    return null
  }
  try {
    const creds = JSON.parse(raw)
    const oauth = creds.claudeAiOauth || creds
    return (oauth && typeof oauth.accessToken === 'string' && oauth.accessToken) || null
  } catch {
    return null
  }
}

function normalizeWindow(w) {
  if (!w || typeof w !== 'object') return null
  let utilization = null
  if (typeof w.utilization === 'number') utilization = w.utilization
  else if (typeof w.remaining_percentage === 'number') utilization = 100 - w.remaining_percentage
  if (utilization == null || Number.isNaN(utilization)) return null
  return {
    utilization: Math.max(0, Math.min(100, Math.round(utilization))),
    resetsAt: w.resets_at || null
  }
}

/** Normalize the API body to our window shape, or null if unrecognized. */
function normalizeUsage(json) {
  if (!json || typeof json !== 'object') return null
  const windows = {
    fiveHour: normalizeWindow(json.five_hour),
    sevenDay: normalizeWindow(json.seven_day),
    sevenDayOpus: normalizeWindow(json.seven_day_opus),
    sevenDaySonnet: normalizeWindow(json.seven_day_sonnet)
  }
  if (!windows.fiveHour && !windows.sevenDay) return null
  return windows
}

/**
 * Fetch + normalize. Returns { ok:true, windows, fetchedAt } or
 * { ok:false, code, error } with code in:
 * NO_CREDS | AUTH | NETWORK | HTTP_<n> | PARSE | SHAPE
 */
async function fetchUsage(opts = {}) {
  const getToken = opts.getToken || readAccessToken
  const fetchImpl = opts.fetchImpl || fetch
  const token = getToken()
  if (!token) {
    return { ok: false, code: 'NO_CREDS', error: 'No Claude Code login found — run `claude` once to sign in.' }
  }
  let res
  try {
    res = await fetchImpl(USAGE_URL, {
      headers: {
        Authorization: 'Bearer ' + token,
        'anthropic-beta': OAUTH_BETA,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(opts.timeoutMs || 30000)
    })
  } catch (err) {
    return { ok: false, code: 'NETWORK', error: err.message }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, code: 'AUTH', error: 'Login expired — run `claude` once to refresh, then retry.' }
  }
  if (!res.ok) {
    return { ok: false, code: 'HTTP_' + res.status, error: 'Usage endpoint returned ' + res.status }
  }
  let json
  try {
    json = await res.json()
  } catch (err) {
    return { ok: false, code: 'PARSE', error: err.message }
  }
  const windows = normalizeUsage(json)
  if (!windows) return { ok: false, code: 'SHAPE', error: 'Unrecognized usage response shape' }
  return { ok: true, windows, fetchedAt: Date.now() }
}

/**
 * Polls fetchUsage() on an interval, retaining the last good snapshot so the
 * UI keeps showing gauges (flagged stale) through transient failures.
 */
class UsagePoller {
  constructor(onUpdate, opts = {}) {
    this.onUpdate = onUpdate
    this.intervalMs = opts.intervalMs || 60000
    this.fetchUsage = opts.fetchUsage || fetchUsage
    this.timer = null
    this.lastGood = null
    this.lastEmit = null
    this.stopped = false
    this.inflight = null
  }

  start() {
    if (this.timer) return
    this.stopped = false
    this.refresh()
    // Safe: refresh() never rejects.
    this.timer = setInterval(() => { this.refresh() }, this.intervalMs)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.stopped = true
  }

  snapshot() {
    return this.lastEmit || { ok: false, code: 'INIT', error: 'usage not fetched yet', windows: null, stale: false, fetchedAt: null }
  }

  refresh() {
    if (this.inflight) return this.inflight
    this.inflight = this._refresh().finally(() => { this.inflight = null })
    return this.inflight
  }

  async _refresh() {
    let result
    try {
      result = await this.fetchUsage()
    } catch (err) {
      result = { ok: false, code: 'INTERNAL', error: err.message }
    }
    let emitted
    if (result.ok) {
      emitted = result
    } else {
      emitted = {
        ...result,
        stale: !!this.lastGood,
        windows: this.lastGood ? this.lastGood.windows : null,
        fetchedAt: this.lastGood ? this.lastGood.fetchedAt : null
      }
    }
    if (this.stopped) return emitted
    if (result.ok) this.lastGood = result
    this.lastEmit = emitted
    try {
      this.onUpdate(emitted)
    } catch {
      // Consumer may be a destroyed window; never let emit errors propagate.
    }
    return emitted
  }
}

module.exports = { normalizeUsage, readAccessToken, fetchUsage, UsagePoller, USAGE_URL, OAUTH_BETA }
