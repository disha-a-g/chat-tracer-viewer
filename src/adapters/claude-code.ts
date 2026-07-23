// Claude Code JSONL adapter. One line = one envelope wrapping an Anthropic
// `message`; one line can expand into N steps (one per content block).

import type { NormalizedTrace, Step, TraceIssue } from '../types'
import { finalizeTrace } from './finalize'

interface ContentBlock {
  type: string
  text?: string
  thinking?: string
  signature?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

interface ClaudeCodeLine {
  uuid: string
  parentUuid: string | null
  timestamp?: string
  sessionId?: string
  cwd?: string
  version?: string
  type?: string
  isSidechain?: boolean
  userType?: string
  requestId?: string
  isMeta?: boolean
  summary?: string
  message?: {
    role?: string
    model?: string
    usage?: Record<string, number>
    content?: ContentBlock[] | string
  }
  toolUseResult?: unknown
}

function blocksFor(line: ClaudeCodeLine): ContentBlock[] {
  const content = line.message?.content
  if (content == null) return []
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (Array.isArray(content)) return content
  return []
}

function stringifyToolOutput(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c
        if (c && typeof c === 'object' && 'text' in c) return String((c as { text?: unknown }).text ?? '')
        return JSON.stringify(c)
      })
      .join('\n')
  }
  if (content && typeof content === 'object') return JSON.stringify(content)
  return String(content ?? '')
}

/** Pulls the single most useful line out of a (possibly long) tool output for
 *  the one-line TraceError.message: pytest's "E   SomeError: detail" line,
 *  a bare "SomeError: detail" line, or else the first non-empty line. Falls
 *  back to a truncated prefix so this never throws on unexpected shapes. */
function extractErrorMessage(text: string): string {
  const pytestLine = text.match(/^E\s+(\S+(?:Error|Exception):.*)$/m)
  if (pytestLine) return pytestLine[1].trim().slice(0, 500)

  const exceptionLine = text.match(/^([A-Za-z_][\w.]*(?:Error|Exception):.*)$/m)
  if (exceptionLine) return exceptionLine[1].trim().slice(0, 500)

  const firstLine = text.split('\n').find((l) => l.trim().length > 0)
  return (firstLine ?? text).trim().slice(0, 500) || 'Tool call failed'
}

export function parse(raw: string): NormalizedTrace {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const issues: TraceIssue[] = []
  const steps: Step[] = []
  let title: string | undefined
  let traceMeta: Record<string, unknown> | undefined
  const toolNameByCallId = new Map<string, string>()

  for (const line of lines) {
    let parsed: ClaudeCodeLine
    try {
      parsed = JSON.parse(line) as ClaudeCodeLine
    } catch {
      issues.push({ severity: 'warning', message: `Skipped unparseable line: ${line.slice(0, 80)}` })
      continue
    }

    if (!traceMeta && (parsed.sessionId || parsed.cwd || parsed.version)) {
      traceMeta = { sessionId: parsed.sessionId, cwd: parsed.cwd, version: parsed.version }
    }

    if (parsed.type === 'summary') {
      if (parsed.summary) title = parsed.summary
      continue
    }
    if (parsed.type === 'system' && parsed.isMeta !== false) {
      continue
    }

    const role = parsed.type === 'user' || parsed.type === 'assistant' ? parsed.type : undefined
    const blocks = blocksFor(parsed)
    if (blocks.length === 0) continue

    blocks.forEach((block, j) => {
      const id = j === 0 ? parsed.uuid : `${parsed.uuid}#${j}`
      const parent_id = j === 0 ? (parsed.parentUuid ?? null) : parsed.uuid

      const step: Step = {
        id,
        parent_id,
        parent_provenance: 'source',
        type: role ?? 'assistant',
        timestamp: parsed.timestamp,
        duration_provenance: 'inferred',
        content: '',
        meta: {
          isSidechain: parsed.isSidechain,
          userType: parsed.userType,
          requestId: parsed.requestId,
        },
        raw: parsed,
      }

      if (block.type === 'text') {
        step.content = block.text ?? ''
      } else if (block.type === 'thinking') {
        step.type = 'thinking'
        step.content = block.thinking ?? ''
        step.meta = { ...step.meta, signature: block.signature }
      } else if (block.type === 'tool_use') {
        step.type = 'tool_use'
        step.tool_name = block.name
        step.tool_input = block.input
        step.tool_call_id = block.id
        if (block.id && block.name) toolNameByCallId.set(block.id, block.name)
      } else if (block.type === 'tool_result') {
        step.type = 'tool_result'
        step.tool_call_id = block.tool_use_id
        step.tool_name = block.tool_use_id ? toolNameByCallId.get(block.tool_use_id) : undefined
        step.tool_output = block.content
        step.content = stringifyToolOutput(block.content)
        if (parsed.toolUseResult != null) {
          step.meta = { ...step.meta, toolUseResult: parsed.toolUseResult }
          step.tool_output = parsed.toolUseResult
        }
        if (block.is_error) {
          step.error = {
            message: extractErrorMessage(stringifyToolOutput(block.content)),
            kind: 'tool_error',
            provenance: 'source',
          }
        }
      } else {
        step.content = `[${block.type}]`
      }

      if (j === 0 && role === 'assistant' && parsed.message) {
        step.model = parsed.message.model
        if (parsed.message.usage) {
          const u = parsed.message.usage
          const input = u.input_tokens
          const output = u.output_tokens
          step.tokens = {
            input,
            output,
            cache_read: u.cache_read_input_tokens,
            cache_creation: u.cache_creation_input_tokens,
            total: input !== undefined || output !== undefined ? (input ?? 0) + (output ?? 0) : undefined,
          }
        }
      }

      steps.push(step)
    })
  }

  return finalizeTrace({
    raw,
    format: 'claude-code-jsonl',
    steps,
    issues,
    title,
    meta: traceMeta,
    explicitConfidenceSource: 'never',
  })
}
