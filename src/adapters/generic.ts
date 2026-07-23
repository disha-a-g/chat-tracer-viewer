// Generic single-JSON fallback adapter. Runs when the sniffer matches
// neither Claude Code nor OpenAI. Assumes only that somewhere in the
// document there is an array of step-like objects; degrades gracefully
// (never throws) so an unknown format still produces a readable, if
// lower-fidelity, timeline.

import type { NormalizedTrace, Step, StepType, TraceIssue } from '../types'
import { finalizeTrace } from './finalize'

const ARRAY_KEYS = ['steps', 'events', 'messages', 'trace', 'spans', 'items']

function findStepsArray(doc: unknown): unknown[] | undefined {
  if (Array.isArray(doc)) return doc
  if (!doc || typeof doc !== 'object') return undefined

  interface Candidate {
    arr: unknown[]
    depth: number
    keyIndex: number
  }
  let best: Candidate | undefined
  const queue: Array<{ node: unknown; depth: number }> = [{ node: doc, depth: 0 }]

  while (queue.length > 0) {
    const { node, depth } = queue.shift()!
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const record = node as Record<string, unknown>

    ARRAY_KEYS.forEach((key, keyIndex) => {
      const val = record[key]
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
        if (!best || depth < best.depth || (depth === best.depth && keyIndex < best.keyIndex)) {
          best = { arr: val, depth, keyIndex }
        }
      }
    })

    for (const val of Object.values(record)) {
      if (val && typeof val === 'object') queue.push({ node: val, depth: depth + 1 })
    }
  }

  return best?.arr
}

const TYPE_SYNONYMS: Record<string, StepType> = {
  user: 'user',
  human: 'user',
  prompt: 'user',
  input: 'user',
  assistant: 'assistant',
  ai: 'assistant',
  model: 'assistant',
  completion: 'assistant',
  output: 'assistant',
  tool_use: 'tool_use',
  function_call: 'tool_use',
  action: 'tool_use',
  tool_call: 'tool_use',
  tool_result: 'tool_result',
  observation: 'tool_result',
  function_response: 'tool_result',
  tool_output: 'tool_result',
  thinking: 'thinking',
  reasoning: 'thinking',
  scratchpad: 'thinking',
  reflection: 'thinking',
  error: 'error',
  exception: 'error',
  failure: 'error',
}

function toStepType(raw: string | undefined, issues: TraceIssue[], stepId: string): StepType {
  if (!raw) {
    issues.push({ severity: 'warning', message: `Step "${stepId}" has no recognizable type field; defaulted to "assistant"`, step_id: stepId })
    return 'assistant'
  }
  const mapped = TYPE_SYNONYMS[raw.toLowerCase()]
  if (mapped) return mapped
  issues.push({ severity: 'warning', message: `Step "${stepId}" has unrecognized type "${raw}"; defaulted to "assistant"`, step_id: stepId })
  return 'assistant'
}

function firstPresent<T = unknown>(obj: Record<string, unknown>, keys: string[]): T | undefined {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key] as T
  }
  return undefined
}

function parseTimestamp(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
  }
  if (typeof v === 'number') {
    const ms = v < 1e11 ? v * 1000 : v
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
  }
  return undefined
}

function firstDurationKeyValue(obj: Record<string, unknown>): { key: string; value: number } | undefined {
  for (const key of ['duration_ms', 'duration', 'latency_ms', 'elapsed']) {
    const v = obj[key]
    if (typeof v === 'number') return { key, value: v }
  }
  return undefined
}

function resolveDuration(key: string, value: number, issues: TraceIssue[], stepId: string): number {
  if (key === 'duration') {
    if (!Number.isInteger(value) && value < 1000) return value * 1000
    if (Number.isInteger(value) && value < 1000) {
      issues.push({
        severity: 'warning',
        message: `Ambiguous duration value ${value} for step "${stepId}" (seconds or milliseconds?); assumed milliseconds`,
        step_id: stepId,
      })
    }
  }
  return value
}

