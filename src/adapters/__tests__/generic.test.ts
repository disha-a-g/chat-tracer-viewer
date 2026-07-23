import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detectFormat } from '../index'
import { parse } from '../generic'

// Reconstructed from a real PHI-detection pipeline's own stdout/log
// artifacts: a root array of step-like objects from a pipeline with no
// native trace format, which is exactly the case the generic adapter
// exists for.
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const raw = readFileSync(join(fixturesDir, 'fixture-pcori-success.generic.json'), 'utf-8')

describe('generic adapter', () => {
  it('is detected as generic-json (root array, no Claude Code or OpenAI shape)', () => {
    expect(detectFormat(raw)).toBe('generic-json')
  })

  it('finds the root array and maps type synonyms directly (tool_use, assistant pass through)', () => {
    const trace = parse(raw)
    expect(trace.format).toBe('generic-json')
    expect(trace.steps).toHaveLength(10)
    expect(trace.steps.map((s) => s.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `step_${String(i + 1).padStart(3, '0')}`),
    )
    expect(trace.steps.filter((s) => s.type === 'tool_use')).toHaveLength(9)
    expect(trace.steps.filter((s) => s.type === 'assistant')).toHaveLength(1)
  })

  it('falls back to linear parent lineage since the source has no parent field', () => {
    const trace = parse(raw)
    expect(trace.steps[0].parent_id).toBeNull()
    expect(trace.steps[0].parent_provenance).toBe('inferred')
    expect(trace.steps[1].parent_id).toBe('step_001')
    expect(trace.steps[1].parent_provenance).toBe('inferred')
  })

  it('drops null timestamp/duration/error/confidence placeholders rather than treating them as values', () => {
    const trace = parse(raw)
    for (const step of trace.steps) {
      expect(step.timestamp).toBeUndefined()
      expect(step.duration_ms).toBeUndefined()
      expect(step.error).toBeUndefined()
    }
    expect(trace.stats.error_count).toBe(0)
  })

  it('flags every tool_use as pending, since this source inlines results rather than emitting separate tool_result steps', () => {
    const trace = parse(raw)
    expect(trace.tool_calls).toHaveLength(9)
    expect(trace.tool_calls.every((c) => c.status === 'pending')).toBe(true)
    expect(trace.issues.filter((i) => i.message.includes('no matching tool_result'))).toHaveLength(9)
  })

  it('preserves the whole source object on every step for the raw view', () => {
    const trace = parse(raw)
    const step7 = trace.steps.find((s) => s.id === 'step_007')!
    expect(step7.raw).toMatchObject({ id: 'step_007', tool_name: '03_predict.predict_text' })
  })

  it('only scores confidence on the single assistant step', () => {
    const trace = parse(raw)
    const scored = trace.steps.filter((s) => s.confidence !== undefined)
    expect(scored).toHaveLength(1)
    expect(scored[0].id).toBe('step_009')
    expect(scored[0].confidence?.provenance).toBe('inferred')
  })

  it('infers a tool_use duration from a fallback-matched tool_result even with no shared call id', () => {
    // This source has no id linking tool_use to tool_result at all — the
    // only pairing signal is "same tool name, next one after it" (the same
    // fallback buildToolCalls uses for its own step_id/result_step_id join).
    // Duration inference has to see that exact same pairing, not just a
    // tool_call_id it doesn't have.
    const withPair = JSON.stringify([
      { type: 'user', content: 'go', timestamp: '2024-01-01T00:00:00.000Z' },
      { type: 'tool_use', tool: 'search', input: { q: 'x' }, timestamp: '2024-01-01T00:00:00.000Z' },
      { type: 'tool_result', tool: 'search', output: 'found it', timestamp: '2024-01-01T00:00:05.000Z' },
    ])
    const trace = parse(withPair)
    const toolUse = trace.steps.find((s) => s.type === 'tool_use')!
    expect(toolUse.duration_ms).toBe(5000)
    expect(toolUse.duration_provenance).toBe('inferred')
    expect(trace.tool_calls[0].duration_ms).toBe(5000)
  })
})
