// Temporal signals for the Reasoning Confidence section: moments that are
// interesting because of *when* they happened, not because they're evidence
// for a specific failure-mode hypothesis. Kept out of failureTaxonomy.ts on
// purpose — a confidence drop or a long pause isn't itself a claim about
// what went wrong, just a fact about the trace's shape over time.
//
// Pure and deterministic, same conventions as failureTaxonomy.ts.

import type { Step } from '../types'
import { DROP_THRESHOLD, worstComponent } from './sparkline'

export interface ConfidenceDropSignal {
  stepId: string
  before: number
  after: number
  cause?: string
}

export interface LongPauseSignal {
  stepId: string
  ms: number
  /** What happened right after the pause, for a "before X" line. */
  followingDescription: string
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function computeLargestConfidenceDrop(steps: Step[]): ConfidenceDropSignal | undefined {
  const confident = steps.filter((s) => s.confidence !== undefined)
  let worst: ConfidenceDropSignal | undefined
  let worstDelta = 0

  for (let i = 1; i < confident.length; i++) {
    const before = confident[i - 1].confidence!.value
    const after = confident[i].confidence!.value
    const delta = before - after
    if (delta > DROP_THRESHOLD && delta > worstDelta) {
      worstDelta = delta
      const cause = worstComponent(confident[i].confidence!.components)
      worst = { stepId: confident[i].id, before, after, cause: cause?.detail ?? cause?.name }
    }
  }
  return worst
}

function describeFollowingStep(step: Step): string {
  switch (step.type) {
    case 'tool_use':
      return step.tool_name ? `a new ${step.tool_name} call` : 'a new tool call'
    case 'tool_result':
      return 'a tool result'
    case 'assistant':
      return 'the next response'
    case 'thinking':
      return 'further reasoning'
    case 'user':
      return 'the next user turn'
    case 'error':
      return 'an error'
  }
}

// Same floor/ratio rationale as the old interestingEvents.ts: a pause only
// counts as "unusual" if it clears an absolute floor (so a fast trace isn't
// flagged over noise) and a multiple of the trace's own typical gap (so a
// uniformly slow trace isn't flagged for being uniformly slow).
const PAUSE_ABSOLUTE_FLOOR_MS = 5_000
const PAUSE_RATIO_OVER_TYPICAL = 3
const MIN_TIMED_STEPS_FOR_PAUSE_CHECK = 4

export function computeLongestPause(steps: Step[]): LongPauseSignal | undefined {
  const timed = steps
    .map((step) => ({ step, t: step.timestamp ? Date.parse(step.timestamp) : NaN }))
    .filter((x): x is { step: Step; t: number } => !Number.isNaN(x.t))
  if (timed.length < MIN_TIMED_STEPS_FOR_PAUSE_CHECK) return undefined

  const gaps: { step: Step; ms: number }[] = []
  for (let i = 1; i < timed.length; i++) {
    const ms = timed[i].t - timed[i - 1].t
    if (ms >= 0) gaps.push({ step: timed[i].step, ms })
  }
  if (gaps.length === 0) return undefined

  const typical = median(gaps.map((g) => g.ms))
  const largest = gaps.reduce((max, g) => (g.ms > max.ms ? g : max), gaps[0])
  if (largest.ms < PAUSE_ABSOLUTE_FLOOR_MS) return undefined
  if (typical > 0 && largest.ms < typical * PAUSE_RATIO_OVER_TYPICAL) return undefined

  return { stepId: largest.step.id, ms: largest.ms, followingDescription: describeFollowingStep(largest.step) }
}