export function parse(raw: string): NormalizedTrace {
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch (e) {
    return finalizeTrace({
      raw,
      format: 'generic-json',
      steps: [],
      issues: [{ severity: 'error', message: `Failed to parse JSON: ${(e as Error).message}` }],
      explicitConfidenceSource: 'generic-fields',
    })
  }

  const issues: TraceIssue[] = []
  const rawSteps = findStepsArray(doc) ?? []
  if (rawSteps.length === 0) {
    issues.push({ severity: 'error', message: 'No array of step-like objects found in the document.' })
  }

  const steps: Step[] = []
  const usedIds = new Set<string>()

  rawSteps.forEach((rawStepUnknown, index) => {
    const rawStep = rawStepUnknown && typeof rawStepUnknown === 'object' ? (rawStepUnknown as Record<string, unknown>) : {}

    let id = String(firstPresent<string | number>(rawStep, ['id', 'uuid', 'step_id', 'event_id']) ?? index)
    if (usedIds.has(id)) id = `${id}-${index}`
    usedIds.add(id)

    const parentRaw = firstPresent<string | number>(rawStep, ['parent_id', 'parentUuid', 'parent', 'caused_by'])
    const hasParentField = parentRaw !== undefined

    const typeRaw = firstPresent<string>(rawStep, ['type', 'role', 'event', 'kind'])
    const type = toStepType(typeRaw, issues, id)

    const timestamp = parseTimestamp(firstPresent(rawStep, ['timestamp', 'time', 'ts', 'created_at', 'start_time']))

    const durationKeyVal = firstDurationKeyValue(rawStep)
    const duration_ms = durationKeyVal ? resolveDuration(durationKeyVal.key, durationKeyVal.value, issues, id) : undefined

    const contentRaw = firstPresent(rawStep, ['content', 'text', 'message', 'output', 'body'])
    const content =
      contentRaw === undefined
        ? ''
        : typeof contentRaw === 'string'
          ? contentRaw
          : typeof contentRaw === 'object'
            ? JSON.stringify(contentRaw)
            : String(contentRaw)

    let tool_name: string | undefined
    const toolNameRaw = firstPresent(rawStep, ['tool', 'tool_name', 'name', 'function'])
    if (typeof toolNameRaw === 'string') tool_name = toolNameRaw
    else if (toolNameRaw && typeof toolNameRaw === 'object' && 'name' in toolNameRaw) {
      tool_name = String((toolNameRaw as { name?: unknown }).name)
    }

    let tool_input = firstPresent(rawStep, ['input', 'args', 'arguments', 'parameters'])
    if (typeof tool_input === 'string') {
      try {
        tool_input = JSON.parse(tool_input)
      } catch {
        // keep the unparseable string as-is
      }
    }

    let tool_output = firstPresent(rawStep, ['output', 'result', 'response', 'observation'])
    if (tool_output !== undefined && contentRaw !== undefined && tool_output === contentRaw) {
      // 'output' satisfied both the content and tool_output candidate keys;
      // content wins for non-tool steps per the format mapping notes.
      tool_output = undefined
    }

    let error: Step['error']
    const errorRaw = firstPresent(rawStep, ['error', 'exception', 'failure'])
    if (typeof errorRaw === 'string') {
      error = { message: errorRaw, provenance: 'source' }
    } else if (errorRaw && typeof errorRaw === 'object') {
      const eo = errorRaw as Record<string, unknown>
      const message = firstPresent<string>(eo, ['message', 'msg', 'error'])
      error = { message: message ?? JSON.stringify(eo), provenance: 'source' }
    }

    const step: Step = {
      id,
      parent_id: hasParentField ? String(parentRaw) : null,
      parent_provenance: hasParentField ? 'source' : 'inferred',
      type,
      timestamp,
      duration_ms,
      duration_provenance: duration_ms !== undefined ? 'source' : 'unknown',
      content,
      tool_name: type === 'tool_use' || type === 'tool_result' ? tool_name : undefined,
      tool_input: type === 'tool_use' ? tool_input : undefined,
      tool_output: type === 'tool_result' ? (tool_output ?? contentRaw) : undefined,
      error,
      raw: rawStepUnknown,
    }
    steps.push(step)
  })

  steps.forEach((step, i) => {
    if (step.parent_id === null && step.parent_provenance === 'inferred' && i > 0) {
      step.parent_id = steps[i - 1].id
    }
  })

  return finalizeTrace({
    raw,
    format: 'generic-json',
    steps,
    issues,
    explicitConfidenceSource: 'generic-fields',
  })
}
