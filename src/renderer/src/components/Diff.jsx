// Renders a structuredPatch (array of hunks) as a colored diff. No dep —
// the data is already structured (lines prefixed +/-/space).
export default function Diff({ patch }) {
  if (patch && patch.truncated) return <div className="diff-note">diff too large to show</div>
  if (!Array.isArray(patch) || patch.length === 0) return <div className="diff-note">(no changes)</div>
  return (
    <div className="diff">
      {patch.map((hunk, hi) => (
        <div key={hi} className="diff-hunk">
          <div className="diff-hunk-head">
            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
          </div>
          {(hunk.lines || []).map((line, li) => {
            const c = line[0]
            const cls = c === '+' ? 'diff-add' : c === '-' ? 'diff-del' : 'diff-ctx'
            return (
              <div key={li} className={'diff-line ' + cls}>
                {line || ' '}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
