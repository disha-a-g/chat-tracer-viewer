// Shared assembly pipeline used by every adapter after it has produced a
// flat, ordered `Step[]`. Handles everything that's identical across
// formats: tool_call joining, duration inference, confidence scoring,
// stats, and trace-level rollups. Keeping this in one place is what makes
// "the viewer reads only the normalized schema" true — adapters differ
// only in how they produce `Step[]`.

import { generateTraceId } from '../lib/hash'
import type {
  NormalizedTrace,
  Provenance,
  Step,
  TokenUsage,
  ToolCall,
  TraceFormat,
  TraceIssue,
  TraceStats,
} from '../types'
import { computeScaleRange, explicitConfidence, heuristicConfidence } from './confidence'
import { stepStatus } from '../lib/stepVisuals'

export type ExplicitConfidenceSource = 'never' | 'logprobs' | 'generic-fields'

export interface FinalizeInput {
  raw: string
  format: TraceFormat
  steps: Step[]
  issues: TraceIssue[]
  title?: string
  meta?: Record<string, unknown>
  explicitConfidenceSource: ExplicitConfidenceSource
}

function timeOf(step: Step | undefined): number | undefined {
  if (!step?.timestamp) return undefined
  const t = new Date(step.timestamp).getTime()
  return Number.isNaN(t) ? undefined : t
}

// Takes the already-resolved tool_use/tool_result pairing from
// buildToolCalls rather than re-deriving one from tool_call_id alone —
// buildToolCalls also falls back to nearest-following-same-name matching for
// formats without a native call id, and duration inference needs to see
// exactly the same pairs, or a tool_use/tool_result pair with real
// timestamps but no shared id would join correctly everywhere except here.
function inferDurations(steps: Step[], toolCalls: ToolCall[]): void {
  const stepById = new Map(steps.map((s) => [s.id, s]))
  const callByUseStepId = new Map(toolCalls.map((c) => [c.step_id, c]))

  steps.forEach((step, i) => {
    if (step.duration_ms !== undefined) return

    if (step.type === 'tool_use') {
      const call = callByUseStepId.get(step.id)
      const result = call?.result_step_id ? stepById.get(call.result_step_id) : undefined
      const start = timeOf(step)
      const end = timeOf(result)
      if (start !== undefined && end !== undefined && end >= start) {
        step.duration_ms = end - start
        step.duration_provenance = 'inferred'
        if (call) {
          call.duration_ms = step.duration_ms
          call.duration_provenance = 'inferred'
        }
        return
      }
    }

    if (step.type === 'assistant' || step.type === 'thinking') {
      const start = timeOf(step)
      const end = timeOf(steps[i + 1])
      if (start !== undefined && end !== undefined && end >= start) {
        step.duration_ms = end - start
        step.duration_provenance = 'inferred'
        return
      }
    }

    step.duration_provenance = 'unknown'
  })
}

function buildToolCalls(steps: Step[], issues: TraceIssue[]): ToolCall[] {
  const toolUses = steps.filter((s) => s.type === 'tool_use')
  const toolResults = steps.filter((s) => s.type === 'tool_result')
  const resultByCallId = new Map<string, Step>()
  for (const r of toolResults) if (r.tool_call_id) resultByCallId.set(r.tool_call_id, r)
  // steps.indexOf(x) is O(n); on a large trace with no tool_call_id (every
  // use falls through to the fallback below), that's O(n) per comparison
  // inside an already-scanning .find(). A position map turns it into O(1).
  const stepIndex = new Map(steps.map((s, i) => [s.id, i]))

  const usedResultIds = new Set<string>()
  const usedByFallback = new Set<string>()

  const calls: ToolCall[] = toolUses.map((use) => {
    let result: Step | undefined
    if (use.tool_call_id && resultByCallId.has(use.tool_call_id)) {
      result = resultByCallId.get(use.tool_call_id)
    }
    if (!result) {
      // No id-based pairing available (generic formats without tool_call_id).
      // Fall back to the nearest following tool_result with the same tool name.
      const useIndex = stepIndex.get(use.id)!
      result = toolResults.find(
        (r) => !usedByFallback.has(r.id) && r.tool_name === use.tool_name && stepIndex.get(r.id)! > useIndex,
      )
      if (result) {
        usedByFallback.add(result.id)
        result.parent_provenance = 'inferred'
      }
    }
    if (result) usedResultIds.add(result.id)

    const status: ToolCall['status'] = !result ? 'pending' : result.error ? 'error' : 'ok'
    if (!result) {
      issues.push({ severity: 'warning', message: `tool_use "${use.tool_name ?? use.id}" has no matching tool_result`, step_id: use.id })
    }

    return {
      id: use.id,
      step_id: use.id,
      result_step_id: result?.id,
      tool_name: use.tool_name ?? 'unknown',
      tool_input: use.tool_input,
      tool_output: result?.tool_output,
      status,
      error: result?.error,
      duration_ms: use.duration_ms,
      duration_provenance: use.duration_provenance,
    }
  })

  const orphanResults = toolResults.filter((r) => !usedResultIds.has(r.id))
  for (const r of orphanResults) {
    issues.push({ severity: 'warning', message: `tool_result "${r.tool_name ?? r.id}" has no matching tool_use`, step_id: r.id })
  }

  return calls
}

