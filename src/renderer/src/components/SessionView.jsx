import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { formatTokens, totalTokens, modelLabel, modelContext, projectName } from '../lib/format'
import { estimateCost, formatUSD } from '../lib/pricing'
import { insertTemplate, nextPlaceholderRange } from '../lib/templates'
import { emptyQueue, enqueue, dequeue, size as queueSize } from '../lib/composerQueue'
import UsageBar from './UsageBar'
import SlashMenu from './SlashMenu'
import PromptMenu from './PromptMenu'
import Lightbox from './Lightbox'
import SubagentPanel from './SubagentPanel'
import TimelineItem from './TimelineItem'
import FilesTouched from './FilesTouched'
import { collectFilesTouched } from '../lib/filesTouched'
import { Virtuoso } from 'react-virtuoso'

function duration(start, end) {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (Number.isNaN(ms) || ms <= 0) return null
  const m = Math.round(ms / 60000)
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  return h + 'h ' + (m % 60) + 'm'
}

function friendlyError(err) {
  if (!err) return 'Send failed.'
  if (/No conversation found/i.test(err)) {
    return "Couldn't resume this session. It's likely running live right now — you can't message an in-progress session (e.g. the one you're chatting in elsewhere). Open a past session to continue it."
  }
  return err
}

export default function SessionView({ detail, loading, sendState, sendError, onSend, newChat, onPickFolder, scrollTarget }) {
  const virtuosoRef = useRef(null)
  const autoFollow = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const [flashIdx, setFlashIdx] = useState(null)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(null)
  const [commands, setCommands] = useState([])
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [slashHint, setSlashHint] = useState(null)
  const [prompts, setPrompts] = useState([])
  const [promptIndex, setPromptIndex] = useState(0)
  const [promptDismissed, setPromptDismissed] = useState(false)
  const [queue, setQueue] = useState(emptyQueue())
  const lastSent = useRef(null)
  const composerRef = useRef(null)
  const seededDraftFor = useRef(null)
  const [lightbox, setLightbox] = useState(null)
  const [attachment, setAttachment] = useState(null) // { file, name }
  const [subOpenId, setSubOpenId] = useState(null)
  const [subList, setSubList] = useState([])
  const [mainView, setMainView] = useState('timeline')
  const fileInputRef = useRef(null)
  const prevSession = useRef(null)
  const consumedScrollKey = useRef(null)
  const totalAtSend = useRef(0)

  const timelineLen = detail && detail.timeline ? detail.timeline.length : 0
  const sessionId = detail && detail.sessionId
  const totalCount = detail && detail.counts ? detail.counts.total : 0

  const scrollToBottom = () => {
    virtuosoRef.current && virtuosoRef.current.scrollToIndex({ index: 'LAST', behavior: 'auto' })
  }

  // Auto-scroll: snap to bottom on a new session, or on growth while following.
  useEffect(() => {
    if (!detail || detail.ok === false) return
    if (sessionId !== prevSession.current) {
      prevSession.current = sessionId
      const pendingJump = scrollTarget != null && consumedScrollKey.current !== scrollTarget.key
      autoFollow.current = !pendingJump
      setShowJump(false)
      // wait a frame for the DOM to paint the (possibly long) timeline —
      // unless a search jump is about to scroll to its own target.
      if (!pendingJump) requestAnimationFrame(scrollToBottom)
    } else if (autoFollow.current) {
      requestAnimationFrame(scrollToBottom)
    }
  }, [sessionId, timelineLen, pending, sendState, detail])

  // Clear the optimistic bubble once the real turn has landed.
  useEffect(() => {
    if (pending != null && totalCount > totalAtSend.current) setPending(null)
  }, [totalCount, pending])

  // Scroll to a specific timeline index and briefly flash it.
  // scrollTarget = { idx, key, sessionId } — runs when the target changes AND
  // re-runs when detail finishes loading (jumping into a not-yet-open session
  // used to bail silently on the loading early-return). consumedScrollKey
  // stops live appends from re-scrolling an already-consumed target; the
  // sessionId check stops a stale never-consumed target (failed open, user
  // switched sessions mid-load) from firing on the wrong session.
  useEffect(() => {
    if (scrollTarget == null || scrollTarget.idx == null) return
    if (consumedScrollKey.current === scrollTarget.key) return
    if (!detail || detail.ok === false) return // wait for load; deps re-run us
    if (scrollTarget.sessionId && detail.sessionId !== scrollTarget.sessionId) return
    if (!virtuosoRef.current) return
    consumedScrollKey.current = scrollTarget.key
    autoFollow.current = false
    setShowJump(false)
    virtuosoRef.current.scrollToIndex({ index: scrollTarget.idx, align: 'center', behavior: 'smooth' })
    setFlashIdx(scrollTarget.idx)
    const timer = setTimeout(() => setFlashIdx(null), 900)
    return () => clearTimeout(timer)
  }, [scrollTarget, detail]) // eslint-disable-line react-hooks/exhaustive-deps

  // Slash commands are cwd-dependent (project commands), so refetch per session.
  useEffect(() => {
    if (!detail || detail.ok === false) return
    const cwd = detail.firstCwd || detail.cwd
    window.flux.commands.list(cwd).then((res) => {
      if (res && res.ok) setCommands(res.commands)
    })
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load saved prompts once; they change rarely so a single load is enough.
  useEffect(() => {
    window.flux.prompts.list().then((res) => {
      if (res && res.ok) setPrompts(res.prompts)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Seed the composer once when the palette launches a new chat with a prefilled prompt.
  useEffect(() => {
    if (newChat && newChat.draft && seededDraftFor.current !== newChat) {
      seededDraftFor.current = newChat
      setDraft(newChat.draft)
    }
  }, [newChat])

  // Menu shows while the draft is just "/name-being-typed" (no whitespace yet).
  const slashFilter = /^\/\S*$/.test(draft) ? draft : null
  const slashItems =
    slashFilter && !slashDismissed
      ? commands.filter((c) => c.name.startsWith(slashFilter)).slice(0, 8)
      : []
  const slashSel = Math.max(0, Math.min(slashIndex, slashItems.length - 1))

  // Prompt menu: ";;" at a word boundary (start-of-line or preceded by whitespace)
  // followed by optional search text (no whitespace). Capture the trigger position.
  // /(^|\s);;(\S*)$/ matches ";;" preceded by nothing or whitespace, optionally
  // followed by a search prefix. m[1] = leading space (or ''), m[2] = search text.
  const promptTrigger = (() => {
    const m = /(^|\s);;(\S*)$/.exec(draft)
    if (!m) return null
    return { query: m[2], triggerStart: draft.length - 2 - m[2].length }
  })()
  const promptItems =
    promptTrigger && !promptDismissed
      ? prompts
          .filter((p) => !promptTrigger.query || p.name.toLowerCase().includes(promptTrigger.query.toLowerCase()))
          .slice(0, 8)
      : []
  const promptSel = Math.max(0, Math.min(promptIndex, promptItems.length - 1))

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

  const promptTriggerKey = promptTrigger ? promptTrigger.triggerStart : null

  // Reset prompt menu when the trigger start position changes (new ";;" typed).
  useEffect(() => {
    setPromptIndex(0)
    setPromptDismissed(false)
  }, [promptTriggerKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const completePrompt = useCallback(
    (p) => {
      if (!promptTrigger) return
      // Record the use and update local list
      window.flux.prompts.used(p.id)
      setPrompts((prev) => prev.map((x) => (x.id === p.id ? { ...x, uses: (x.uses || 0) + 1 } : x)))
      // Insert template into draft, replacing ";;" trigger
      const result = insertTemplate(draft, promptTrigger.triggerStart, p.body)
      setDraft(result.value)
      setPromptIndex(0)
      // Focus and set selection after React re-renders
      requestAnimationFrame(() => {
        const el = composerRef.current
        if (el) {
          el.focus()
          el.setSelectionRange(result.selectionStart, result.selectionEnd)
        }
      })
    },
    [draft, promptTrigger] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const jumpToLatest = () => {
    autoFollow.current = true
    setShowJump(false)
    virtuosoRef.current && virtuosoRef.current.scrollToIndex({ index: 'LAST', behavior: 'smooth' })
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
    if (!text && !attachment) return
    const display = text || '🖼 (image)'
    let msg = text
    if (attachment) {
      msg = (text ? text + '\n\n' : '') + '[The user attached an image. Read this file to view it: ' + attachment.file + ']'
    }
    setDraft('')
    setAttachment(null)
    if (sendState === 'running') {
      setQueue((q) => enqueue(q, JSON.stringify({ msg, display }))) // queued; flushed when the turn ends
      return
    }
    totalAtSend.current = totalCount
    setPending(display)
    lastSent.current = msg
    autoFollow.current = true
    setShowJump(false)
    onSend(msg)
  }

  // When a turn finishes, send the next queued message. On error, put the failed
  // message back in the composer instead of losing it.
  useEffect(() => {
    if (sendState === 'running') return
    if (sendState === 'error' && lastSent.current && !draft.trim()) {
      setDraft(lastSent.current)
      lastSent.current = null
      return
    }
    if (queueSize(queue) > 0 && sendState !== 'error') {
      const { state, msg: entry } = dequeue(queue)
      const { msg, display } = JSON.parse(entry)
      setQueue(state)
      totalAtSend.current = totalCount
      setPending(display) // show user-friendly text, not the raw file path
      lastSent.current = msg
      autoFollow.current = true
      onSend(msg)
    }
  }, [sendState]) // eslint-disable-line react-hooks/exhaustive-deps

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

    if (promptItems.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setPromptIndex((i) => Math.min(i + 1, promptItems.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setPromptIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        completePrompt(promptItems[promptSel])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setPromptDismissed(true)
        return
      }
    }

    // Tab cycles to the next {{placeholder}} in the draft when the menu is closed.
    if (e.key === 'Tab' && !slashItems.length && !promptItems.length) {
      const el = composerRef.current
      if (el) {
        const range = nextPlaceholderRange(draft, el.selectionEnd)
        if (range) {
          e.preventDefault()
          requestAnimationFrame(() => {
            el.focus()
            el.setSelectionRange(range.start, range.end)
          })
          return
        }
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function VirtuosoFooter() {
    return (
      <>
        {pending && (
          <div className="tl-item tl-user tl-pending">
            <div className="tl-gutter"><span className="tl-label">You</span></div>
            <div className="tl-body"><div className="tl-text">{pending}</div></div>
          </div>
        )}
        {sendState === 'running' && (
          <div className="tl-working"><span className="live-dot" /> claude is working…</div>
        )}
        {sendState === 'error' && <div className="tl-senderror">⚠ {friendlyError(sendError)}</div>}
        {sendState === 'interrupted' && <div className="tl-senderror tl-interrupted">◼ Interrupted</div>}
      </>
    )
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const virtuosoComponents = useMemo(() => ({ Footer: VirtuosoFooter }), [pending, sendState, sendError])

  const subByToolUseId = useMemo(() => {
    const m = {}
    for (const s of subList) if (s.toolUseId) m[s.toolUseId] = s.agentId
    return m
  }, [subList])
  const onOpenSubagent = useCallback((agentId) => setSubOpenId(agentId), [])

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
          composerRef={composerRef}
          draft={draft}
          setDraft={setDraft}
          onKeyDown={onKeyDown}
          onSubmit={submit}
          sendState={sendState}
          queued={queueSize(queue)}
          slashItems={slashItems}
          slashSel={slashSel}
          completeSlash={completeSlash}
          slashHint={slashHint}
          promptItems={promptItems}
          promptSel={promptSel}
          completePrompt={completePrompt}
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

  const filesCount = (detail.timeline ? collectFilesTouched(detail.timeline) : []).length

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

        <div className="sv-viewtoggle">
          <button className={mainView === 'timeline' ? 'active' : ''} onClick={() => setMainView('timeline')}>Timeline</button>
          <button className={mainView === 'files' ? 'active' : ''} onClick={() => setMainView('files')}>Files ({filesCount})</button>
        </div>
      </div>

      {detail.file && (
        <SubagentPanel
          file={detail.file}
          live={false}
          openId={subOpenId}
          onOpenId={setSubOpenId}
          onList={setSubList}
          renderTimeline={(items) => items.map((item, i) => <TimelineItem key={i} item={item} onImage={setLightbox} />)}
        />
      )}

      {mainView === 'files' ? (
        <div className="sv-timeline-wrap">
          <FilesTouched timeline={detail.timeline} />
        </div>
      ) : (
        <div className="sv-timeline-wrap">
          <Virtuoso
            ref={virtuosoRef}
            className="sv-timeline"
            data={detail.timeline || []}
            followOutput={(atBottom) => (autoFollow.current && atBottom ? 'smooth' : false)}
            atBottomStateChange={(atBottom) => {
              autoFollow.current = atBottom
              setShowJump(!atBottom)
            }}
            itemContent={(i, item) => (
              <TimelineItem item={item} onImage={setLightbox} flash={i === flashIdx} subByToolUseId={subByToolUseId} onOpenSubagent={onOpenSubagent} />
            )}
            components={virtuosoComponents}
          />

          {showJump && (
            <button className="jump-latest" onClick={jumpToLatest} title="Jump to latest">
              ↓
            </button>
          )}
        </div>
      )}

      <Composer
        composerRef={composerRef}
        draft={draft}
        setDraft={setDraft}
        onKeyDown={onKeyDown}
        onSubmit={submit}
        sendState={sendState}
        queued={queueSize(queue)}
        slashItems={slashItems}
        slashSel={slashSel}
        completeSlash={completeSlash}
        slashHint={slashHint}
        promptItems={promptItems}
        promptSel={promptSel}
        completePrompt={completePrompt}
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

function Composer({ composerRef, draft, setDraft, onKeyDown, onSubmit, sendState, queued, slashItems, slashSel, completeSlash, slashHint, promptItems, promptSel, completePrompt, attachment, setAttachment, fileInputRef, stashImage, onPaste }) {
  return (
    <div className="sv-composer">
      <button
        className="composer-attach"
        title="Attach image"
        onClick={() => fileInputRef.current && fileInputRef.current.click()}
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
        {queued > 0 && <div className="composer-queued">{queued} queued</div>}
        {slashHint && <div className="slash-hint">{slashHint}</div>}
        {slashItems.length > 0 && (
          <SlashMenu items={slashItems} selected={slashSel} onPick={completeSlash} />
        )}
        {promptItems.length > 0 && (
          <PromptMenu items={promptItems} selected={promptSel} onPick={completePrompt} />
        )}
        <textarea
          ref={composerRef}
          className="composer-input"
          placeholder="Message this session…  (Enter to send · Shift+Enter for newline · / for commands · ;; for prompts · paste images)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={1}
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
