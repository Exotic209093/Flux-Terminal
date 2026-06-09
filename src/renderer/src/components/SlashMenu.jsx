// Autocomplete dropdown for slash commands, rendered above the composer.
// onMouseDown (not onClick) so picking an item doesn't blur the textarea.
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
          <span className={'slash-src slash-src-' + c.source}>{c.source}</span>
        </button>
      ))}
    </div>
  )
}
