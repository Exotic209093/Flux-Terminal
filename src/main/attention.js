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
    lastTurnDurationCount: 0,
    tdMode: false, // transcript writes turn_duration records → exact close signal
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
  const tdCount = obs.turnDurationCount || 0

  // First observation = baseline only. Never fire on pre-existing history.
  if (!state.started) {
    state.started = true
    state.lastUserCount = obs.userCount
    state.lastAssistantCount = obs.assistantCount
    state.lastErrorCount = obs.errorCount
    state.lastTurnDurationCount = tdCount
    if (tdCount > 0) state.tdMode = true
    state.lastMtime = obs.mtimeMs
    state.lastWriteTs = ts
    return events
  }

  // A write (mtime changed) resets the blocked clock — and re-arms blocked:
  // the write means the stall (if any) resolved, so the standing status clears
  // and a second ≥BLOCKED_MS stall in the same turn can notify again.
  if (obs.mtimeMs !== state.lastMtime) {
    state.lastMtime = obs.mtimeMs
    state.lastWriteTs = ts
    state.blockedEmitted = false
  }

  // Exact close: the CLI wrote a turn_duration record with the real duration.
  // Once any td record is seen, assistant records (which arrive mid-turn,
  // between tool calls) stop closing turns — only this branch does.
  // Runs before the user-open branch: with a queued prompt, the previous
  // turn's td record and the next prompt arrive in the same poll — close the
  // old turn first so the new one isn't killed at birth. Poll-granularity
  // tradeoff: a complete sub-3s turn whose user+td land in one tick leaves
  // the turn open until the next td record (rare).
  if (tdCount > state.lastTurnDurationCount) {
    state.tdMode = true
    if (state.turnOpen) {
      const durationMs =
        typeof obs.lastTurnDurationMs === 'number' && obs.lastTurnDurationMs > 0
          ? obs.lastTurnDurationMs
          : ts - state.turnOpenedAt
      if (durationMs >= MIN_TURN_MS) events.push({ type: 'turn:finished', ts, durationMs })
      state.turnOpen = false
    }
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
  // NB: this runs AFTER the error branch, which may have closed the turn — so an
  // error+assistant in the same observation can't double-fire turn:finished.
  // In td mode, the turn_duration branch above supersedes this: assistant records
  // arrive mid-turn (between tool calls) and must not prematurely close the turn.
  if (!state.tdMode && obs.assistantCount > state.lastAssistantCount && state.turnOpen) {
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
  state.lastTurnDurationCount = tdCount
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
