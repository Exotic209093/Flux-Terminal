import { useState, useEffect } from 'react'

function Row({ ok, label, detail }) {
  return (
    <div className={'welcome-row ' + (ok ? 'ok' : 'warn')}>
      <span className="welcome-check">{ok ? '✓' : '!'}</span>
      <span>
        {label}
        {detail ? ' — ' + detail : ''}
      </span>
    </div>
  )
}

export default function WelcomeScreen({ onDismiss, onLaunch, onBrowse }) {
  const [env, setEnv] = useState(null)
  useEffect(() => {
    let live = true
    window.flux.env.doctor().then((r) => {
      if (live) setEnv(r && r.ok ? r.env : null)
    })
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="welcome-overlay">
      <div className="welcome-card">
        <h1>Welcome to Flux</h1>
        {!env && <div className="welcome-row">Checking your environment...</div>}
        {env && (
          <>
            <Row ok={env.cli.found} label="claude CLI" detail={env.cli.found ? env.cli.version : 'not found on PATH'} />
            <Row ok={env.loggedIn} label="Logged in" detail={env.loggedIn ? null : 'run claude once to sign in'} />
            <Row ok={env.sessionCount > 0} label="Sessions found" detail={String(env.sessionCount)} />
            {!env.cli.found && (
              <div className="welcome-install">
                Install: <code>npm install -g @anthropic-ai/claude-code</code>
              </div>
            )}
          </>
        )}
        <div className="welcome-actions">
          <button className="welcome-primary" onClick={onLaunch}>
            Launch your first claude session
          </button>
          <button onClick={onBrowse}>Browse a folder to start in</button>
          <button className="welcome-skip" onClick={onDismiss}>
            Get started
          </button>
        </div>
      </div>
    </div>
  )
}
