import type { Step, ToolCall } from '../types'

export type StepStatus = 'success' | 'error' | 'warning' | 'neutral'

const LOW_CONFIDENCE_THRESHOLD = 0.4

const TYPE_LABEL: Record<Step['type'], string> = {
  user: 'USER',
  assistant: 'ASST',
  tool_use: 'TOOL',
  tool_result: 'RSLT',
  thinking: 'THNK',
  error: 'ERR',
}

export function stepLabel(step: Step): string {
  return TYPE_LABEL[step.type]
}

/** Status drives the color coding: green success, red error, yellow
 *  warning/low-confidence, gray neutral (per ideas.md/Block 2 spec). Tool_use
 *  status is looked up from the joined ToolCall since the step itself
 *  doesn't know whether its result succeeded. */
export function stepStatus(step: Step, toolCallByStepId: Map<string, ToolCall>): StepStatus {
  if (step.error) return 'error'

  if (step.type === 'tool_use') {
    const call = toolCallByStepId.get(step.id)
    if (call?.status === 'error') return 'error'
    if (call?.status === 'ok') return 'success'
    return 'neutral'
  }

  if (step.confidence && step.confidence.value < LOW_CONFIDENCE_THRESHOLD) return 'warning'

  if (step.type === 'tool_result') return 'success'
  if (step.type === 'assistant' || step.type === 'thinking') return 'success'
  return 'neutral'
}

const STATUS_CLASSES: Record<StepStatus, { border: string; badge: string; ring: string }> = {
  success: {
    border: 'border-l-emerald-500/70',
    badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    ring: 'focus-visible:ring-emerald-500/50',
  },
  error: {
    border: 'border-l-red-500/70',
    badge: 'bg-red-500/10 text-red-300 border-red-500/30',
    ring: 'focus-visible:ring-red-500/50',
  },
  warning: {
    border: 'border-l-amber-400/70',
    badge: 'bg-amber-400/10 text-amber-300 border-amber-400/30',
    ring: 'focus-visible:ring-amber-400/50',
  },
  neutral: {
    border: 'border-l-neutral-700',
    badge: 'bg-neutral-800 text-neutral-300 border-neutral-700',
    ring: 'focus-visible:ring-neutral-500/50',
  },
}

export function statusClasses(status: StepStatus): { border: string; badge: string; ring: string } {
  return STATUS_CLASSES[status]
}

/** Stat-bar filter keys. 'toolCalls' mirrors the canonical TraceStats
 *  counter (tool_call_count) so its row count always matches the number it
 *  was clicked from. 'status*' filter on the same red/amber/green coloring
 *  the timeline uses (lib/stepVisuals.stepStatus) — TraceStats.error_count
 *  is computed the same way, so "Errors" here and in the stats bar always
 *  agree (see adapters/finalize.ts computeStats). */
export type StatFilterKey = 'toolCalls' | 'statusError' | 'statusWarning' | 'statusSuccess'

export function matchesStatFilter(step: Step, filter: StatFilterKey | null, toolCallByStepId: Map<string, ToolCall>): boolean {
  if (!filter) return true
  switch (filter) {
    case 'toolCalls':
      return step.type === 'tool_use'
    case 'statusError':
      return stepStatus(step, toolCallByStepId) === 'error'
    case 'statusWarning':
      return stepStatus(step, toolCallByStepId) === 'warning'
    case 'statusSuccess':
      return stepStatus(step, toolCallByStepId) === 'success'
  }
}
