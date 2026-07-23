import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detectFormat } from '../index'
import { parse } from '../claude-code'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const raw = readFileSync(join(fixturesDir, 'fixture-short-success.claude-code.jsonl'), 'utf-8')

describe('claude-code adapter', () => {
  it('is detected as claude-code-jsonl', () => {
    expect(detectFormat(raw)).toBe('claude-code-jsonl')
  })

  it('expands one line with two content blocks into two steps with shared lineage', () => {
    const trace = parse(raw)
    expect(trace.format).toBe('claude-code-jsonl')
    expect(trace.steps.map((s) => s.id)).toEqual([
      'a1f0c2d4-0001',
      'a1f0c2d4-0002',
      'a1f0c2d4-0002#1',
      'a1f0c2d4-0003',
      'a1f0c2d4-0004',
    ])
    expect(trace.steps.map((s) => s.type)).toEqual(['user', 'assistant', 'tool_use', 'tool_result', 'assistant'])

    const toolUse = trace.steps[2]
    expect(toolUse.parent_id).toBe('a1f0c2d4-0002')
    expect(toolUse.parent_provenance).toBe('source')
    expect(toolUse.tool_name).toBe('Bash')
    expect(toolUse.tool_input).toEqual({ command: 'wc -l < data/users.csv', description: 'Count rows in users.csv' })
  })

  it('prefers toolUseResult sidecar as tool_output and copies tool_name from the matching tool_use', () => {
    const trace = parse(raw)
    const toolResult = trace.steps.find((s) => s.id === 'a1f0c2d4-0003')!
    expect(toolResult.type).toBe('tool_result')
    expect(toolResult.tool_name).toBe('Bash')
    expect(toolResult.content).toBe('    4821')
    expect(toolResult.tool_output).toEqual({ stdout: '    4821\n', stderr: '', exit_code: 0 })
  })

  it('joins tool_use/tool_result into a single ok ToolCall', () => {
    const trace = parse(raw)
    expect(trace.tool_calls).toHaveLength(1)
    expect(trace.tool_calls[0]).toMatchObject({
      step_id: 'a1f0c2d4-0002#1',
      result_step_id: 'a1f0c2d4-0003',
      tool_name: 'Bash',
      status: 'ok',
    })
  })

  it('sums token usage across assistant steps and computes duration from timestamps', () => {
    const trace = parse(raw)
    expect(trace.stats).toMatchObject({
      step_count: 5,
      tool_call_count: 1,
      error_count: 0,
      model_call_count: 2,
      duration_ms: 4788,
      duration_provenance: 'source',
    })
    expect(trace.stats.tokens).toEqual({ input: 2645, output: 69, cache_read: 2308, total: 2714 })
    expect(trace.model).toBe('claude-opus-4-8')
  })

  it('has no explicit confidence signal (Claude Code never carries one)', () => {
    const trace = parse(raw)
    expect(trace.has_explicit_confidence).toBe(false)
    const assistantSteps = trace.steps.filter((s) => s.type === 'assistant')
    for (const step of assistantSteps) {
      expect(step.confidence?.provenance).toBe('inferred')
    }
  })
})
