export default function HooksPanel({ timeline }) {
  const hooks = (timeline || []).filter((i) => i.kind === 'hook')
  if (!hooks.length) return <div className="sv-empty">No hook executions in this session.</div>
  return (
    <div className="hooks-panel">
      {hooks.map((h, i) => (
        <div key={i} className={'hook-row' + (h.status === 'hook_failure' ? ' fail' : '')}>
          <div className="hook-head">
            <span className="hook-name">{h.hookName || 'hook'}</span>
            {h.hookEvent && <span className="hook-event">{h.hookEvent}</span>}
            {h.status && <span className="hook-status">{h.status}</span>}
          </div>
          {h.text && <pre className="hook-out">{h.text}</pre>}
        </div>
      ))}
    </div>
  )
}
