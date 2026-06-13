// src/main/environment.js
// First-run "doctor": is the claude CLI present (+ version), is the user logged
// in, and how many sessions exist. Pure + injectable so it unit-tests without
// touching the real PATH or filesystem.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { resolveClaudeBin, needsShell } = require('./resume')

function detectCli({ execFile = execFileSync, resolveBin = resolveClaudeBin } = {}) {
  const bin = resolveBin()
  try {
    const useShell = needsShell(bin)
    const file = useShell && /\s/.test(bin) ? '"' + bin + '"' : bin
    const out = execFile(file, ['--version'], { encoding: 'utf-8', timeout: 5000, windowsHide: true, shell: useShell })
    return { found: true, version: String(out).trim(), path: bin }
  } catch {
    return { found: false, version: null, path: bin === 'claude' ? null : bin }
  }
}

function detectLoggedIn({ fsImpl = fs, home = os.homedir() } = {}) {
  try {
    const raw = fsImpl.readFileSync(path.join(home, '.claude', '.credentials.json'), 'utf-8')
    const j = JSON.parse(raw)
    return !!(j && j.claudeAiOauth && j.claudeAiOauth.accessToken)
  } catch {
    return false
  }
}

function getEnvironment({ sessionCount = 0, execFile, resolveBin, fsImpl, home } = {}) {
  return {
    cli: detectCli({ execFile, resolveBin }),
    loggedIn: detectLoggedIn({ fsImpl, home }),
    sessionCount
  }
}

module.exports = { getEnvironment, detectCli, detectLoggedIn }
