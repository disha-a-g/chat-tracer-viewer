import { useState } from 'react'
import type { TraceIssue } from '../types'

interface IssuesBannerProps {
  issues: TraceIssue[]
}

export function IssuesBanner({ issues }: IssuesBannerProps) {
  const [expanded, setExpanded] = useState(false)
  if (issues.length === 0) return null

  const errorCount = issues.filter((i) => i.severity === 'error').length
  const warningCount = issues.length - errorCount
  const tone = errorCount > 0 ? 'border-red-500/30 bg-red-950/20 text-red-300' : 'border-amber-400/30 bg-amber-950/10 text-amber-300'

  return (
    <div className={`border-b px-4 py-2 text-xs ${tone}`}>
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
        <span>
          {errorCount > 0 && `${errorCount} error${errorCount === 1 ? '' : 's'}`}
          {errorCount > 0 && warningCount > 0 && ', '}
          {warningCount > 0 && `${warningCount} warning${warningCount === 1 ? '' : 's'}`}
          {' while normalizing this trace — a partially-readable trace beats an error page.'}
        </span>
        <span>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <ul className="mt-2 space-y-1">
          {issues.map((issue, i) => (
            <li key={i} className="flex gap-2">
              <span className="uppercase opacity-70">{issue.severity}</span>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
