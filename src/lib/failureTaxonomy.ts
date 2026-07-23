// Potential Failure Modes (ideas.md Layer 2 differentiator).
//
// Trace -> Potential Failure Modes -> Research Hypothesis -> Engineer Investigation
//
// This module does NOT determine a trace's true root cause. It surfaces
// plausible failure-mode hypotheses, each backed by concrete step-level
// evidence a human can click through and judge for themselves. Every
// likelihood shown here traces back to a deterministic, explainable rule —
// no LLM calls, no embeddings, no opaque scoring. If a reviewer asks "why
// does the viewer think this?", the answer is always "because of these
// specific steps," never "because a model said so."
//
// Pure and deterministic: same trace in, same FailureDetection[] out,
// every time, with no side effects.

import type { NormalizedTrace, Step, StepType } from '../types'
import { inputSimilarity } from './loopDetection'
import { stringifyForSearch } from './search'

export type FailureMode =
  | 'tool_execution'
  | 'retrieval_abandonment'
  | 'planner_oscillation'
  | 'observation_ignored'
  | 'premature_termination'

export type Likelihood = 'none' | 'low' | 'medium' | 'high'

export interface FailureEvidence {
  label: string
  stepIds: string[]
}

export interface FailureDetection {
  mode: FailureMode
  /** Directional, for ordering and future extensibility — not a probability. */
  likelihood: Likelihood
  /** 0-1, used for ordering and future extensibility. */
  confidence: number
  /** One sentence describing what was observed. */
  summary: string
  /** Why researchers care about this pattern. */
  whyItMatters: string
  evidence: FailureEvidence[]
  /** The step where this failure mode's evidence first appears — the
   *  concrete "start investigating here" pointer for the panel's Jump
   *  action. Undefined when there's no evidence (likelihood 'none'). */
  firstOccurrenceStepId?: string
}

export const FAILURE_MODE_LABELS: Record<FailureMode, string> = {
  tool_execution: 'Tool Execution',
  retrieval_abandonment: 'Retrieval Abandonment',
  planner_oscillation: 'Planner Oscillation',
  observation_ignored: 'Observation Ignored',
  premature_termination: 'Premature Termination',
}

/** One evidence line as shown to a human, after collapsing repeats of the
 *  exact same label (e.g. the same "X signaled a problem…" text recurring
 *  across a dozen steps) into a single "(×N)" line. Every stepId from every
 *  collapsed entry is preserved, in original order, so jump-to-log filtering
 *  still resolves to the full set of steps behind that line — dedup only
 *  changes what's displayed, never what's clickable/filterable. */
export interface GroupedEvidence {
  /** Original label, with " (×N)" appended when N > 1 collapsed entries share it. */
  label: string
  stepIds: string[]
  count: number
}

/** Groups evidence by exact label match, preserving first-occurrence order.
 *  Exact-match is correct here (not a fuzzy/normalized key): every detector
 *  above either emits a fully generic label with no per-instance detail
 *  (stepFailureLabel, the observation-ignored template) or a label that
 *  legitimately differs per instance (retrieval/oscillation labels embed a
 *  count or tool name) — in the latter case the label difference is
 *  meaningful and should NOT be collapsed away. */
export function groupEvidenceByLabel(evidence: FailureEvidence[]): GroupedEvidence[] {
  const order: string[] = []
  const byLabel = new Map<string, { stepIds: string[]; count: number }>()

  for (const e of evidence) {
    const existing = byLabel.get(e.label)
    if (existing) {
      existing.stepIds.push(...e.stepIds)
      existing.count += 1
    } else {
      byLabel.set(e.label, { stepIds: [...e.stepIds], count: 1 })
      order.push(e.label)
    }
  }

  return order.map((label) => {
    const { stepIds, count } = byLabel.get(label)!
    return { label: count > 1 ? `${label} (×${count})` : label, stepIds, count }
  })
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function average(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((sum, n) => sum + n, 0) / nums.length
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** count -> likelihood, shared across detectors so "2 occurrences" always
 *  means the same thing everywhere in this panel. */
function likelihoodFromCount(count: number): Likelihood {
  if (count <= 0) return 'none'
  if (count === 1) return 'low'
  if (count === 2) return 'medium'
  return 'high'
}

function findNextOfType(steps: Step[], fromIndex: number, type: StepType): { step: Step; index: number } | undefined {
  for (let i = fromIndex; i < steps.length; i++) {
    if (steps[i].type === type) return { step: steps[i], index: i }
  }
  return undefined
}

const OVERLAP_MIN_WORD_LENGTH = 5

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= OVERLAP_MIN_WORD_LENGTH),
  )
}

function hasOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const w of a) if (b.has(w)) return true
  return false
}

// ---------------------------------------------------------------------------
// 1. Tool Execution
// ---------------------------------------------------------------------------

function stepFailureLabel(step: Step): string {
  const kind = step.error?.kind && step.error.kind !== 'unknown' ? ` (${step.error.kind.replace(/_/g, ' ')})` : ''
  const who = step.tool_name ?? (step.type === 'error' ? 'The response' : 'A step')
  return `${who} failed${kind}`
}

function detectToolExecution(trace: NormalizedTrace): FailureDetection {
  const failing = trace.steps.filter((s) => s.error != null)
  const evidence: FailureEvidence[] = failing.map((s) => ({ label: stepFailureLabel(s), stepIds: [s.id] }))
  const count = failing.length

  return {
    mode: 'tool_execution',
    likelihood: likelihoodFromCount(count),
    confidence: clamp01(count / 4),
    summary:
      count === 0
        ? 'No tool invocations failed during execution.'
        : count === 1
          ? 'A tool invocation failed during execution.'
          : 'Multiple tool invocations failed during execution.',
    whyItMatters: 'Tool failures often prevent downstream reasoning from receiving the information it expected.',
    evidence,
  }
}

// ---------------------------------------------------------------------------
// 2. Retrieval Abandonment
// ---------------------------------------------------------------------------

const RETRIEVAL_KEYWORDS = ['search', 'retriev', 'fetch', 'grep', 'find', 'read']
const RETRIEVAL_MEANINGFUL_MIN_LENGTH = 40
const RETRIEVAL_LOOKAHEAD = 3

function isRetrievalTool(name: string | undefined): boolean {
  if (!name) return false
  const lower = name.toLowerCase()
  return RETRIEVAL_KEYWORDS.some((k) => lower.includes(k))
}

function detectRetrievalAbandonment(trace: NormalizedTrace): FailureDetection {
  const evidence: FailureEvidence[] = []

  for (const call of trace.tool_calls) {
    if (!isRetrievalTool(call.tool_name) || call.status !== 'ok' || !call.result_step_id) continue

    const resultText = stringifyForSearch(call.tool_output)
    if (resultText.trim().length < RETRIEVAL_MEANINGFUL_MIN_LENGTH) continue

    const resultIndex = trace.steps.findIndex((s) => s.id === call.result_step_id)
    if (resultIndex === -1) continue

    const followingAssistants: Step[] = []
    for (let i = resultIndex + 1; i < trace.steps.length && followingAssistants.length < RETRIEVAL_LOOKAHEAD; i++) {
      if (trace.steps[i].type === 'assistant') followingAssistants.push(trace.steps[i])
    }
    if (followingAssistants.length === 0) continue // trace ends before we can tell either way

    const retrievedWords = significantWords(resultText)
    const referenced = followingAssistants.some((a) => hasOverlap(retrievedWords, significantWords(a.content)))
    if (referenced) continue

    evidence.push({
      label: `${call.tool_name} result was never referenced in the following response${followingAssistants.length === 1 ? '' : 's'}`,
      stepIds: [call.result_step_id, call.step_id, ...followingAssistants.map((a) => a.id)],
    })
  }

  const count = evidence.length
  return {
    mode: 'retrieval_abandonment',
    likelihood: likelihoodFromCount(count),
    confidence: clamp01(count / 3),
    summary:
      count === 0
        ? 'Retrieved information appears to have been used in later reasoning.'
        : 'The agent retrieved information but never incorporated it.',
    whyItMatters: 'Ignoring retrieved evidence often leads to hallucinations or unnecessary repeated searches.',
    evidence,
  }
}

