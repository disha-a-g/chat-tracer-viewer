import { useMemo, useState } from 'react'
import type { NormalizedTrace, ToolCall } from '../types'
import { formatDuration, formatTokenCount } from '../lib/format'
import { stepStatus, type StatFilterKey, type StepStatus } from '../lib/stepVisuals'
import { Section } from './Section'
import { Chip } from './Chip'
import type { ChipTone } from './Chip'

interface StatsBarProps {
  trace: NormalizedTrace
  toolCallByStepId: Map<string, ToolCall>
  activeFilter: StatFilterKey | null
  onToggleFilter: (key: StatFilterKey) => void
}

const STATUS_TONE: Record<StepStatus, ChipTone> = {
  error: 'error',
  warning: 'warning',
  success: 'success',
  neutral: 'neutral',
}

function FilterChip({
  label,
  count,
  statusKey,
  active,
  onClick,
}: {
  label: string
  count: number
  statusKey: StepStatus
  active: boolean
  onClick: () => void
}) {
  return (
    <Chip tone={STATUS_TONE[statusKey]} active={active} onClick={onClick}>
      <span>{label}</span>
      <span>{count}</span>
      {active && <span>×</span>}
    </Chip>
  )
}

export function StatsBar({ trace, toolCallByStepId, activeFilter, onToggleFilter }: StatsBarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { stats } = trace

  const toolNames = useMemo(() => {
    return Array.from(new Set(trace.tool_calls.map((c) => c.tool_name))).sort()
  }, [trace.tool_calls])

  const statusCounts = useMemo(() => {
    const counts: Record<StepStatus, number> = { error: 0, warning: 0, success: 0, neutral: 0 }
    for (const step of trace.steps) counts[stepStatus(step, toolCallByStepId)]++
    return counts
  }, [trace.steps, toolCallByStepId])

  const tokenBreakdown = useMemo(() => {
    const t = stats.tokens
    if (!t) return null
    const parts: string[] = []
    if (t.input !== undefined) parts.push(`in ${formatTokenCount(t.input)}`)
    if (t.output !== undefined) parts.push(`out ${formatTokenCount(t.output)}`)
    if (t.cache_read !== undefined) parts.push(`cache read ${formatTokenCount(t.cache_read)}`)
    if (t.cache_creation !== undefined) parts.push(`cache write ${formatTokenCount(t.cache_creation)}`)
    return parts.join(' · ')
  }, [stats.tokens])

  const summary = [
    `${stats.step_count} step${stats.step_count === 1 ? '' : 's'}`,
    formatDuration(stats.duration_ms) !== '—' ? formatDuration(stats.duration_ms) : null,
    `${stats.tool_call_count} tool call${stats.tool_call_count === 1 ? '' : 's'}`,
    `${stats.error_count} error${stats.error_count === 1 ? '' : 's'}`,
    stats.tokens?.total !== undefined ? `${formatTokenCount(stats.tokens.total)} tokens` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Section title="Stats" collapsed={collapsed} onToggleCollapse={() => setCollapsed((v) => !v)} collapsedSummary={summary}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-neutral-500">Duration</span>
          <span className="font-mono text-neutral-200">{formatDuration(stats.duration_ms)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-neutral-500">Steps</span>
          <span className="font-mono text-neutral-200">{stats.step_count}</span>
        </div>
        <Chip tone="neutral" active={activeFilter === 'toolCalls'} onClick={() => onToggleFilter('toolCalls')}>
          <span className="text-neutral-500">Tool calls</span>
          <span>{stats.tool_call_count}</span>
        </Chip>
        <Chip tone="error" active={activeFilter === 'statusError'} onClick={() => onToggleFilter('statusError')}>
          <span className="text-neutral-500">Errors</span>
          <span>{stats.error_count}</span>
        </Chip>
        {stats.tokens?.total !== undefined && (
          <div className="flex items-center gap-1.5">
            <span className="text-neutral-500">Tokens</span>
            <span className="font-mono text-neutral-200">{formatTokenCount(stats.tokens.total)}</span>
          </div>
        )}
      </div>

      {tokenBreakdown && <p className="text-[11px] text-neutral-600">{tokenBreakdown}</p>}

      {toolNames.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-neutral-500">Tools</span>
          <div className="flex flex-wrap gap-2">
            {toolNames.map((name) => (
              <Chip key={name}>{name}</Chip>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-neutral-800 pt-3">
        <span className="text-xs text-neutral-500">Filter by status</span>
        <div className="flex flex-wrap gap-2">
          <FilterChip
            label="Errors"
            count={statusCounts.error}
            statusKey="error"
            active={activeFilter === 'statusError'}
            onClick={() => onToggleFilter('statusError')}
          />
          <FilterChip
            label="Warnings"
            count={statusCounts.warning}
            statusKey="warning"
            active={activeFilter === 'statusWarning'}
            onClick={() => onToggleFilter('statusWarning')}
          />
          <FilterChip
            label="Success"
            count={statusCounts.success}
            statusKey="success"
            active={activeFilter === 'statusSuccess'}
            onClick={() => onToggleFilter('statusSuccess')}
          />
        </div>
      </div>
    </Section>
  )
}
