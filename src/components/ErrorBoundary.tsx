import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * React unmounts the entire tree on any uncaught render/effect error, and
 * with nothing catching it, that leaves a blank `<div id="root">` — which
 * in a WebView with a dark system background reads as the app just turning
 * black, with no way back in and nothing in the UI to say why. This turns
 * that dead end into a visible message (the real error, so it's actually
 * diagnosable next time) plus a reload button.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught error in app tree:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-crash">
          <p className="app-crash-title">Something went wrong.</p>
          <p className="app-crash-message">{this.state.error.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
