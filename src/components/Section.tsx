// The card shell every major panel in the trace-detail view wraps in —
// a contained surface (tint + rounded corners + padding) instead of the
// old "border-bottom only, same background as the page" treatment, so each
// section reads as its own region rather than blending into one dense
// column. Supports both the collapsible panels (Stats, Potential Failure
// Modes) and always-open ones (Reasoning Confidence) with the same shell.

import type { ReactNode } from 'react'

interface SectionProps {
  title: ReactNode
  /** Omit both collapse props for a section that's always open. */
  collapsed?: boolean
  onToggleCollapse?: () => void
  /** Shown next to the title only while collapsed — e.g. "3 modes flagged". */
  collapsedSummary?: ReactNode
  /** Extra header content after the title (e.g. a status badge). */
  headerExtra?: ReactNode
  children: ReactNode
  className?: string
}

export function Section({ title, collapsed, onToggleCollapse, collapsedSummary, headerExtra, children, className = '' }: SectionProps) {
  const collapsible = onToggleCollapse !== undefined
  const isOpen = !collapsed

  return (
    <div className={`rounded-lg border border-neutral-800 bg-neutral-900/40 ${className}`}>
      {collapsible ? (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex w-full items-center justify-between gap-2 rounded-lg px-4 py-3 text-left text-xs text-neutral-400 hover:bg-neutral-900/60"
        >
          <span className="flex items-center gap-2">
            <span className="text-neutral-600">{isOpen ? '▼' : '▶'}</span>
            <span className="font-medium text-neutral-200">{title}</span>
            {headerExtra}
            {!isOpen && collapsedSummary && <span className="text-neutral-500">{collapsedSummary}</span>}
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-2 px-4 py-3 text-xs text-neutral-400">
          <span className="font-medium text-neutral-200">{title}</span>
          {headerExtra}
        </div>
      )}
      {isOpen && <div className="flex flex-col gap-3 px-4 pb-4 pt-1">{children}</div>}
    </div>
  )
}
