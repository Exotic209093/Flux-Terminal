import { useState, useEffect } from 'react'

export default function AboutSection() {
  const [version, setVersion] = useState('')
  useEffect(() => { window.flux.app.version().then(setVersion).catch(() => setVersion('unknown')) }, [])
  return (
    <div>
      <div className="set-h">About</div>
      <div className="set-sub">Flux Terminal — a desktop home for Claude Code sessions.</div>
      <div className="set-row">
        <div className="set-row-l"><span className="set-row-name">Version</span></div>
        <span className="set-row-desc">{version || '…'}</span>
      </div>
      <div className="set-row">
        <div className="set-row-l"><span className="set-row-name">Repository</span></div>
        <span className="set-row-desc">github.com/Exotic209093/Flux-Terminal</span>
      </div>
    </div>
  )
}
