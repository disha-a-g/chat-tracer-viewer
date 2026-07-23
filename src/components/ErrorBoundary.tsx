import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/** Last-resort guard against a render crash white-screening the whole app —
 *  e.g. a pathological shape in one trace's raw JSON blowing up the detail
 *  pane. Degrades to a recoverable screen instead of a blank tab. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack)
  }

  // Clears ?trace=/&step= rather than a plain reload, so if a specific
  // trace's data caused the crash, going back doesn't immediately re-open it.
  handleReset = () => {
    window.location.href = window.location.pathname
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-neutral-950 px-6 text-center text-neutral-100">
        <p className="text-sm font-medium">Something went wrong rendering this trace.</p>
        <p className="max-w-md text-xs text-neutral-500">{this.state.error.message}</p>
        <button
          type="button"
          onClick={this.handleReset}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-900"
        >
          Back to landing page
        </button>
      </div>
    )
  }
}
