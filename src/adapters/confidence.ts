// Confidence signal computation.
// "A directional UI aid for locating the moment something changed, not a
// measurement of the model's internal state." Explicit signals (logprobs,
// a source-provided confidence/score field) are preferred; heuristics fill
// in everywhere else.

import type { ConfidenceComponent, ConfidenceHeuristic, ConfidenceSignal, Step } from '../types'

const BASELINE = 0.75
const WINDOW = 5

const WEIGHTS: Record<Exclude<ConfidenceHeuristic, 'explicit'>, number> = {
  hedging_density: 0.3,
  length_shock: 0.15,
  tool_silence: 0.15,
  hypothesis_churn: 0.15,
  retry_pressure: 0.15,
  error_proximity: 0.1,
}

const HEDGES = [
  'might', 'maybe', 'perhaps', 'possibly', 'probably', 'seems', 'appears',
  'i think', 'i believe', 'not sure', 'unclear', 'unsure', 'could be',
  'i assume', 'presumably', 'likely', 'roughly', 'approximately', 'estimate',
  'hard to say', "i can't tell", 'may be', 'guess', "i'm not certain",
]
const CONFIDENT = [
  'confirmed', 'verified', 'exactly', 'definitely', 'the answer is',
  'this shows', 'i found', 'clearly', 'precisely',
]

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function tokenize(text: string): string[] {
  return text.split(/\s+/).map((w) => w.trim()).filter((w) => w.length > 0)
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of',
  'and', 'or', 'in', 'on', 'at', 'for', 'with', 'it', 'this', 'that', 'i',
  'we', 'you', 'as', 'by', 'from', 'will', 'so', 'but', 'if', 'then',
])

