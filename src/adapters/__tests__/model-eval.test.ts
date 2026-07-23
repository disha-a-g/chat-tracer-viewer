import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detectFormat } from '../index'
import { parse } from '../claude-code'

// A research agent evaluates checkpoint_47 on MATH, hits a CUDA OOM on the
// first run, fixes it (smaller batch size + no_grad), reruns successfully,
// and reports a win over baseline. Five assistant "decisions": write script,
// run (OOM), react + rewrite (confidence should drop here), rerun (succeeds),
// report vs. baseline (confidence should recover here).
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const raw = readFileSync(join(fixturesDir, 'model_eval_failed_run.jsonl'), 'utf-8')

describe('model-eval failed run fixture', () => {
  it('is detected as claude-code-jsonl with the expected shape', () => {
    expect(detectFormat(raw)).toBe('claude-code-jsonl')
    const trace = parse(raw)
    expect(trace.steps).toHaveLength(14)
    expect(trace.tool_calls.map((c) => c.tool_name)).toEqual(['Write', 'Bash', 'Write', 'Bash'])
  })

  it('fails the first GPU run with a CUDA OOM and succeeds on the retry with a smaller batch size', () => {
    const trace = parse(raw)
    // error_count matches the timeline's red status count: the failed
    // tool_result plus the Bash tool_use step that triggered it.
    expect(trace.stats.error_count).toBe(2)
    const [write1, bash1, write2, bash2] = trace.tool_calls
    expect(bash1.status).toBe('error')
    expect(bash1.error?.message).toMatch(/CUDA out of memory/)
    expect(bash2.status).toBe('ok')
    expect(write1.tool_input).not.toEqual(write2.tool_input)
  })

  it('drops confidence on the OOM reaction (step 3) and recovers on the final report (step 5)', () => {
    const trace = parse(raw)
    const assistantSteps = trace.steps.filter((s) => s.type === 'assistant')
    expect(assistantSteps).toHaveLength(5)
    const [writeScript, runOnGpu, reactToOom, rerun, finalReport] = assistantSteps.map((s) => s.confidence!.value)

    // Drop: the OOM-reaction step is markedly less confident than the two
    // steps that preceded the failure.
    expect(reactToOom).toBeLessThan(writeScript)
    expect(reactToOom).toBeLessThan(runOnGpu)

    // Recovery: the final baseline-comparison report is back above the
    // OOM-reaction dip.
    expect(finalReport).toBeGreaterThan(reactToOom)
    expect(rerun).toBeGreaterThanOrEqual(reactToOom)
  })

  it('reports the accuracy win over baseline in the final step', () => {
    const trace = parse(raw)
    const final = trace.steps.at(-1)!
    expect(final.content).toMatch(/47\.8%/)
    expect(final.content).toMatch(/42\.1%/)
  })
})
