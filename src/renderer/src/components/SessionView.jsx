import { useEffect, useRef, useState } from 'react'
import { formatTokens, totalTokens, modelLabel, modelContext, projectName } from '../lib/format'
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

export default function SessionView({ detail, loading, sendState, sendError, onSend }) {
  const scrollRef = useRef(null)
  const autoFollow = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(null)
  const prevSession = useRef(null)
  const totalAtSend = useRef(0)

  const timelineLen = detail && detail.timeline ? detail.timeline.length : 0
  const sessionId = detail && detail.sessionId
  const totalCount = detail && detail.counts ? detail.counts.total : 0

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // Auto-scroll: snap to bottom on a new session, or on growth while following.
  useEffect(() => {
    if (!detail || detail.ok === false) return
    if (sessionId !== prevSession.current) {
      prevSession.current = sessionId
      autoFollow.current = true
      setShowJump(false)
      // wait a frame for the DOM to paint the (possibly long) timeline
      requestAnimationFrame(scrollToBottom)
    } else if (autoFollow.current) {
      requestAnimationFrame(scrollToBottom)
    }
  }, [sessionId, timelineLen, pending, sendState, detail])

  // Clear the optimistic bubble once the real turn has landed.
  useEffect(() => {
    if (pending != null && totalCount > totalAtSend.current) setPending(null)
  }, [totalCount, pending])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distance < 80
    autoFollow.current = atBottom
    setShowJump(!atBottom)
  }

  const jumpToLatest = () => {
    autoFollow.current = true
    setShowJump(false)
    scrollToBottom()
  }

  const submit = () => {
    const msg = draft.trim()
    if (!msg || sendState === 'running') return
    totalAtSend.current = totalCount
    setPending(msg)
    setDraft('')
    autoFollow.current = true
    setShowJump(false)
    onSend(msg)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  if (loading) return <div className="sv-empty">Loading session…</div>
  if (!detail) return <div className="sv-empty">Select a session to relive it.</div>
  if (detail.ok === false) return <div className="sv-empty error">⚠ {detail.error}</div>

  const usage = detail.usage
  const cost = estimateCost(usage, detail.models && detail.models[0])
  const dur = duration(detail.firstTimestamp, detail.lastTimestamp)

  const ctx = detail.lastContextTokens || 0
  const maxCtx = modelContext(detail.models && detail.models[0])
  const ctxPct = Math.min(100, Math.round((ctx / maxCtx) * 100))

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

        <div className="sv-context" title={`${ctx.toLocaleString()} of ${maxCtx.toLocaleString()} tokens`}>
          <div className="sv-context-top">
            <span className="sv-context-label">Context window</span>
            <span className={'sv-context-pct' + (ctxPct >= 80 ? ' hot' : '')}>
              {ctxPct}% · {formatTokens(ctx)} / {formatTokens(maxCtx)}
            </span>
          </div>
          <div className="ctx-bar">
            <span className={ctxPct >= 80 ? 'ctx-fill hot' : 'ctx-fill'} style={{ width: ctxPct + '%' }} />
          </div>
        </div>

        <div className="sv-stats">
          <Stat label="Messages" value={detail.counts.total} />
          <Stat label="Tools used" value={detail.counts.toolUse} />
          <Stat label="Total tokens" value={formatTokens(totalTokens(usage))} />
          <Stat label="Est. cost" value={formatUSD(cost.total)} accent />
        </div>
      </div>

      <div className="sv-timeline-wrap">
        <div className="sv-timeline" ref={scrollRef} onScroll={onScroll}>
          {(detail.timeline || []).map((item, i) => (
            <TimelineItem key={i} item={item} />
          ))}
          {pending && (
            <div className="tl-item tl-user tl-pending">
              <div className="tl-gutter">
                <span className="tl-label">You</span>
              </div>
              <div className="tl-body">
                <div className="tl-text">{pending}</div>
              </div>
            </div>
          )}
          {sendState === 'running' && (
            <div className="tl-working">
              <span className="live-dot" /> claude is working…
            </div>
          )}
          {sendState === 'error' && <div className="tl-senderror">⚠ {sendError || 'send failed'}</div>}
        </div>

        {showJump && (
          <button className="jump-latest" onClick={jumpToLatest} title="Jump to latest">
            ↓
          </button>
        )}
      </div>

      <div className="sv-composer">
        <textarea
          className="composer-input"
          placeholder="Message this session…  (Enter to send · Shift+Enter for newline)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={sendState === 'running'}
        />
        <button
          className="composer-send"
          onClick={submit}
          disabled={sendState === 'running' || !draft.trim()}
        >
          {sendState === 'running' ? '…' : 'Send'}
        </button>
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
