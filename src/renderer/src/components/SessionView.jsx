import { useEffect, useRef, useState } from 'react'
import { formatTokens, totalTokens, modelLabel, modelContext, projectName } from '../lib/format'
import { estimateCost, formatUSD } from '../lib/pricing'
import UsageBar from './UsageBar'
import SlashMenu from './SlashMenu'
import Lightbox from './Lightbox'

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
  tool_result: 'Result',
  image: 'Image'
}

function friendlyError(err) {
  if (!err) return 'Send failed.'
  if (/No conversation found/i.test(err)) {
    return "Couldn't resume this session. It's likely running live right now — you can't message an in-progress session (e.g. the one you're chatting in elsewhere). Open a past session to continue it."
  }
  return err
}

function TimelineItem({ item, onImage }) {
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
        ) : item.kind === 'image' ? (
          item.truncated ? (
            <div className="tl-img-omitted">🖼 image omitted (too large)</div>
          ) : (
            <img
              className="tl-img"
              src={`data:${item.mediaType};base64,${item.data}`}
              alt="session image"
              onClick={() => onImage && onImage(item)}
            />
          )
        ) : (
          <div className="tl-text">{item.text}</div>
        )}
      </div>
    </div>
  )
}

export default function SessionView({ detail, loading, sendState, sendError, onSend, newChat, onPickFolder }) {
  const scrollRef = useRef(null)
  const autoFollow = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(null)
  const [commands, setCommands] = useState([])
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [slashHint, setSlashHint] = useState(null)
  const [lightbox, setLightbox] = useState(null)
  const [attachment, setAttachment] = useState(null) // { file, name }
  const fileInputRef = useRef(null)
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

  // Slash commands are cwd-dependent (project commands), so refetch per session.
  useEffect(() => {
    if (!detail || detail.ok === false) return
    const cwd = detail.firstCwd || detail.cwd
    window.flux.commands.list(cwd).then((res) => {
      if (res && res.ok) setCommands(res.commands)
    })
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Menu shows while the draft is just "/name-being-typed" (no whitespace yet).
  const slashFilter = /^\/\S*$/.test(draft) ? draft : null
  const slashItems =
    slashFilter && !slashDismissed
      ? commands.filter((c) => c.name.startsWith(slashFilter)).slice(0, 8)
      : []
  const slashSel = Math.max(0, Math.min(slashIndex, slashItems.length - 1))

  const completeSlash = (c) => {
    if (c.interactive) {
      // No-op via `claude -p`; tell the user where it actually works.
      const where =
        c.name === '/model'
          ? 'Use the model picker in the top bar.'
          : c.name === '/remote-control'
            ? 'Use the Remote toggle in the top bar.'
            : 'Run this in the Terminal tab — it only works in a live session.'
      setSlashHint(`${c.name} is a terminal command. ${where}`)
      setSlashIndex(0)
      return
    }
    setSlashHint(null)
    setDraft(c.name + ' ')
    setSlashIndex(0)
  }

  // Reset selection/dismissal when the filter changes.
  useEffect(() => {
    setSlashIndex(0)
    setSlashDismissed(false)
    setSlashHint(null)
  }, [slashFilter]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Read an image File/Blob → base64 → stash to a temp file via main process.
  const stashImage = (fileObj) => {
    const reader = new FileReader()
    reader.onload = () => {
      const data = String(reader.result).split(',')[1]
      window.flux.image.stash({ data, mediaType: fileObj.type || 'image/png' }).then((res) => {
        if (res && res.ok) setAttachment({ file: res.file, name: fileObj.name || 'pasted image' })
      })
    }
    reader.readAsDataURL(fileObj)
  }

  const onPaste = (e) => {
    for (const it of e.clipboardData.items) {
      if (it.type.startsWith('image/')) {
        e.preventDefault()
        const f = it.getAsFile()
        if (f) stashImage(f)
        return
      }
    }
  }

  const submit = () => {
    const text = draft.trim()
    if ((!text && !attachment) || sendState === 'running') return
    let msg = text
    if (attachment) {
      msg =
        (text ? text + '\n\n' : '') +
        '[The user attached an image. Read this file to view it: ' + attachment.file + ']'
    }
    totalAtSend.current = totalCount
    setPending(text || '🖼 (image)')
    setDraft('')
    setAttachment(null)
    autoFollow.current = true
    setShowJump(false)
    onSend(msg)
  }

  const onKeyDown = (e) => {
    if (slashItems.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex((i) => Math.min(i + 1, slashItems.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        completeSlash(slashItems[slashSel])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashDismissed(true)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  if (loading) return <div className="sv-empty">Loading session…</div>
  if (!detail && !newChat) return <div className="sv-empty">Select a session to relive it.</div>
  if (detail && detail.ok === false) return <div className="sv-empty error">⚠ {detail.error}</div>

  if (newChat && !detail) {
    return (
      <div className="session-view">
        <div className="sv-header">
          <h2 className="sv-title">New chat</h2>
          <div className="sv-sub">
            <span className="sv-project">{newChat.cwd || 'home folder'}</span>
            <button className="folder-pick" onClick={onPickFolder} title="Choose working folder">
              📁 choose folder
            </button>
          </div>
        </div>
        <div className="sv-timeline-wrap">
          <div className="sv-timeline">
            <div className="sv-empty">Type a message to start a new chat with the selected model.</div>
            {sendState === 'running' && (
              <div className="tl-working">
                <span className="live-dot" /> claude is working…
              </div>
            )}
            {sendState === 'error' && <div className="tl-senderror">⚠ {sendError}</div>}
            {sendState === 'interrupted' && <div className="tl-senderror tl-interrupted">◼ Interrupted</div>}
          </div>
        </div>
        <Composer
          draft={draft}
          setDraft={setDraft}
          onKeyDown={onKeyDown}
          onSubmit={submit}
          sendState={sendState}
          slashItems={slashItems}
          slashSel={slashSel}
          completeSlash={completeSlash}
          slashHint={slashHint}
          attachment={attachment}
          setAttachment={setAttachment}
          fileInputRef={fileInputRef}
          stashImage={stashImage}
          onPaste={onPaste}
        />
      </div>
    )
  }

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

        <UsageBar detailed />

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
            <TimelineItem key={i} item={item} onImage={setLightbox} />
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
          {sendState === 'error' && <div className="tl-senderror">⚠ {friendlyError(sendError)}</div>}
          {sendState === 'interrupted' && <div className="tl-senderror tl-interrupted">◼ Interrupted</div>}
        </div>

        {showJump && (
          <button className="jump-latest" onClick={jumpToLatest} title="Jump to latest">
            ↓
          </button>
        )}
      </div>

      <Composer
        draft={draft}
        setDraft={setDraft}
        onKeyDown={onKeyDown}
        onSubmit={submit}
        sendState={sendState}
        slashItems={slashItems}
        slashSel={slashSel}
        completeSlash={completeSlash}
        slashHint={slashHint}
        attachment={attachment}
        setAttachment={setAttachment}
        fileInputRef={fileInputRef}
        stashImage={stashImage}
        onPaste={onPaste}
      />
      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />
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

function Composer({ draft, setDraft, onKeyDown, onSubmit, sendState, slashItems, slashSel, completeSlash, slashHint, attachment, setAttachment, fileInputRef, stashImage, onPaste }) {
  return (
    <div className="sv-composer">
      <button
        className="composer-attach"
        title="Attach image"
        onClick={() => fileInputRef.current && fileInputRef.current.click()}
        disabled={sendState === 'running'}
      >
        📎
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files && e.target.files[0]
          if (f) stashImage(f)
          e.target.value = ''
        }}
      />
      <div className="composer-mid">
        {attachment && (
          <div className="composer-chip">
            🖼 {attachment.name}
            <button className="chip-x" onClick={() => setAttachment(null)} title="Remove attachment">
              ✕
            </button>
          </div>
        )}
        {slashHint && <div className="slash-hint">{slashHint}</div>}
        {slashItems.length > 0 && (
          <SlashMenu items={slashItems} selected={slashSel} onPick={completeSlash} />
        )}
        <textarea
          className="composer-input"
          placeholder="Message this session…  (Enter to send · Shift+Enter for newline · / for commands · paste images)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={1}
          disabled={sendState === 'running'}
        />
      </div>
      {sendState === 'running' ? (
        <button className="composer-stop" onClick={() => window.flux.sessions.interrupt()} title="Stop">
          ◼ Stop
        </button>
      ) : (
        <button
          className="composer-send"
          onClick={onSubmit}
          disabled={!draft.trim() && !attachment}
        >
          Send
        </button>
      )}
    </div>
  )
}
