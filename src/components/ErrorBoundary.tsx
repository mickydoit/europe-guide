import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * The app had no error boundary at all, and React 19 unmounts the whole tree on an uncaught
 * render error — leaving an empty #root: a dead screen with nothing to tap, recoverable only by
 * force-quitting the PWA. The reachable trigger is the lazily imported Map screen: a new service
 * worker claims an already-open app immediately (skipWaiting + clientsClaim) and
 * cleanupOutdatedCaches drops the previous hashed chunks, so a tab left open across a deploy
 * asks for a Map-<hash>.js that no longer exists and the dynamic import rejects.
 *
 * A reload is the honest remedy for that: the fresh document picks up the current bundle.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; onReload?: () => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('screen crashed', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="screen">
        <p className="caption">Something went wrong on this screen.</p>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => (this.props.onReload ?? (() => location.reload()))()}
        >
          Reload the app
        </button>
      </main>
    )
  }
}