// ---------------------------------------------------------------------------
// 3. Planner Oscillation
// ---------------------------------------------------------------------------

const OSCILLATION_MIN_REPEATS = 2
// Combined score, not one exact cutoff: half weight on how similar the
// inputs are, half on how similar the results are (i.e. how little new
// information each retry produced). A tool can clear one signal without
// the other and still not count.
const OSCILLATION_SCORE_THRESHOLD = 0.5

function resultTextForToolUse(trace: NormalizedTrace, toolUseStepId: string): string {
  const call = trace.tool_calls.find((c) => c.step_id === toolUseStepId)
  return call ? stringifyForSearch(call.tool_output) : ''
}

function detectPlannerOscillation(trace: NormalizedTrace): FailureDetection {
  const byName = new Map<string, Step[]>()
  for (const step of trace.steps) {
    if (step.type !== 'tool_use') continue
    const name = step.tool_name ?? 'unknown'
    const list = byName.get(name)
    if (list) list.push(step)
    else byName.set(name, [step])
  }

  const clusters: { toolName: string; calls: Step[] }[] = []

  for (const [toolName, calls] of byName) {
    if (calls.length < OSCILLATION_MIN_REPEATS) continue

    const inputSims: number[] = []
    const resultSims: number[] = []
    for (let i = 1; i < calls.length; i++) {
      inputSims.push(inputSimilarity(calls[i - 1].tool_input, calls[i].tool_input))
      resultSims.push(inputSimilarity(resultTextForToolUse(trace, calls[i - 1].id), resultTextForToolUse(trace, calls[i].id)))
    }
    const score = 0.6 * average(inputSims) + 0.4 * average(resultSims)
    if (score >= OSCILLATION_SCORE_THRESHOLD) clusters.push({ toolName, calls })
  }

  const evidence: FailureEvidence[] = clusters.map((c) => ({
    label: `${c.calls.length} similar ${c.toolName} calls with little new information between them`,
    stepIds: c.calls.map((s) => s.id),
  }))

  const largestCluster = clusters.reduce((max, c) => Math.max(max, c.calls.length), 0)
  return {
    mode: 'planner_oscillation',
    likelihood: likelihoodFromCount(largestCluster === 0 ? 0 : largestCluster - 1),
    confidence: clamp01(largestCluster / 4),
    summary:
      clusters.length === 0
        ? 'No repeated near-identical tool calls were observed.'
        : 'The planner repeatedly explored nearly identical actions.',
    whyItMatters: 'Repeated actions with little new information often indicate the planner is stuck exploring the same hypothesis.',
    evidence,
  }
}

// ---------------------------------------------------------------------------
// 4. Observation Ignored
// ---------------------------------------------------------------------------

const OBSERVATION_SIGNAL_KEYWORDS = ['error', 'contradiction', 'not found', 'failed', 'missing', 'exception', 'does not exist', 'no such', 'denied', '404']
const ACKNOWLEDGMENT_KEYWORDS = [
  'error', 'fail', 'issue', 'problem', 'instead', 'however', 'unfortunately',
  'retry', 'try again', 'wrong', 'fix', 'unable', 'cannot', "can't", 'missing',
  'not found', 'sorry', "doesn't", 'does not',
]

function detectObservationIgnored(trace: NormalizedTrace): FailureDetection {
  const evidence: FailureEvidence[] = []

  trace.steps.forEach((step, index) => {
    if (step.type !== 'tool_result') return
    const text = `${step.content} ${stringifyForSearch(step.tool_output)}`.toLowerCase()
    if (!OBSERVATION_SIGNAL_KEYWORDS.some((k) => text.includes(k))) return

    const next = findNextOfType(trace.steps, index + 1, 'assistant')
    if (!next) return

    const acknowledged = ACKNOWLEDGMENT_KEYWORDS.some((k) => next.step.content.toLowerCase().includes(k))
    if (acknowledged) return

    evidence.push({
      label: `${step.tool_name ?? 'A tool result'} signaled a problem the next response did not acknowledge`,
      stepIds: [step.id, next.step.id],
    })
  })

  const count = evidence.length
  return {
    mode: 'observation_ignored',
    likelihood: likelihoodFromCount(count),
    confidence: clamp01(count / 3),
    summary:
      count === 0
        ? 'No contradictory observations appear to have been ignored.'
        : 'The agent continued reasoning without acknowledging contradictory observations.',
    whyItMatters: 'Ignoring observations frequently causes incorrect conclusions even when the necessary evidence was available.',
    evidence,
  }
}

