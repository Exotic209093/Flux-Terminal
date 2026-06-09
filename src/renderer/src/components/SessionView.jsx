import { formatTokens, totalTokens, modelLabel, projectName } from '../lib/format'
import { estimateCost, formatUSD } from '../lib/pricing'

function duration(start, end) {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (Number.isNaN(ms) || ms <= 0) return null
  const m = Math.round(ms / 60000)
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  return h + 'h ' + (m % 60) + 'm'
}

const KIND_LABEL = {
  user: 'You',
  text: 'Claude',
  thinking: 'Thinking',
  tool_use: 'Tool',
  tool_result: 'Result'
}

function TimelineItem({ item }) {
  const cls = 'tl-item tl-' + item.kind + (item.isError ? ' tl-error' : '')
  return (
    <div className={cls}>
      <div className="tl-gutter">
        <span className="tl-label">{KIND_LABEL[item.kind] || item.kind}</span>
      </div>
      <div className="tl-body">
        {item.kind === 'tool_use' ? (
          <div>
            <span className="tl-tool">{item.toolName}</span>
            {item.toolInput && <pre className="tl-pre">{item.toolInput}</pre>}
          </div>
        ) : item.kind === 'tool_result' ? (
          <pre className="tl-pre tl-dim">{item.text}</pre>
        ) : (
          <div className="tl-text">{item.text}</div>
        )}
      </div>
    </div>
  )
}

export default function SessionView({ detail, loading }) {
  if (loading) return <div className="sv-empty">Loading session…</div>
  if (!detail) return <div className="sv-empty">Select a session to relive it.</div>
  if (detail.ok === false) return <div className="sv-empty error">⚠ {detail.error}</div>

  const usage = detail.usage
  const cost = estimateCost(usage, detail.models && detail.models[0])
  const dur = duration(detail.firstTimestamp, detail.lastTimestamp)
  const topTools = Object.entries(detail.tools || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)

  return (
    <div className="session-view">
      <div className="sv-header">
        <h2 className="sv-title">{detail.title || '(untitled session)'}</h2>
        <div className="sv-sub">
          <span className="sv-project">{projectName(detail.cwd)}</span>
          {detail.gitBranch && <span className="sv-branch">⎇ {detail.gitBranch}</span>}
          {detail.models[0] && <span className="sv-model">{modelLabel(detail.models[0])}</span>}
          {dur && <span>{dur}</span>}
        </div>

        <div className="sv-stats">
          <Stat label="Messages" value={detail.counts.total} />
          <Stat label="Tools used" value={detail.counts.toolUse} />
          <Stat label="Total tokens" value={formatTokens(totalTokens(usage))} />
          <Stat label="Est. cost" value={formatUSD(cost.total)} accent />
        </div>

        <div className="sv-tokens">
          <TokenBar usage={usage} />
          <div className="sv-token-legend">
            <Legend cls="tk-cacheRead" label="cache read" v={usage.cacheRead} />
            <Legend cls="tk-output" label="output" v={usage.output} />
            <Legend cls="tk-cacheWrite" label="cache write" v={usage.cacheCreation} />
            <Legend cls="tk-input" label="input" v={usage.input} />
          </div>
        </div>

        {topTools.length > 0 && (
          <div className="sv-tools">
            {topTools.map(([name, c]) => (
              <span key={name} className="pill">
                {name} <b>{c}</b>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="sv-timeline">
        {(detail.timeline || []).map((item, i) => (
          <TimelineItem key={i} item={item} />
        ))}
        {(!detail.timeline || detail.timeline.length === 0) && (
          <div className="sv-empty">No replayable events in this session.</div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div className={'sv-stat' + (accent ? ' accent' : '')}>
      <div className="sv-stat-v">{value}</div>
      <div className="sv-stat-l">{label}</div>
    </div>
  )
}

function TokenBar({ usage }) {
  const total = totalTokens(usage) || 1
  const seg = (v) => Math.max(0, (v / total) * 100)
  return (
    <div className="token-bar">
      <span className="tk-cacheRead" style={{ width: seg(usage.cacheRead) + '%' }} />
      <span className="tk-output" style={{ width: seg(usage.output) + '%' }} />
      <span className="tk-cacheWrite" style={{ width: seg(usage.cacheCreation) + '%' }} />
      <span className="tk-input" style={{ width: seg(usage.input) + '%' }} />
    </div>
  )
}

function Legend({ cls, label, v }) {
  return (
    <span className="legend">
      <span className={'legend-dot ' + cls} />
      {label} {formatTokens(v || 0)}
    </span>
  )
}