function contentWords(text: string): Set<string> {
  return new Set(
    tokenize(text.toLowerCase())
      .map((w) => w.replace(/[^a-z0-9]/g, ''))
      .filter((w) => w.length > 0 && !STOPWORDS.has(w)),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const w of a) if (b.has(w)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

function countPhrases(lowerText: string, phrases: string[]): number {
  let count = 0
  for (const phrase of phrases) {
    let idx = lowerText.indexOf(phrase)
    while (idx !== -1) {
      count++
      idx = lowerText.indexOf(phrase, idx + phrase.length)
    }
  }
  return count
}

function push(components: ConfidenceComponent[], name: ConfidenceHeuristic, contribution: number, detail?: string): void {
  components.push({ name, contribution, detail })
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`
}

function traceUsesTools(steps: Step[]): boolean {
  return steps.some((s) => s.type === 'tool_use')
}

function lastIndexOfType(steps: Step[], beforeIndex: number, type: Step['type']): number {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    if (steps[i].type === type) return i
  }
  return -1
}

function assistantStepsBefore(steps: Step[], index: number): Step[] {
  return steps.slice(0, index).filter((s) => s.type === 'assistant' || s.type === 'thinking')
}

function lastReasoningStepBefore(steps: Step[], index: number): Step | undefined {
  for (let i = index - 1; i >= 0; i--) {
    if (steps[i].type === 'assistant' || steps[i].type === 'thinking') return steps[i]
  }
  return undefined
}

interface ToolCallLite {
  tool_name?: string
  tool_input?: unknown
}

function toolCallsInWindow(steps: Step[], from: number, to: number): ToolCallLite[] {
  return steps
    .slice(Math.max(0, from), to)
    .filter((s) => s.type === 'tool_use')
    .map((s) => ({ tool_name: s.tool_name, tool_input: s.tool_input }))
}

function maxDuplicateCount(hashes: string[]): number {
  const counts = new Map<string, number>()
  for (const h of hashes) counts.set(h, (counts.get(h) ?? 0) + 1)
  let max = 0
  for (const c of counts.values()) max = Math.max(max, c)
  return max
}

export function heuristicConfidence(step: Step, index: number, steps: Step[]): ConfidenceSignal {
  const components: ConfidenceComponent[] = []
  let score = BASELINE
  const words = tokenize(step.content)
  const lower = step.content.toLowerCase()

  // 1. Hedging density
  if (words.length >= 5) {
    const hedges = countPhrases(lower, HEDGES)
    const confident = countPhrases(lower, CONFIDENT)
    const density = (hedges - 0.5 * confident) / Math.max(words.length, 1)
    const c = -clamp(density * 15, -1, 1) * WEIGHTS.hedging_density
    score += c
    push(components, 'hedging_density', c, `${hedges} hedging tokens in ${words.length} words`)
  }

  // 2. Length shock
  const prior = assistantStepsBefore(steps, index).slice(-WINDOW)
  if (prior.length >= 3) {
    const med = median(prior.map((s) => tokenize(s.content).length))
    if (med > 0) {
      const ratio = words.length / med
      let c = 0
      if (ratio < 0.4) c = -(1 - ratio / 0.4) * WEIGHTS.length_shock
      else if (ratio > 3.0) c = -Math.min((ratio - 3.0) / 3.0, 1) * WEIGHTS.length_shock * 0.5
      score += c
      push(components, 'length_shock', c, `${words.length} words vs. median ${med}`)
    }
  }

  // 3. Tool silence
  if (traceUsesTools(steps)) {
    const lastToolIdx = lastIndexOfType(steps, index, 'tool_use')
    const stepsSinceTool = lastToolIdx === -1 ? index + 1 : index - lastToolIdx
    if (stepsSinceTool >= 2) {
      const c = -Math.min((stepsSinceTool - 1) / 3, 1) * WEIGHTS.tool_silence
      score += c
      push(components, 'tool_silence', c, `${stepsSinceTool} steps without a tool call`)
    } else if (steps[index + 1]?.type === 'tool_use' && steps[index + 1]?.parent_id === step.id) {
      const c = 0.02
      score += c
      push(components, 'tool_silence', c, 'tool call issued in this turn')
    }
  }

  // 4. Hypothesis churn
  const prevReasoning = lastReasoningStepBefore(steps, index)
  if (prevReasoning && words.length >= 10) {
    const a = contentWords(step.content)
    const b = contentWords(prevReasoning.content)
    const novelty = 1 - jaccard(a, b)
    let c = 0
    if (novelty > 0.6) c = -((novelty - 0.6) / 0.4) * WEIGHTS.hypothesis_churn
    else if (novelty < 0.15) c = -(1 - novelty / 0.15) * WEIGHTS.hypothesis_churn * 0.6
    score += c
    push(components, 'hypothesis_churn', c, `${novelty.toFixed(2)} novelty vs. previous reasoning step`)
  }

  // 5. Retry pressure
  const recentCalls = toolCallsInWindow(steps, index - WINDOW, index)
  const repeats = maxDuplicateCount(recentCalls.map((c) => `${c.tool_name ?? ''}:${stableStringify(c.tool_input)}`))
  if (repeats >= 2) {
    const c = -Math.min((repeats - 1) / 2, 1) * WEIGHTS.retry_pressure
    score += c
    push(components, 'retry_pressure', c, `identical tool_input repeated ${repeats}x`)
  }

  // 6. Error proximity
  const errs = steps.slice(Math.max(0, index - WINDOW), index).filter((s) => s.error != null).length
  if (errs > 0) {
    const c = -Math.min(errs / 3, 1) * WEIGHTS.error_proximity
    score += c
    push(components, 'error_proximity', c, `${errs} errors in trailing window of ${WINDOW}`)
  }

  return { value: clamp(score, 0, 1), provenance: 'inferred', components }
}

interface ScaleRange {
  max: number
}

function normalizeScale(v: number, range: ScaleRange): number {
  if (range.max <= 1.0) return clamp(v, 0, 1)
  if (range.max <= 5.0) return clamp((v - 1) / 4, 0, 1)
  if (range.max <= 100) return clamp(v / 100, 0, 1)
  return clamp(v / range.max, 0, 1)
}

interface Logprob {
  logprob: number
}

/** Explicit confidence from a step's raw source object: OpenAI-style
 *  per-token logprobs, or a generic confidence/score/certainty/probability
 *  field. `scaleRange` must be computed once per trace (not per step). */
export function explicitConfidence(raw: unknown, scaleRange: ScaleRange): ConfidenceSignal | null {
  if (raw && typeof raw === 'object') {
    const withLogprobs = raw as { logprobs?: { content?: Logprob[] } }
    const content = withLogprobs.logprobs?.content
    if (Array.isArray(content) && content.length > 0) {
      const toks = content.slice(0, 40)
      const value = toks.reduce((sum, t) => sum + Math.exp(t.logprob), 0) / toks.length
      return {
        value: clamp(value, 0, 1),
        provenance: 'source',
        raw: value,
        components: [{ name: 'explicit', contribution: value, detail: `mean p over ${toks.length} tokens` }],
      }
    }
    const record = raw as Record<string, unknown>
    const key = ['confidence', 'score', 'certainty', 'probability'].find((k) => typeof record[k] === 'number')
    if (key) {
      const v = record[key] as number
      const value = normalizeScale(v, scaleRange)
      return {
        value,
        provenance: 'source',
        raw: v,
        components: [{ name: 'explicit', contribution: value }],
      }
    }
  }
  return null
}

export function computeScaleRange(rawSteps: unknown[]): ScaleRange {
  let max = 1
  for (const raw of rawSteps) {
    if (raw && typeof raw === 'object') {
      const record = raw as Record<string, unknown>
      const key = ['confidence', 'score', 'certainty', 'probability'].find((k) => typeof record[k] === 'number')
      if (key) max = Math.max(max, record[key] as number)
    }
  }
  return { max }
}
