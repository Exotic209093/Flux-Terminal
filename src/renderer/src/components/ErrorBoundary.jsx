import { Component } from 'react'

// Reusable boundary. App-level (full fallback) and per-view (inline fallback).
// Forwards caught errors to the main-process crash log via window.flux.app.reportError.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    try {
      window.flux?.app?.reportError?.({
        message: (error && error.message) || String(error),
        stack: (error && error.stack) || '',
        componentStack: (info && info.componentStack) || ''
      })
    } catch {
      /* never let logging break the fallback */
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className={'error-boundary' + (this.props.inline ? ' inline' : '')}>
        <h2>{this.props.title || 'Flux hit a problem'}</h2>
        <p>{this.props.inline ? 'This view failed to render.' : 'The app ran into an unexpected error.'}</p>
        <button onClick={() => location.reload()}>Reload</button>
        <details>
          <summary>Details</summary>
          <pre>{String((this.state.error && this.state.error.stack) || this.state.error)}</pre>
        </details>
      </div>
    )
  }
}
