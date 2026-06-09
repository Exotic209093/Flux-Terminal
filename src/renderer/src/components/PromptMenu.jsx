// Autocomplete dropdown for saved prompt templates, triggered by ";;" at a
// word boundary in the composer. Mirrors SlashMenu's rendering contract.
// onMouseDown (not onClick) so picking an item doesn't blur the textarea.
export default function PromptMenu({ items, selected, onPick }) {
  if (!items.length) return null
  return (
    <div className="slash-menu prompt-menu">
      {items.map((p, i) => (
        <button
          key={p.id}
          className={'slash-item' + (i === selected ? ' selected' : '')}
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(p)
          }}
        >
          <span className="slash-name">{p.name}</span>
          <span className="slash-desc prompt-body-preview">{p.body}</span>
          {p.uses > 0 && <span className="prompt-uses">{p.uses}×</span>}
        </button>
      ))}
    </div>
  )
}
