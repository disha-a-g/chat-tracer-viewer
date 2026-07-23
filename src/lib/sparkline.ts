import type { ConfidenceComponent, Step } from '../types'

/** A drop >0.3 between two consecutive confident steps is "sharp" — the
 *  eye-catching signal the sparkline exists to surface (ideas.md Layer 2). */
export const DROP_THRESHOLD = 0.3

/** Below this many scoreable points, a trailing-window heuristic has no
 *  baseline and the line would be pure noise. */
export const MIN_POINTS_FOR_SPARKLINE = 3

export interface SparklinePoint {
  stepId: string
  /** Index into the full Step[] array — the x-axis, so gaps from skipped
   *  non-confident steps (tool calls, user turns) stay visually honest
   *  rather than being evenly spaced out. */
  index: number
  value: number
  isDrop: boolean
  /** The most negative heuristic contribution behind a drop, for the
   *  tooltip's one-line "why" — attributes the drop to a cause instead of
   *  just showing that confidence fell. */
  causeDetail?: string
}

export function worstComponent(components: ConfidenceComponent[] | undefined): ConfidenceComponent | undefined {
  if (!components || components.length === 0) return undefined
  return components.reduce((worst, c) => (c.contribution < (worst?.contribution ?? 0) ? c : worst), undefined as ConfidenceComponent | undefined)
}

// Most traces' confidence values cluster in a narrow band (e.g. 0.5-0.7) —
// always mapping the full 0-1 range to the chart height squashes real
// fluctuations into a couple of pixels, reading as a flat line even when
// the underlying values genuinely moved. Auto-scaling to the trace's own
// observed range fixes that, with two guards: MIN_DISPLAY_RANGE stops a
// near-constant trace from having trivial noise blown up into a dramatic-
// looking swing, and RANGE_PADDING_FRACTION keeps the extreme points off
// the very top/bottom edge.
export const MIN_DISPLAY_RANGE = 0.2
export const RANGE_PADDING_FRACTION = 0.15

export interface YDomain {
  min: number
  max: number
}

export function computeYDomain(values: number[]): YDomain {
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const center = (rawMin + rawMax) / 2
  const halfRange = Math.max(rawMax - rawMin, MIN_DISPLAY_RANGE) / 2
  const padding = halfRange * RANGE_PADDING_FRACTION
  return { min: center - halfRange - padding, max: center + halfRange + padding }
}

export function computeSparklinePoints(steps: Step[]): SparklinePoint[] {
  const confident = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.confidence !== undefined)

  return confident.map(({ step, index }, i) => {
    const value = step.confidence!.value
    const prevValue = i > 0 ? confident[i - 1].step.confidence!.value : undefined
    const isDrop = prevValue !== undefined && prevValue - value > DROP_THRESHOLD
    const worst = isDrop ? worstComponent(step.confidence!.components) : undefined
    return {
      stepId: step.id,
      index,
      value,
      isDrop,
      causeDetail: worst?.detail ?? worst?.name,
    }
  })
}
