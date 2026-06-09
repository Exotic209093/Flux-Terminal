import { useEffect, useState } from 'react'

const DOT = { running: '●', done: '✓', error: '⚠' }

// Collapsible list of a session's subagents. Click one to drill into its
// timeline (rendered via the renderTimeline prop, reusing the parent's items).
export default function SubagentPanel({ file, live, renderTimeline }) {
  const [subagents, setSubagents] = useState([])
  const [open, setOpen] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      window.flux.subagents.list({ file, live }).then((r) => {
        if (alive && r.ok) setSubagents(r.subagents)
      })
    load()
    const t = live ? setInterval(load, 2000) : null
    return () => {
      alive = false
      if (t) clearInterval(t)
    }
  }, [file, live])

  useEffect(() => {
    if (!openId) {
      setDetail(null)
      return
    }
    let alive = true
    setDetail(null) // clear stale detail from the previously-open row
    window.flux.subagents.read({ file, agentId: openId }).then((r) => {
      if (alive && r.ok) setDetail(r.detail)
    })
    return () => {
      alive = false
    }
  }, [openId, file])

  if (!subagents.length) return null

  return (
    <div className="subagent-panel">
      <button className="subagent-head" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} Subagents ({subagents.length})
      </button>
      {open && (
        <div className="subagent-list">
          {subagents.map((s) => (
            <div key={s.agentId} className="subagent-row">
              <button className="subagent-item" onClick={() => setOpenId(openId === s.agentId ? null : s.agentId)}>
                <span className={'subagent-dot ' + s.status}>{DOT[s.status] || '·'}</span>
                {s.agentType && <span className="subagent-type">{s.agentType}</span>}
                <span className="subagent-label">{s.label}</span>
                <span className="subagent-meta">{s.counts ? s.counts.total + ' msg' : ''}</span>
              </button>
              {openId === s.agentId && detail && (
                <div className="subagent-timeline">{renderTimeline(detail.timeline || [])}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
