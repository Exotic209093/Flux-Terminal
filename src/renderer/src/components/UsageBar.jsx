import { useEffect, useState } from 'react'
import { useUsage } from '../lib/useUsage'

const WINDOWS = [
  { key: 'fiveHour', label: '5h' },
  { key: 'sevenDay', label: 'Week' },
  { key: 'sevenDayOpus', label: 'Week · Opus', detailOnly: true },
  { key: 'sevenDaySonnet', label: 'Week · Sonnet', detailOnly: true }
]

function countdown(resetsAt) {
  if (!resetsAt) return null
  const ms = new Date(resetsAt).getTime() - Date.now()
  if (Number.isNaN(ms)) return null
  if (ms <= 0) return 'resetting…'
  const m = Math.ceil(ms / 60000)
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 48) return h + 'h ' + (m % 60) + 'm'
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h'
}

function heat(pct) {
  if (pct >= 90) return ' hot'
  if (pct >= 70) return ' warm'
  return ''
}

// Plan-usage gauges. Compact (topbar) by default; `detailed` adds the
// per-model weekly windows and reset countdowns (session header).
// Owns its own useUsage subscription so 60s pushes re-render only this bar.
export default function UsageBar({ detailed = false }) {
  const { usage, refresh } = useUsage()
  // re-render every 30s so the countdowns tick between fetches
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  // Nothing yet, or first fetch still in flight — render nothing, not an error.
  if (!usage || usage.code === 'INIT') return null

  if (!usage.windows) {
    const signIn = usage.code === 'NO_CREDS' || usage.code === 'AUTH'
    const rateLimited = usage.code === 'HTTP_429'
    return (
      <div className={'usage-bar' + (detailed ? ' detailed' : '')}>
        <span className="usage-err" title={usage.error || ''}>
          {rateLimited
            ? '⚠ usage rate-limited — retrying soon'
            : signIn
              ? '⚠ usage: sign in with claude'
              : '⚠ usage unavailable'}
        </span>
        <button className="usage-refresh" onClick={refresh} title="Retry">
          ⟳
        </button>
      </div>
    )
  }

  const rows = WINDOWS.filter((w) => (detailed || !w.detailOnly) && usage.windows[w.key])
  return (
    <div className={'usage-bar' + (detailed ? ' detailed' : '')}>
      {rows.map((w) => {
        const win = usage.windows[w.key]
        const reset = countdown(win.resetsAt)
        return (
          <div
            className={'usage-gauge' + heat(win.utilization)}
            key={w.key}
            title={`${w.label} window: ${win.utilization}% used${reset ? ' · resets in ' + reset : ''}`}
          >
            <span className="usage-label">{w.label}</span>
            <span className="usage-track">
              <span className="usage-fill" style={{ width: win.utilization + '%' }} />
            </span>
            <span className="usage-pct">{win.utilization}%</span>
            {detailed && reset && <span className="usage-reset">resets in {reset}</span>}
          </div>
        )
      })}
      {usage.stale && (
        <span className="usage-stale" title={usage.error || 'last fetch failed'}>
          stale
        </span>
      )}
      <button className="usage-refresh" onClick={refresh} title="Refresh usage">
        ⟳
      </button>
    </div>
  )
}
