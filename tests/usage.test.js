const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { normalizeUsage, readAccessToken, fetchUsage } = require('../src/main/usage')

test('normalizeUsage maps all four windows', () => {
  const out = normalizeUsage({
    five_hour: { utilization: 23.4, resets_at: '2026-06-09T20:00:00Z' },
    seven_day: { utilization: 41, resets_at: '2026-06-12T11:00:00Z' },
    seven_day_opus: { utilization: 5, resets_at: null },
    seven_day_sonnet: { utilization: 0, resets_at: null }
  })
  assert.deepStrictEqual(out.fiveHour, { utilization: 23, resetsAt: '2026-06-09T20:00:00Z' })
  assert.deepStrictEqual(out.sevenDay, { utilization: 41, resetsAt: '2026-06-12T11:00:00Z' })
  assert.strictEqual(out.sevenDayOpus.utilization, 5)
  assert.strictEqual(out.sevenDaySonnet.utilization, 0)
})

test('normalizeUsage falls back to remaining_percentage and clamps', () => {
  const out = normalizeUsage({
    five_hour: { remaining_percentage: 30, resets_at: null },
    seven_day: { utilization: 250, resets_at: null }
  })
  assert.strictEqual(out.fiveHour.utilization, 70)
  assert.strictEqual(out.sevenDay.utilization, 100)
})

test('normalizeUsage returns null for junk', () => {
  assert.strictEqual(normalizeUsage(null), null)
  assert.strictEqual(normalizeUsage({}), null)
  assert.strictEqual(normalizeUsage({ five_hour: { bogus: 1 } }), null)
})

test('readAccessToken reads claudeAiOauth.accessToken from an explicit file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-usage-'))
  const file = path.join(dir, 'creds.json')
  fs.writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: 'tok-123' } }))
  assert.strictEqual(readAccessToken(file), 'tok-123')
  assert.strictEqual(readAccessToken(path.join(dir, 'missing.json')), null)
  fs.writeFileSync(file, 'not json')
  assert.strictEqual(readAccessToken(file), null)
})

test('fetchUsage: no token -> NO_CREDS', async () => {
  const res = await fetchUsage({ getToken: () => null })
  assert.strictEqual(res.ok, false)
  assert.strictEqual(res.code, 'NO_CREDS')
})

test('fetchUsage: 401 -> AUTH', async () => {
  const res = await fetchUsage({
    getToken: () => 't',
    fetchImpl: async () => ({ ok: false, status: 401 })
  })
  assert.strictEqual(res.code, 'AUTH')
})

test('fetchUsage: network throw -> NETWORK', async () => {
  const res = await fetchUsage({
    getToken: () => 't',
    fetchImpl: async () => { throw new Error('offline') }
  })
  assert.strictEqual(res.code, 'NETWORK')
})

test('fetchUsage: happy path normalizes and stamps fetchedAt', async () => {
  const res = await fetchUsage({
    getToken: () => 't',
    fetchImpl: async (url, opts) => {
      assert.strictEqual(url, 'https://api.anthropic.com/api/oauth/usage')
      assert.strictEqual(opts.headers.Authorization, 'Bearer t')
      assert.strictEqual(opts.headers['anthropic-beta'], 'oauth-2025-04-20')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          five_hour: { utilization: 10, resets_at: '2026-06-09T20:00:00Z' },
          seven_day: { utilization: 50, resets_at: '2026-06-12T11:00:00Z' }
        })
      }
    }
  })
  assert.strictEqual(res.ok, true)
  assert.strictEqual(res.windows.fiveHour.utilization, 10)
  assert.ok(typeof res.fetchedAt === 'number')
})

test('fetchUsage: unrecognized body -> SHAPE', async () => {
  const res = await fetchUsage({
    getToken: () => 't',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) })
  })
  assert.strictEqual(res.code, 'SHAPE')
})

const { UsagePoller } = require('../src/main/usage')

test('UsagePoller: keeps last good windows and flags stale on failure', async () => {
  const results = [
    { ok: true, windows: { fiveHour: { utilization: 10, resetsAt: null }, sevenDay: null, sevenDayOpus: null, sevenDaySonnet: null }, fetchedAt: 111 },
    { ok: false, code: 'NETWORK', error: 'offline' }
  ]
  const emitted = []
  const poller = new UsagePoller((snap) => emitted.push(snap), {
    fetchUsage: async () => results.shift()
  })
  await poller.refresh()
  await poller.refresh()
  assert.strictEqual(emitted.length, 2)
  assert.strictEqual(emitted[0].ok, true)
  assert.strictEqual(emitted[1].ok, false)
  assert.strictEqual(emitted[1].stale, true)
  assert.strictEqual(emitted[1].windows.fiveHour.utilization, 10)
  assert.deepStrictEqual(poller.snapshot(), emitted[1])
})

test('UsagePoller: snapshot before any fetch is an INIT error', () => {
  const poller = new UsagePoller(() => {}, { fetchUsage: async () => ({ ok: false, code: 'X', error: 'x' }) })
  assert.strictEqual(poller.snapshot().code, 'INIT')
  assert.strictEqual(poller.snapshot().windows, null)
})

test('UsagePoller: failure with no prior success has null windows, stale false', async () => {
  const emitted = []
  const poller = new UsagePoller((s) => emitted.push(s), {
    fetchUsage: async () => ({ ok: false, code: 'AUTH', error: 'expired' })
  })
  await poller.refresh()
  assert.strictEqual(emitted[0].stale, false)
  assert.strictEqual(emitted[0].windows, null)
})
