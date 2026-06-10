// src/main/attention.js
// PURE attention state machine. No fs, no timers, no Date.now(): the caller
// injects wall-clock ms as obs.ts. Turn duration uses observation wall-clock
// (not transcript timestamps) so clock skew in the file can't fool us.

const MIN_TURN_MS = 30_000 // turns shorter than this never notify (turn:finished)
const BLOCKED_MS = 90_000 // open turn + no file writes for this long => blocked
const USAGE_THRESHOLD = 90 // window utilization % that triggers usage:threshold

function createAttentionState() {
  return {
    started: false,
    lastUserCount: 0,
    lastAssistantCount: 0,
    lastErrorCount: 0,
    turnOpen: false,
    turnOpenedAt: 0,
    lastMtime: 0,
    lastWriteTs: 0,
    blockedEmitted: false,
    errorEmitted: false
  }
}

/**
 * Feed one observation; returns an array of attention events (possibly empty),
 * mutating `state`. obs = { ts, mtimeMs, userCount, assistantCount, errorCount }.
 */
function observe(state, obs) {
  const events = []
  const ts = obs.ts

  // First observation = baseline only. Never fire on pre-existing history.
  if (!state.started) {
    state.started = true
    state.lastUserCount = obs.userCount
    state.lastAssistantCount = obs.assistantCount
    state.lastErrorCount = obs.errorCount
    state.lastMtime = obs.mtimeMs
    state.lastWriteTs = ts
    return events
  }

  // A write (mtime changed) resets the blocked clock.
  if (obs.mtimeMs !== state.lastMtime) {
    state.lastMtime = obs.mtimeMs
    state.lastWriteTs = ts
  }

  // New user message → a turn opened.
  if (obs.userCount > state.lastUserCount) {
    state.turnOpen = true
    state.turnOpenedAt = ts
    state.blockedEmitted = false
    state.errorEmitted = false
  }

  // New error record while a turn is open → turn:error (once), closes the turn.
  if (obs.errorCount > state.lastErrorCount && state.turnOpen && !state.errorEmitted) {
    events.push({ type: 'turn:error', ts })
    state.errorEmitted = true
    state.turnOpen = false
  }

  // New assistant message closing an open turn → turn:finished if long enough.
  if (obs.assistantCount > state.lastAssistantCount && state.turnOpen) {
    const durationMs = ts - state.turnOpenedAt
    if (durationMs >= MIN_TURN_MS) events.push({ type: 'turn:finished', ts, durationMs })
    state.turnOpen = false
  }

  // Blocked: turn still open, no writes for BLOCKED_MS (once per turn).
  if (state.turnOpen && !state.blockedEmitted && ts - state.lastWriteTs >= BLOCKED_MS) {
    events.push({ type: 'blocked', ts, idleMs: ts - state.lastWriteTs })
    state.blockedEmitted = true
  }

  state.lastUserCount = obs.userCount
  state.lastAssistantCount = obs.assistantCount
  state.lastErrorCount = obs.errorCount
  return events
}

// ---- Usage thresholds (separate, from UsagePoller windows) -------------------
const USAGE_WINDOWS = ['fiveHour', 'sevenDay', 'sevenDayOpus', 'sevenDaySonnet']

function createUsageState() {
  return {} // windowKey -> { resetsAt, fired }
}

/**
 * Given normalized usage windows ({ utilization, resetsAt } each), emit one
 * usage:threshold per window per reset cycle when utilization crosses 90%.
 */
function observeUsage(state, windows, ts) {
  const events = []
  if (!windows) return events
  for (const key of USAGE_WINDOWS) {
    const w = windows[key]
    if (!w || typeof w.utilization !== 'number') continue
    const resetsAt = w.resetsAt || null
    if (!state[key] || state[key].resetsAt !== resetsAt) {
      state[key] = { resetsAt, fired: false } // new window cycle → re-arm
    }
    const slot = state[key]
    if (w.utilization >= USAGE_THRESHOLD && !slot.fired) {
      events.push({ type: 'usage:threshold', ts, window: key, utilization: w.utilization, resetsAt })
      slot.fired = true
    }
  }
  return events
}

module.exports = {
  createAttentionState, observe, createUsageState, observeUsage,
  MIN_TURN_MS, BLOCKED_MS, USAGE_THRESHOLD, USAGE_WINDOWS
}