function sumTokens(steps: Step[]): TokenUsage | undefined {
  let has = false
  const total: TokenUsage = {}
  for (const s of steps) {
    if (!s.tokens) continue
    has = true
    for (const key of ['input', 'output', 'cache_read', 'cache_creation', 'total'] as const) {
      const v = s.tokens[key]
      if (v !== undefined) total[key] = (total[key] ?? 0) + v
    }
  }
  return has ? total : undefined
}

function computeStats(steps: Step[], toolCalls: ToolCall[]): TraceStats {
  const timestamps = steps.map(timeOf).filter((t): t is number => t !== undefined)
  let duration_ms: number | undefined
  let duration_provenance: Provenance = 'unknown'
  if (timestamps.length >= 2) {
    duration_ms = Math.max(...timestamps) - Math.min(...timestamps)
    duration_provenance = 'source'
  }

  // Matches the timeline's red/error coloring exactly (lib/stepVisuals.ts),
  // not just `step.error != null` — a failed tool_use is colored red too,
  // via its joined ToolCall, not only the tool_result that reports it. This
  // keeps the stats bar's "Errors" count consistent with what clicking it
  // (or the status filter row) actually reveals.
  const toolCallByStepId = new Map(toolCalls.map((c) => [c.step_id, c]))
  const error_count = steps.filter((s) => stepStatus(s, toolCallByStepId) === 'error').length

  return {
    step_count: steps.length,
    duration_ms,
    duration_provenance,
    tool_call_count: toolCalls.length,
    error_count,
    model_call_count: steps.filter((s) => s.type === 'assistant' || s.type === 'thinking').length,
    tokens: sumTokens(steps),
  }
}

function applyConfidence(steps: Step[], source: ExplicitConfidenceSource): boolean {
  const scaleRange = source === 'generic-fields' ? computeScaleRange(steps.map((s) => s.raw)) : { max: 1 }

  let hasExplicit = false
  steps.forEach((step, index) => {
    if (step.type !== 'assistant' && step.type !== 'thinking') return
    let signal = source === 'never' ? null : explicitConfidence(step.raw, scaleRange)
    if (signal) hasExplicit = true
    else signal = heuristicConfidence(step, index, steps)
    step.confidence = signal
  })
  return hasExplicit
}

function dominantModel(steps: Step[]): string | undefined {
  const counts = new Map<string, number>()
  for (const s of steps) if (s.model) counts.set(s.model, (counts.get(s.model) ?? 0) + 1)
  let best: string | undefined
  let bestCount = 0
  for (const [model, count] of counts) {
    if (count > bestCount) {
      best = model
      bestCount = count
    }
  }
  return best
}

export function finalizeTrace(input: FinalizeInput): NormalizedTrace {
  const { steps, issues } = input

  const tool_calls = buildToolCalls(steps, issues)
  inferDurations(steps, tool_calls)
  const has_explicit_confidence = applyConfidence(steps, input.explicitConfidenceSource)
  const stats = computeStats(steps, tool_calls)

  const timestamps = steps.map(timeOf).filter((t): t is number => t !== undefined)
  const started_at = timestamps.length > 0 ? steps.find((s) => timeOf(s) === Math.min(...timestamps))?.timestamp : undefined
  const ended_at = timestamps.length > 0 ? steps.find((s) => timeOf(s) === Math.max(...timestamps))?.timestamp : undefined

  const firstUser = steps.find((s) => s.type === 'user')
  const title = input.title ?? (firstUser ? truncate(firstUser.content, 80) : undefined)

  return {
    id: generateTraceId(input.raw),
    format: input.format,
    schema_version: 1,
    steps,
    tool_calls,
    stats,
    issues,
    title,
    started_at,
    ended_at,
    model: dominantModel(steps),
    has_explicit_confidence,
    meta: input.meta,
    raw: safeParseWholeDocument(input.raw),
  }
}

export function truncate(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

function safeParseWholeDocument(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    // JSONL or otherwise not a single JSON document; keep the raw text so
    // the whole-trace raw view still has something to show.
    return raw
  }
}
