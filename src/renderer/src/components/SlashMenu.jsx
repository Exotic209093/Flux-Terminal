// Autocomplete dropdown for slash commands, rendered above the composer.
// onMouseDown (not onClick) so picking an item doesn't blur the textarea.
// Interactive-only commands get a "terminal" badge; picking one is handled by
// the parent (it shows a hint instead of sending).
export default function SlashMenu({ items, selected, onPick }) {
  if (!items.length) return null
  return (
    <div className="slash-menu">
      {items.map((c, i) => (
        <button
          key={c.name + ':' + c.source}
          className={'slash-item' + (i === selected ? ' selected' : '')}
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(c)
          }}
        >
          <span className="slash-name">{c.name}</span>
          <span className="slash-desc">{c.description}</span>
          {c.interactive ? (
            <span className="slash-badge" title="Interactive command — run it in the Terminal tab">
              terminal
            </span>
          ) : (
            <span className={'slash-src slash-src-' + c.source}>{c.source}</span>
          )}
        </button>
      ))}
    </div>
  )
}
