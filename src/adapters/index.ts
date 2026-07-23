// Adapter registry. `detectFormat` sniffs raw trace text; `parseTrace` runs
// the matching adapter. This is the only place viewer code should import
// adapters from — new formats are added by writing a new adapter file and
// registering it here, per ideas.md principle 4.

import type { NormalizedTrace, TraceFormat } from '../types'
import * as claudeCode from './claude-code'
import * as generic from './generic'
import * as openai from './openai'

// Real `~/.claude/projects/**/*.jsonl` session files can open with several
// non-message envelope lines — "mode", "permission-mode",
// "file-history-snapshot" — that carry a sessionId but no uuid (only actual
// message turns do). Checking line 1 alone missed every real session file
// tested against this adapter, so scan a bounded prefix instead.
const FORMAT_SNIFF_LINE_LIMIT = 20

export function detectFormat(raw: string): TraceFormat {
  const trimmed = raw.trim()
  if (!trimmed) return 'generic-json'

  const candidateLines = trimmed
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(0, FORMAT_SNIFF_LINE_LIMIT)

  for (const line of candidateLines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>
      if (obj && typeof obj === 'object' && 'uuid' in obj && ('parentUuid' in obj || 'sessionId' in obj)) {
        return 'claude-code-jsonl'
      }
    } catch {
      // this line isn't a standalone JSON object; keep scanning
    }
  }

  try {
    const doc = JSON.parse(trimmed) as Record<string, unknown>
    if (doc && typeof doc === 'object') {
      const messages = doc.messages
      if (Array.isArray(messages) && messages.length > 0 && messages[0] && typeof messages[0] === 'object' && 'role' in (messages[0] as object)) {
        return 'openai-chat-completions'
      }
      if (Array.isArray(doc.choices)) {
        return 'openai-chat-completions'
      }
    }
  } catch {
    // not a single JSON document either — fall through to generic
  }

  return 'generic-json'
}

const adapters: Record<TraceFormat, { parse: (raw: string) => NormalizedTrace }> = {
  'claude-code-jsonl': claudeCode,
  'openai-chat-completions': openai,
  'generic-json': generic,
}

export function parseTrace(raw: string): NormalizedTrace {
  const format = detectFormat(raw)
  return adapters[format].parse(raw)
}

export { claudeCode, generic, openai }
