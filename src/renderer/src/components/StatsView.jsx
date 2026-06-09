import { useMemo } from 'react'
import { formatTokens, totalTokens, projectName } from '../lib/format'
import { estimateCost, formatUSD } from '../lib/pricing'

function dayKey(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function computeStats(sessions) {
  const tools = {}
  const projects = {}
  const byDay = {}
  let messages = 0
  let tokens = 0
  let cost = 0
  let toolCalls = 0
  let cacheRead = 0
  let longestSession = 0

  for (const s of sessions) {
    messages += s.counts?.total || 0
    toolCalls += s.counts?.toolUse || 0
    tokens += totalTokens(s.usage)
    cacheRead += s.usage?.cacheRead || 0
    cost += estimateCost(s.usage, s.models && s.models[0]).total
    longestSession = Math.max(longestSession, s.counts?.total || 0)

    for (const [name, c] of Object.entries(s.tools || {})) tools[name] = (tools[name] || 0) + c

    const p = projectName(s.cwd)
    if (!projects[p]) projects[p] = { tokens: 0, sessions: 0 }
    projects[p].tokens += totalTokens(s.usage)
    projects[p].sessions += 1

    const d = dayKey(s.lastTimestamp)
    if (d) byDay[d] = (byDay[d] || 0) + totalTokens(s.usage)
  }

  // last-30-day activity series
  const series = []
  const today = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10)
    series.push({ day: d, tokens: byDay[d] || 0 })
  }

  // longest active-day streak
  const activeDays = new Set(Object.keys(byDay))
  let streak = 0
  let cursor = new Date(today)
  // count back from today/yesterday
  if (!activeDays.has(cursor.toISOString().slice(0, 10))) cursor = new Date(cursor.getTime() - 86400000)
  while (activeDays.has(cursor.toISOString().slice(0, 10))) {
    streak++
    cursor = new Date(cursor.getTime() - 86400000)
  }

  return {
    sessions: sessions.length,
    messages,
    tokens,
    cost,
    toolCalls,
    cacheRead,
    longestSession,
    streak,
    distinctProjects: Object.keys(projects).length,
    topTools: Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 10),
    topProjects: Object.entries(projects).sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 8),
    series
  }
}

function achievements(st) {
  return [
    { icon: '🪙', name: 'Billionaire', desc: '1B+ total tokens', got: st.tokens >= 1e9 },
    { icon: '🔧', name: 'Tool Master', desc: '1,000+ tool calls', got: st.toolCalls >= 1000 },
    { icon: '🏃', name: 'Marathoner', desc: '1,000+ msgs in one session', got: st.longestSession >= 1000 },
    { icon: '🗂️', name: 'Polyglot', desc: '5+ distinct projects', got: st.distinctProjects >= 5 },
    { icon: '🔥', name: 'On Fire', desc: '3+ day streak', got: st.streak >= 3 },
    { icon: '⚡', name: 'Cache Wizard', desc: '1B+ cache-read tokens', got: st.cacheRead >= 1e9 },
    { icon: '💯', name: 'Centurion', desc: '100+ sessions', got: st.sessions >= 100 },
    { icon: '💸', name: 'Big Spender', desc: '$100+ est. spend', got: st.cost >= 100 }
  ]
}

export default function StatsView({ sessions, loading }) {
  const st = useMemo(() => computeStats(sessions || []), [sessions])
  if (loading) return <div className="sv-empty">Crunching your stats…</div>
  if (!sessions || sessions.length === 0) return <div className="sv-empty">No sessions yet.</div>

  const maxDay = Math.max(1, ...st.series.map((d) => d.tokens))
  const ach = achievements(st)

  return (
    <div className="stats-view">
      <h2 className="stats-title">Your Claude Code, by the numbers</h2>

      <div className="stats-cards">
        <BigStat v={st.sessions} l="Sessions" />
        <BigStat v={formatTokens(st.messages)} l="Messages" />
        <BigStat v={formatTokens(st.tokens)} l="Total tokens" />
        <BigStat v={formatUSD(st.cost)} l="Est. spend" accent />
        <BigStat v={formatTokens(st.toolCalls)} l="Tool calls" />
        <BigStat v={st.streak + 'd'} l="Current streak" />
      </div>

      <div className="stats-grid">
        <section className="stats-panel">
          <h3>Activity — last 30 days</h3>
          <div className="activity">
            {st.series.map((d) => (
              <div
                key={d.day}
                className="activity-bar"
                title={`${d.day}: ${formatTokens(d.tokens)} tokens`}
                style={{ height: Math.max(2, (d.tokens / maxDay) * 100) + '%' }}
              />
            ))}
          </div>
        </section>

        <section className="stats-panel">
          <h3>Achievements</h3>
          <div className="achievements">
            {ach.map((a) => (
              <div key={a.name} className={'ach' + (a.got ? ' got' : '')} title={a.desc}>
                <span className="ach-icon">{a.icon}</span>
                <span className="ach-name">{a.name}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="stats-panel">
          <h3>Top tools</h3>
          <BarList rows={st.topTools.map(([n, c]) => [n, c])} fmt={(v) => v.toLocaleString()} />
        </section>

        <section className="stats-panel">
          <h3>Top projects (by tokens)</h3>
          <BarList
            rows={st.topProjects.map(([n, o]) => [n, o.tokens])}
            fmt={(v) => formatTokens(v)}
          />
        </section>
      </div>
    </div>
  )
}

function BigStat({ v, l, accent }) {
  return (
    <div className={'big-stat' + (accent ? ' accent' : '')}>
      <div className="big-stat-v">{v}</div>
      <div className="big-stat-l">{l}</div>
    </div>
  )
}

function BarList({ rows, fmt }) {
  const max = Math.max(1, ...rows.map((r) => r[1]))
  return (
    <div className="barlist">
      {rows.map(([name, v]) => (
        <div className="barlist-row" key={name}>
          <span className="barlist-name" title={name}>
            {name}
          </span>
          <span className="barlist-track">
            <span className="barlist-fill" style={{ width: (v / max) * 100 + '%' }} />
          </span>
          <span className="barlist-v">{fmt(v)}</span>
        </div>
      ))}
    </div>
  )
}
