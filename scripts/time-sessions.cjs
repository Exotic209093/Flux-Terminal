// Time listSessions() under Electron's runtime to isolate the main-thread stall.
const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const { listSessions } = require('../src/main/sessions')

const LOG = path.join(__dirname, '..', 'time-sessions.log')
const log = (m) => {
  fs.appendFileSync(LOG, m + '\n')
  process.stdout.write(m + '\n')
}
fs.writeFileSync(LOG, '')

app.whenReady().then(() => {
  try {
    const t0 = Date.now()
    const s = listSessions({ limit: 500 })
    log(`SESSIONS_TIMED count=${s.length} ms=${Date.now() - t0}`)
  } catch (e) {
    log('ERROR ' + (e && e.stack ? e.stack : e))
  } finally {
    app.exit(0)
  }
})
