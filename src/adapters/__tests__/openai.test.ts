import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detectFormat } from '../index'
import { parse } from '../openai'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const raw = readFileSync(join(fixturesDir, 'fixture-long-failure.openai.json'), 'utf-8')

describe('openai adapter', () => {
  it('is detected as openai-chat-completions', () => {
    expect(detectFormat(raw)).toBe('openai-chat-completions')
  })

  it('normalizes 8 messages into 10 steps, expanding tool_calls into their own steps', () => {
    const trace = parse(raw)
    expect(trace.format).toBe('openai-chat-completions')
    expect(trace.steps.map((s) => s.id)).toEqual([
      'msg-0',
      'msg-1',
      'msg-2',
      'msg-2#tc0',
      'msg-3',
      'msg-4',
      'msg-4#tc0',
      'msg-5',
      'msg-6',
      'msg-7',
    ])
    expect(trace.steps.map((s) => s.type)).toEqual([
      'user',
      'user',
      'assistant',
      'tool_use',
      'tool_result',
      'assistant',
      'tool_use',
      'tool_result',
      'assistant',
      'assistant',
    ])
  })

  it('keeps the system message as a user-typed step tagged with meta.role', () => {
    const trace = parse(raw)
    expect(trace.steps[0].meta).toEqual({ role: 'system' })
  })

  it('titles the trace from the real user question, not the system prompt ahead of it', () => {
    const trace = parse(raw)
    expect(trace.title).toBe('What was our total revenue by region last month?')
  })

  it('pairs tool_use/tool_result via tool_call_id with source-provenance lineage', () => {
    const trace = parse(raw)
    const result = trace.steps.find((s) => s.id === 'msg-3')!
    expect(result.parent_id).toBe('msg-2#tc0')
    expect(result.parent_provenance).toBe('source')
    expect(result.tool_name).toBe('run_sql')
  })

  it('parses JSON-encoded tool_call arguments into an object', () => {
    const trace = parse(raw)
    const toolUse = trace.steps.find((s) => s.id === 'msg-2#tc0')!
    expect(toolUse.tool_input).toEqual({
      query: "SELECT region, SUM(amount) FROM revenue WHERE month = '2026-02' GROUP BY region",
    })
  })

  it('infers tool errors from ERROR-prefixed tool content and marks both ToolCalls as errored', () => {
    const trace = parse(raw)
    // error_count matches the timeline's red status count: both failed
    // tool_result steps AND their originating tool_use steps (4), not just
    // the 2 steps that carry an explicit `error` field.
    expect(trace.stats.error_count).toBe(4)
    expect(trace.tool_calls).toHaveLength(2)
    for (const call of trace.tool_calls) {
      expect(call.status).toBe('error')
      expect(call.error?.kind).toBe('tool_error')
    }
  })

  it('attributes response-level usage to the last assistant step', () => {
    const trace = parse(raw)
    const lastAssistant = trace.steps.at(-1)!
    expect(lastAssistant.id).toBe('msg-7')
    expect(lastAssistant.tokens).toEqual({ input: 3120, output: 214, total: 3334 })
    expect(lastAssistant.meta?.tokens_attributed).toBe(true)
    expect(trace.stats.tokens).toEqual({ input: 3120, output: 214, total: 3334 })
  })

  it('has no source timestamps, so duration is unknown rather than fabricated', () => {
    const trace = parse(raw)
    expect(trace.stats.duration_provenance).toBe('unknown')
    expect(trace.stats.duration_ms).toBeUndefined()
    expect(trace.model).toBe('gpt-4o-2024-11-20')
  })
})
