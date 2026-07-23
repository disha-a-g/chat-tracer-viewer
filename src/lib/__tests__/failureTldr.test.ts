import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generateFailureTldr } from '../failureTldr'
import { parseTrace } from '../../adapters'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

function loadTrace(filename: string) {
  return parseTrace(readFileSync(join(fixturesDir, filename), 'utf-8'))
}

describe('generateFailureTldr', () => {
  it('returns null for a trace with no errors', () => {
    const trace = loadTrace('fixture-short-success.claude-code.jsonl')
    expect(generateFailureTldr(trace)).toBeNull()
  })

  it('describes recovery when the same tool eventually succeeds (MATH eval / CUDA OOM)', () => {
    const trace = loadTrace('model_eval_failed_run.jsonl')
    const tldr = generateFailureTldr(trace)
    expect(tldr).toMatch(/^This trace hit a failure but recovered\./)
    expect(tldr).toContain('Bash failed with a tool error')
    expect(tldr).toContain('a later Bash call succeeded')
  })

  it('describes repeated retries with no recovery (SWE-bench retry loop)', () => {
    const trace = loadTrace('swe_bench_failed_run.jsonl')
    const tldr = generateFailureTldr(trace)
    expect(tldr).toBe('This trace ended in failure. Bash failed with a tool error. The agent then retried 2 times.')
  })

  it('describes a single retry with no recovery (OpenAI revenue query)', () => {
    const trace = loadTrace('fixture-long-failure.openai.json')
    const tldr = generateFailureTldr(trace)
    expect(tldr).toBe('This trace ended in failure. run_sql failed with a tool error. The agent then retried 1 time.')
  })

  it('reports "gave up" when the failing tool is never called again', () => {
    const trace = parseTrace(
      JSON.stringify([
        { id: 's0', type: 'user', content: 'do the thing' },
        {
          id: 's1',
          type: 'tool_use',
          tool_name: 'run_query',
          input: { q: 'SELECT 1' },
        },
        {
          id: 's2',
          type: 'tool_result',
          tool_name: 'run_query',
          error: 'permission denied',
        },
        { id: 's3', type: 'assistant', content: 'I cannot proceed without access.' },
      ]),
    )
    expect(generateFailureTldr(trace)).toBe(
      'This trace ended in failure. run_query failed with an error. The agent then gave up.',
    )
  })
})
