import { useState } from 'react'
import Diff from './Diff'
import { collectFilesTouched } from '../lib/filesTouched'

function FileRow({ file }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="ft-file">
      <button className="ft-head" onClick={() => setOpen((o) => !o)}>
        <span className="ft-caret">{open ? '▾' : '▸'}</span>
        <span className="ft-path">{file.filePath}</span>
        <span className="ft-stat ft-add">+{file.adds}</span>
        <span className="ft-stat ft-del">-{file.dels}</span>
        <span className="ft-count">{file.edits.length} edit{file.edits.length > 1 ? 's' : ''}</span>
      </button>
      {open && file.edits.map((e, i) => <Diff key={i} patch={e.patch} />)}
    </div>
  )
}

export default function FilesTouched({ timeline }) {
  const files = collectFilesTouched(timeline || [])
  if (!files.length) return <div className="sv-empty">No file edits in this session.</div>
  return (
    <div className="files-touched">
      {files.map((f) => (
        <FileRow key={f.filePath} file={f} />
      ))}
    </div>
  )
}
