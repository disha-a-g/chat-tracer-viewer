// OpenAI Chat Completions adapter.
// Accepts either a request body ({ model, messages: [...] }) or a captured
// response ({ choices: [{ message }] }), and tolerates hand-rolled traces
// that borrow Anthropic's tool_use/tool_result vocabulary.

import type { NormalizedTrace, Step, TraceIssue } from '../types'
import { finalizeTrace, truncate } from './finalize'

interface OpenAIContentPart {
  type?: string
  text?: string
  [key: string]: unknown
}

interface OpenAIToolCall {
  id: string
  type?: string
  function: { name: string; arguments: string }
}

interface OpenAIMessage {
  role?: string
  content?: string | OpenAIContentPart[] | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
  reasoning?: string
  reasoning_content?: string
  [key: string]: unknown
}

interface OpenAIChoice {
  message?: OpenAIMessage
  finish_reason?: string
  logprobs?: unknown
  index?: number
}

interface OpenAIDoc {
  model?: string
  messages?: OpenAIMessage[]
  choices?: OpenAIChoice[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  tool_choice?: unknown
  temperature?: unknown
}

function flattenContent(content: OpenAIMessage['content']): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (typeof part.text === 'string') return part.text
      return `[${part.type ?? 'content'}]`
    })
    .filter((s) => s.length > 0)
    .join('\n\n')
}

