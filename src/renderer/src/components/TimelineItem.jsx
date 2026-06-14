import { memo, useState } from 'react'
import Markdown from './Markdown'

const KIND_LABEL = {
  user: 'You',
  text: 'Claude',
  thinking: 'Thinking',
  tool_use: 'Tool',
  tool_result: 'Result',
  image: 'Image',
  hook: 'Hook',
  compact: 'Compact'
}

function fmtTs(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function TimelineItemBase({ item, onImage, flash }) {
  const [open, setOpen] = useState(false)
  const cls = 'tl-item tl-' + item.kind + (item.isError ? ' tl-error' : '') + (flash ? ' tl-flash' : '')
  return (
    <div className={cls}>
      <div className="tl-gutter">
        <span className="tl-label">{KIND_LABEL[item.kind] || item.kind}</span>
        {item.ts && <span className="tl-ts">{fmtTs(item.ts)}</span>}
      </div>
      <div className="tl-body">
        {item.kind === 'tool_use' ? (
          <div>
            <span className="tl-tool">{item.toolName}</span>
            {item.toolInput && <pre className="tl-pre">{item.toolInput}</pre>}
          </div>
        ) : item.kind === 'tool_result' ? (
          <pre className="tl-pre tl-dim">{item.text}</pre>
        ) : item.kind === 'thinking' ? (
          <div className="tl-thinking">
            <button className="tl-thinking-toggle" onClick={() => setOpen((o) => !o)}>
              {open ? '▾' : '▸'} thinking
            </button>
            {open && <Markdown text={item.text} />}
          </div>
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
          <Markdown text={item.text} />
        )}
      </div>
    </div>
  )
}

const TimelineItem = memo(TimelineItemBase)
export default TimelineItem