// ---------------------------------------------------------------------------
// 5. Premature Termination
// ---------------------------------------------------------------------------

const CONTINUATION_PHRASES = [
  "next i'll", "next, i'll", 'i will now', "i'll now", 'next step',
  'still need to', 'to do:', 'remaining', "i'll then", 'then i will',
  'after that', 'i still need',
]

function lastAssistantOrThinkingStep(steps: Step[]): Step | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].type === 'assistant' || steps[i].type === 'thinking') return steps[i]
  }
  return undefined
}

function detectPrematureTermination(trace: NormalizedTrace): FailureDetection {
  const whyItMatters = 'Premature termination often produces incomplete answers despite otherwise correct reasoning.'
  const steps = trace.steps
  if (steps.length === 0) {
    return {
      mode: 'premature_termination',
      likelihood: 'none',
      confidence: 0,
      summary: 'The trace has no steps to evaluate.',
      whyItMatters,
      evidence: [],
    }
  }

  const evidence: FailureEvidence[] = []
  const lastStep = steps[steps.length - 1]
  const lastAssistant = lastAssistantOrThinkingStep(steps)

  // Signal: trace ends mid-action, with no closing statement at all.
  if (lastStep.type === 'tool_use' || lastStep.type === 'tool_result') {
    evidence.push({ label: 'The trace ends on a tool call with no concluding message', stepIds: [lastStep.id] })
  }

  if (lastAssistant) {
    const text = lastAssistant.content.toLowerCase()

    // Signal: explicit continuation language ("next I'll...", "still need to...").
    if (CONTINUATION_PHRASES.some((p) => text.includes(p))) {
      evidence.push({ label: 'The final message references work that was not yet done', stepIds: [lastAssistant.id] })
    }

    // Signal: an unfinished checklist or TODO marker.
    if (/\btodo\b/i.test(lastAssistant.content) || /-\s*\[\s\]/.test(lastAssistant.content)) {
      evidence.push({ label: 'The final message contains an unfinished checklist', stepIds: [lastAssistant.id] })
    }

    // Signal: abrupt cutoff — the final message is much shorter than the
    // trace's typical assistant message.
    const assistantLengths = steps.filter((s) => s.type === 'assistant').map((s) => s.content.length)
    const typicalLength = median(assistantLengths)
    if (assistantLengths.length >= 3 && typicalLength > 0 && lastAssistant.content.length < typicalLength * 0.3) {
      evidence.push({ label: 'The final message is unusually short compared to the rest of the trace', stepIds: [lastAssistant.id] })
    }
  }

  const count = evidence.length
  return {
    mode: 'premature_termination',
    likelihood: likelihoodFromCount(count),
    confidence: clamp01(count / 4),
    summary:
      count === 0
        ? 'The trace appears to reach a natural conclusion.'
        : 'The trace appears to end before the planned work completed.',
    whyItMatters,
    evidence,
  }
}

// ---------------------------------------------------------------------------

/** Always returns all five failure modes, even where likelihood is 'none' —
 *  the panel shows the full taxonomy every time so a "clean" result is
 *  visibly a clean result, not a missing check. Canonical order matches the
 *  FailureMode union above; the UI sorts a copy by confidence for display. */
export function detectFailures(trace: NormalizedTrace): FailureDetection[] {
  return [
    detectToolExecution(trace),
    detectRetrievalAbandonment(trace),
    detectPlannerOscillation(trace),
    detectObservationIgnored(trace),
    detectPrematureTermination(trace),
  ].map((d) => ({ ...d, firstOccurrenceStepId: d.evidence[0]?.stepIds[0] }))
}
