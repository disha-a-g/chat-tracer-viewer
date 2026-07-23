import type { NormalizedTrace, Step, TraceError } from '../types'

const ERROR_KIND_PHRASES: Partial<Record<NonNullable<TraceError['kind']>, string>> = {
  tool_error: 'a tool error',
  api_error: 'an API error',
  refusal: 'a refusal',
  timeout: 'a timeout',
  abort: 'an abort',
  parse_error: 'a parse error',
}

function formatErrorKind(kind: TraceError['kind']): string {
  if (!kind) return 'an error'
  return ERROR_KIND_PHRASES[kind] ?? 'an error'
}

function failureName(step: Step): string {
  if (step.tool_name) return step.tool_name
  return step.type === 'error' ? 'The response' : 'The step'
}

/** A plain-language one/two-sentence summary of how a trace failed —
 *  generated entirely from the normalized trace (no model call), per
 *  ideas.md's "reviewer mode" idea: read the narrative, not the raw log. */
export function generateFailureTldr(trace: NormalizedTrace): string | null {
  const firstFailure = trace.steps.find((s) => s.error != null)
  if (!firstFailure || !firstFailure.error) return null

  const name = failureName(firstFailure)
  const kindPhrase = formatErrorKind(firstFailure.error.kind)

  if (!firstFailure.tool_name) {
    return `This trace ended in failure. ${name} failed with ${kindPhrase}. The agent then gave up.`
  }

  const matchingCalls = trace.tool_calls.filter((c) => c.tool_name === firstFailure.tool_name)
  const lastCall = matchingCalls[matchingCalls.length - 1]

  if (matchingCalls.length >= 2 && lastCall?.status === 'ok') {
    return `This trace hit a failure but recovered. ${name} failed with ${kindPhrase}, but a later ${name} call succeeded.`
  }

  if (matchingCalls.length >= 2) {
    const retries = matchingCalls.length - 1
    return `This trace ended in failure. ${name} failed with ${kindPhrase}. The agent then retried ${retries} time${retries === 1 ? '' : 's'}.`
  }

  return `This trace ended in failure. ${name} failed with ${kindPhrase}. The agent then gave up.`
}
