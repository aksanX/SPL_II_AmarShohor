import { RefreshCw, TriangleAlert } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

/** After a new version is deployed, pages that were split off load from files that no longer exist. */
export function isStaleBundle(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error)
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg)
}

/**
 * Shows "Something went wrong" instead of a blank page when a page crashes while drawing. Without it,
 * one bad value (an issue with a missing field, a browser without some feature) blanks the whole app
 * and the person has no way back but to close the tab.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: unknown }> {
  state = { error: null as unknown }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  // Moving to another page clears the error.
  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack)
  }

  render() {
    if (this.state.error === null) return this.props.children
    const stale = isStaleBundle(this.state.error)
    return (
      <div className="mx-auto max-w-md p-6">
        <div role="alert" className="card space-y-3 p-6 text-center">
          <TriangleAlert className="mx-auto size-10 text-warn" />
          <h1 className="text-lg font-bold">{stale ? 'AmarShohor was updated' : 'Something went wrong'}</h1>
          <p className="text-sm text-muted">
            {stale
              ? 'A new version is out. Reload the page to get it.'
              : 'This page ran into a problem. Your reports and votes are safe. Reload, or go back to the feed.'}
          </p>
          <div className="flex justify-center gap-2">
            <button className="btn-primary" onClick={() => window.location.reload()}>
              <RefreshCw className="size-4" /> Reload
            </button>
            {!stale && <a className="btn-soft" href="/">Go to the feed</a>}
          </div>
        </div>
      </div>
    )
  }
}