export function parse(raw: string): NormalizedTrace {
  let doc: OpenAIDoc
  try {
    doc = JSON.parse(raw) as OpenAIDoc
  } catch (e) {
    return finalizeTrace({
      raw,
      format: 'openai-chat-completions',
      steps: [],
      issues: [{ severity: 'error', message: `Failed to parse JSON: ${(e as Error).message}` }],
      explicitConfidenceSource: 'logprobs',
    })
  }

  const issues: TraceIssue[] = []
  const steps: Step[] = []
  const toolUseIdByCallId = new Map<string, string>()
  const toolNameByCallId = new Map<string, string>()

  interface Entry {
    message: OpenAIMessage
    index: number
    finish_reason?: string
    rawEntry: unknown
  }

  const entries: Entry[] = (doc.messages ?? []).map((m, i) => ({ message: m, index: i, rawEntry: m }))
  const choice = doc.choices?.[0]
  if (choice?.message) {
    entries.push({ message: choice.message, index: entries.length, finish_reason: choice.finish_reason, rawEntry: choice })
  }

  let previousStepId: string | null = null

  for (const { message, index, finish_reason, rawEntry } of entries) {
    const msgId = `msg-${index}`
    const role = message.role ?? 'assistant'
    const contentText = flattenContent(message.content)
    const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0
    const reasoningText = message.reasoning ?? message.reasoning_content

    let anchorStepId = previousStepId

    if (reasoningText) {
      const step: Step = {
        id: `${msgId}#thinking`,
        parent_id: previousStepId,
        parent_provenance: 'inferred',
        type: 'thinking',
        duration_provenance: 'unknown',
        content: String(reasoningText),
        raw: rawEntry,
      }
      steps.push(step)
      previousStepId = step.id
      anchorStepId = step.id
    }

    if (role === 'tool') {
      const toolCallId = message.tool_call_id
      const useStepId = toolCallId ? toolUseIdByCallId.get(toolCallId) : undefined
      const step: Step = {
        id: msgId,
        parent_id: useStepId ?? previousStepId,
        parent_provenance: useStepId ? 'source' : 'unknown',
        type: 'tool_result',
        duration_provenance: 'unknown',
        content: contentText,
        tool_output: message.content,
        tool_call_id: toolCallId,
        tool_name: toolCallId ? toolNameByCallId.get(toolCallId) : undefined,
        raw: rawEntry,
      }
      if (!useStepId) {
        issues.push({ severity: 'warning', message: `role:"tool" message has no matching tool_call in this trace`, step_id: step.id })
      }
      if (typeof message.content === 'string' && /^(error|exception|traceback)[:\s]/i.test(message.content.trim())) {
        step.error = { message: message.content.trim().split('\n')[0].slice(0, 300), kind: 'tool_error', provenance: 'inferred' }
      }
      steps.push(step)
      previousStepId = step.id
      continue
    }

    const normalizedRole = role === 'system' || role === 'developer' || role === 'user' ? 'user' : 'assistant'
    const skipTextStep = contentText === '' && hasToolCalls

    if (!skipTextStep) {
      const step: Step = {
        id: msgId,
        parent_id: anchorStepId,
        parent_provenance: 'inferred',
        type: normalizedRole,
        duration_provenance: 'unknown',
        content: contentText,
        model: normalizedRole === 'assistant' ? doc.model : undefined,
        meta: role === 'system' || role === 'developer' ? { role } : undefined,
        raw: rawEntry,
      }
      steps.push(step)
      previousStepId = step.id
      anchorStepId = step.id
    }

    if (finish_reason === 'length' || finish_reason === 'content_filter') {
      const step: Step = {
        id: `${msgId}#finish`,
        parent_id: anchorStepId,
        parent_provenance: 'inferred',
        type: 'error',
        duration_provenance: 'unknown',
        content: `Response terminated: ${finish_reason}`,
        error: {
          message: `Response terminated: ${finish_reason}`,
          kind: finish_reason === 'length' ? 'abort' : 'refusal',
          provenance: 'inferred',
        },
        raw: rawEntry,
      }
      steps.push(step)
      previousStepId = step.id
      anchorStepId = step.id
    }

    if (hasToolCalls) {
      message.tool_calls!.forEach((tc, j) => {
        let input: unknown = tc.function.arguments
        if (typeof input === 'string') {
          try {
            input = JSON.parse(input)
          } catch {
            issues.push({
              severity: 'warning',
              message: `Could not parse tool_call arguments for "${tc.function.name}" as JSON`,
              step_id: `${msgId}#tc${j}`,
            })
          }
        }
        const step: Step = {
          id: `${msgId}#tc${j}`,
          parent_id: anchorStepId,
          parent_provenance: 'inferred',
          type: 'tool_use',
          duration_provenance: 'unknown',
          content: '',
          tool_name: tc.function.name,
          tool_input: input,
          tool_call_id: tc.id,
          raw: rawEntry,
        }
        steps.push(step)
        toolUseIdByCallId.set(tc.id, step.id)
        toolNameByCallId.set(tc.id, tc.function.name)
        previousStepId = step.id
      })
    }
  }

  if (doc.usage) {
    const lastAssistant = [...steps].reverse().find((s) => s.type === 'assistant')
    if (lastAssistant) {
      lastAssistant.tokens = {
        input: doc.usage.prompt_tokens,
        output: doc.usage.completion_tokens,
        total: doc.usage.total_tokens,
      }
      lastAssistant.meta = { ...lastAssistant.meta, tokens_attributed: true }
    }
  }

  const meta: Record<string, unknown> = {}
  if (doc.tool_choice !== undefined) meta.tool_choice = doc.tool_choice
  if (doc.temperature !== undefined) meta.temperature = doc.temperature
  if (doc.choices && doc.choices.length > 1) {
    issues.push({
      severity: 'warning',
      message: `${doc.choices.length - 1} additional choice(s) in the source were not rendered as steps (n > 1 responses are not branched in Layer 1).`,
    })
  }

  // finalizeTrace's fallback title is "the first type: 'user' step", but
  // system/developer messages are normalized to type 'user' too (there's no
  // dedicated StepType for them) — so a trace with a system prompt ahead of
  // the real question would otherwise show that boilerplate as its title.
  // Pick the first message whose *original* role was genuinely 'user'.
  const firstRealUserMessage = entries.find((e) => e.message.role === 'user')
  const title = firstRealUserMessage ? truncate(flattenContent(firstRealUserMessage.message.content), 80) : undefined

  return finalizeTrace({
    raw,
    format: 'openai-chat-completions',
    steps,
    issues,
    title,
    meta: Object.keys(meta).length > 0 ? meta : undefined,
    explicitConfidenceSource: 'logprobs',
  })
}
