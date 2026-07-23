import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detectFormat } from '../index'
import { parse } from '../claude-code'

// A software engineering agent writes a file, runs pytest, fails with
// ImportError, rewrites the file (introducing a typo), reruns the identical
// pytest command, fails with ModuleNotFoundError, then reruns the same
// command a third time and fails again unchanged. Exists to demonstrate the
// retry_pressure / epistemic-loop confidence heuristic
// (src/adapters/confidence.ts) on a realistic trace.
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const raw = readFileSync(join(fixturesDir, 'swe_bench_failed_run.jsonl'), 'utf-8')

describe('swe-bench failed run fixture', () => {
  it('is detected as claude-code-jsonl and expands 12 lines into 17 steps', () => {
    expect(detectFormat(raw)).toBe('claude-code-jsonl')
    const trace = parse(raw)
    expect(trace.steps).toHaveLength(17)
  })

  it('reruns the identical pytest command three times', () => {
    const trace = parse(raw)
    const bashCalls = trace.tool_calls.filter((c) => c.tool_name === 'Bash')
    expect(bashCalls).toHaveLength(3)
    const inputs = bashCalls.map((c) => JSON.stringify(c.tool_input))
    expect(new Set(inputs).size).toBe(1)
    expect(bashCalls.every((c) => c.status === 'error')).toBe(true)
  })

  it('fails with ImportError first, then ModuleNotFoundError twice', () => {
    const trace = parse(raw)
    const errors = trace.steps.filter((s) => s.error).map((s) => s.error!.message)
    expect(errors).toHaveLength(3)
    expect(errors[0]).toMatch(/ImportError/)
    expect(errors[1]).toMatch(/ModuleNotFoundError/)
    expect(errors[2]).toMatch(/ModuleNotFoundError/)
    // error_count matches the timeline's red status count: 3 failed
    // tool_result steps plus the 3 Bash tool_use steps that triggered them.
    expect(trace.stats.error_count).toBe(6)
  })

  it('flags retry_pressure and a confidence collapse on the final give-up message', () => {
    const trace = parse(raw)
    const final = trace.steps.at(-1)!
    expect(final.type).toBe('assistant')
    expect(final.content).toMatch(/not sure/i)

    const retryComponent = final.confidence?.components?.find((c) => c.name === 'retry_pressure')
    expect(retryComponent).toBeDefined()
    expect(retryComponent!.contribution).toBeLessThan(0)

    const firstAssistant = trace.steps.find((s) => s.type === 'assistant')!
    expect((final.confidence?.value ?? 1)).toBeLessThan(firstAssistant.confidence?.value ?? 0)
  })
})
