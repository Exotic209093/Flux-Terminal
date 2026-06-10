import { useEffect, useState } from 'react'
import { formatTokens, totalTokens, modelLabel } from '../lib/format'
import { estimateCost, formatUSD } from '../lib/pricing'

// Docked atop the Terminal view. Launches a tracked `claude` (exact session-id
// correlation) and shows its stats updating live as you work.
export default function LivePanel({ onLaunch }) {
  const [live, setLive] = useState(null)

  useEffect(() => window.flux.live.onUpdate(setLive), [])

  const stop = () => window.flux.live.stop()

  if (!live || !live.tracking) {
    return (
      <div className="live-panel idle">
        <span className="live-hint">Live tracking —</span>
        <button className="live-launch" onClick={onLaunch}>
          ▶ Launch tracked claude
        </button>
        <span className="live-note">runs `claude --session-id …` and follows it live</span>
      </div>
    )
  }

  if (live.state === 'starting') {
    return (
      <div className="live-panel starting">
        <span className="live-dot" />
        <span>waiting for claude to start…</span>
        <span className="live-id" title={live.sessionId}>
          {(live.sessionId || '').slice(0, 8)}
        </span>
        <button className="live-stop" onClick={stop}>
          stop
        </button>
      </div>
    )
  }

  const usage = live.usage
  const tok = totalTokens(usage)
  const cost = estimateCost(usage, live.models && live.models[0])
  const cachePct = tok ? Math.round(((usage.cacheRead || 0) / tok) * 100) : 0

  return (
    <div className="live-panel live">
      <span className="live-badge">
        <span className="live-dot" /> LIVE
      </span>
      {live.models[0] && <span className="live-model">{modelLabel(live.models[0])}</span>}
      <Metric v={formatTokens(tok)} l="tokens" />
      <Metric v={formatUSD(cost.total)} l="cost" accent />
      <Metric v={live.counts.total} l="msgs" />
      <Metric v={live.counts.toolUse} l="tools" />
      <Metric v={cachePct + '%'} l="cache" />
      {live.lastTool && <span className="live-tool">▸ {live.lastTool}</span>}
      <span className="live-spacer" />
      <span className="live-id" title={live.sessionId}>
        {(live.sessionId || '').slice(0, 8)}
      </span>
      <button className="live-stop" onClick={stop}>
        stop
      </button>
    </div>
  )
}

function Metric({ v, l, accent }) {
  return (
    <span className={'live-metric' + (accent ? ' accent' : '')}>
      <b>{v}</b> {l}
    </span>
  )
}
