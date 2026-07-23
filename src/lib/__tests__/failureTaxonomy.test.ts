import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detectFailures, groupEvidenceByLabel } from '../failureTaxonomy'
import type { FailureEvidence } from '../failureTaxonomy'
import { parseTrace } from '../../adapters'
import type { NormalizedTrace, Step, ToolCall } from '../../types'
import { makeTrace, step } from './testHelpers'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

function byMode(detections: ReturnType<typeof detectFailures>, mode: string) {
  const found = detections.find((d) => d.mode === mode)
  if (!found) throw new Error(`no detection for mode ${mode}`)
  return found
}

describe('detectFailures: always returns all five modes', () => {
  it('returns exactly the five canonical modes, in order, for an empty trace', () => {
    const detections = detectFailures(makeTrace())
    expect(detections.map((d) => d.mode)).toEqual([
      'tool_execution',
      'retrieval_abandonment',
      'planner_oscillation',
      'observation_ignored',
      'premature_termination',
    ])
    for (const d of detections) {
      expect(d.likelihood).toBe('none')
      expect(d.confidence).toBe(0)
      expect(d.evidence).toEqual([])
    }
  })
})

describe('tool_execution', () => {
  it('flags each step with an explicit error, scaling likelihood with count', () => {
    const steps = [
      step('r0', { type: 'tool_result', tool_name: 'Bash', error: { message: 'boom', kind: 'tool_error', provenance: 'source' } }),
      step('r1', { type: 'tool_result', tool_name: 'Bash', error: { message: 'boom again', kind: 'tool_error', provenance: 'source' } }),
    ]
    const d = byMode(detectFailures(makeTrace({ steps })), 'tool_execution')
    expect(d.likelihood).toBe('medium')
    expect(d.evidence).toHaveLength(2)
    expect(d.evidence.map((e) => e.stepIds)).toEqual([['r0'], ['r1']])
    expect(d.summary).toBe('Multiple tool invocations failed during execution.')
  })

  it('is none when nothing failed', () => {
    const d = byMode(detectFailures(makeTrace({ steps: [step('a0', { content: 'all good' })] })), 'tool_execution')
    expect(d.likelihood).toBe('none')
    expect(d.evidence).toEqual([])
  })
})

describe('retrieval_abandonment', () => {
  const retrievedContent =
    'The deployment guide says to run migrate.sh before starting the server and to check the config file for the database connection string.'

  function traceWithFollowUps(followUps: string[]): NormalizedTrace {
    const steps = [
      step('t0', { type: 'tool_use', tool_name: 'search_docs', tool_input: { query: 'deployment steps' } }),
      step('r0', { type: 'tool_result', tool_name: 'search_docs', content: retrievedContent, tool_output: retrievedContent }),
      ...followUps.map((text, i) => step(`a${i}`, { type: 'assistant', content: text })),
    ]
    const tool_calls: ToolCall[] = [
      {
        id: 't0',
        step_id: 't0',
        result_step_id: 'r0',
        tool_name: 'search_docs',
        tool_output: retrievedContent,
        status: 'ok',
        duration_provenance: 'unknown',
      },
    ]
    return makeTrace({ steps, tool_calls })
  }

  it('flags a retrieval whose content is never referenced afterward', () => {
    const trace = traceWithFollowUps(['Sounds good, thanks!', "Let's move on to the next task then."])
    const d = byMode(detectFailures(trace), 'retrieval_abandonment')
    expect(d.likelihood).toBe('low')
    expect(d.evidence).toHaveLength(1)
    expect(d.evidence[0].stepIds).toContain('r0')
    expect(d.summary).toBe('The agent retrieved information but never incorporated it.')
  })

  it('does not flag a retrieval that is referenced afterward', () => {
    const trace = traceWithFollowUps(["I'll run migrate.sh before starting the server, per the deployment guide."])
    const d = byMode(detectFailures(trace), 'retrieval_abandonment')
    expect(d.likelihood).toBe('none')
    expect(d.evidence).toEqual([])
  })

  it('ignores non-retrieval tools entirely', () => {
    const steps = [
      step('t0', { type: 'tool_use', tool_name: 'Bash', tool_input: { command: 'ls' } }),
      step('r0', { type: 'tool_result', tool_name: 'Bash', content: 'some long directory listing output that goes on for a while here' }),
      step('a0', { type: 'assistant', content: 'unrelated follow-up message' }),
    ]
    const d = byMode(detectFailures(makeTrace({ steps })), 'retrieval_abandonment')
    expect(d.likelihood).toBe('none')
  })
})

describe('planner_oscillation', () => {
  it('flags 3+ near-identical repeated calls to the same tool', () => {
    const steps = [
      step('t0', { type: 'tool_use', tool_name: 'run_sql', tool_input: { query: "SELECT * FROM revenue WHERE month = '01'" } }),
      step('t1', { type: 'tool_use', tool_name: 'run_sql', tool_input: { query: "SELECT * FROM revenue WHERE month = '01'" } }),
      step('t2', { type: 'tool_use', tool_name: 'run_sql', tool_input: { query: "SELECT * FROM revenue WHERE month = '01'" } }),
    ]
    const tool_calls: ToolCall[] = steps.map((s) => ({
      id: s.id,
      step_id: s.id,
      tool_name: 'run_sql',
      tool_output: 'ERROR: relation "revenue" does not exist',
      status: 'error',
      duration_provenance: 'unknown',
    }))
    const d = byMode(detectFailures(makeTrace({ steps, tool_calls })), 'planner_oscillation')
    expect(d.likelihood).toBe('medium')
    expect(d.evidence).toHaveLength(1)
    expect(d.evidence[0].stepIds).toEqual(['t0', 't1', 't2'])
    expect(d.summary).toBe('The planner repeatedly explored nearly identical actions.')
  })

  it('does not flag calls with dissimilar inputs and dissimilar results', () => {
    const steps = [
      step('t0', { type: 'tool_use', tool_name: 'Bash', tool_input: { command: 'ls -la /var/log' } }),
      step('t1', { type: 'tool_use', tool_name: 'Bash', tool_input: { command: 'curl https://example.com/api/v2/status' } }),
      step('t2', { type: 'tool_use', tool_name: 'Bash', tool_input: { command: 'python -m pytest tests/ -k slow' } }),
    ]
    const tool_calls: ToolCall[] = [
      { id: 't0', step_id: 't0', tool_name: 'Bash', tool_output: 'drwxr-xr-x 2 root root 4096', status: 'ok', duration_provenance: 'unknown' },
      { id: 't1', step_id: 't1', tool_name: 'Bash', tool_output: '{"status":"ok","uptime":98213}', status: 'ok', duration_provenance: 'unknown' },
      { id: 't2', step_id: 't2', tool_name: 'Bash', tool_output: '5 passed in 12.3s', status: 'ok', duration_provenance: 'unknown' },
    ]
    const d = byMode(detectFailures(makeTrace({ steps, tool_calls })), 'planner_oscillation')
    expect(d.likelihood).toBe('none')
  })

  it('does not flag a single repeat below the minimum', () => {
    const steps = [
      step('t0', { type: 'tool_use', tool_name: 'Bash', tool_input: { command: 'x' } }),
      step('t1', { type: 'tool_use', tool_name: 'Bash', tool_input: { command: 'x' } }),
    ]
    const d = byMode(detectFailures(makeTrace({ steps })), 'planner_oscillation')
    expect(d.likelihood).toBe('low')
    expect(d.evidence).toHaveLength(1)
    expect(d.evidence[0].stepIds).toEqual(['t0', 't1'])
  })
})

describe('observation_ignored', () => {
  it('flags an error-signaling result the next response does not acknowledge', () => {
    const steps = [
      step('r0', { type: 'tool_result', tool_name: 'Read', content: 'Error: file not found at /tmp/report.csv' }),
      step('a0', { type: 'assistant', content: 'Great, the report has been generated successfully.' }),
    ]
    const d = byMode(detectFailures(makeTrace({ steps })), 'observation_ignored')
    expect(d.likelihood).toBe('low')
    expect(d.evidence).toHaveLength(1)
    expect(d.evidence[0].stepIds).toEqual(['r0', 'a0'])
  })

  it('does not flag when the next response acknowledges the problem', () => {
    const steps = [
      step('r0', { type: 'tool_result', tool_name: 'Read', content: 'Error: file not found at /tmp/report.csv' }),
      step('a0', { type: 'assistant', content: "It looks like that file wasn't found — let me try a different path instead." }),
    ]
    const d = byMode(detectFailures(makeTrace({ steps })), 'observation_ignored')
    expect(d.likelihood).toBe('none')
  })

  it('does not flag a clean tool result', () => {
    const steps = [
      step('r0', { type: 'tool_result', tool_name: 'Read', content: 'file contents loaded successfully' }),
      step('a0', { type: 'assistant', content: 'Got it, moving on.' }),
    ]
    const d = byMode(detectFailures(makeTrace({ steps })), 'observation_ignored')
    expect(d.likelihood).toBe('none')
  })
})

describe('premature_termination', () => {
  it('flags a trace that ends mid tool-call with no closing message', () => {
    const steps = [step('a0', { content: "I'll check the config next." }), step('t0', { type: 'tool_use', tool_name: 'Read' })]
    const d = byMode(detectFailures(makeTrace({ steps })), 'premature_termination')
    expect(d.likelihood).toBe('low')
    expect(d.evidence.some((e) => e.stepIds.includes('t0'))).toBe(true)
  })

  it('flags explicit continuation language in the final message', () => {
    const steps = [step('a0', { content: 'Next I\'ll refactor the remaining functions to match this pattern.' })]
    const d = byMode(detectFailures(makeTrace({ steps })), 'premature_termination')
    expect(d.likelihood).toBe('low')
    expect(d.evidence[0].stepIds).toEqual(['a0'])
  })

  it('does not flag a message that reaches a clear conclusion', () => {
    const steps = [step('a0', { content: 'The evaluation is complete: checkpoint_47 scores 47.8% on MATH, beating the 42.1% baseline.' })]
    const d = byMode(detectFailures(makeTrace({ steps })), 'premature_termination')
    expect(d.likelihood).toBe('none')
  })
})

describe('no-failure fixture', () => {
  it('reports "none" across all five modes for a clean, successful trace', () => {
    const raw = readFileSync(join(fixturesDir, 'fixture-short-success.claude-code.jsonl'), 'utf-8')
    const detections = detectFailures(parseTrace(raw))
    for (const d of detections) {
      expect(d.likelihood).toBe('none')
      expect(d.evidence).toEqual([])
    }
  })
})

describe('determinism', () => {
  it('produces identical output across repeated calls on the same trace', () => {
    const raw = readFileSync(join(fixturesDir, 'swe_bench_failed_run.jsonl'), 'utf-8')
    const trace = parseTrace(raw)
    expect(detectFailures(trace)).toEqual(detectFailures(trace))
  })
})

describe('groupEvidenceByLabel', () => {
  it('leaves distinct labels untouched, in original order', () => {
    const evidence: FailureEvidence[] = [
      { label: 'Bash failed (tool_error)', stepIds: ['s0'] },
      { label: 'Read failed (tool_error)', stepIds: ['s1'] },
    ]
    expect(groupEvidenceByLabel(evidence)).toEqual([
      { label: 'Bash failed (tool_error)', stepIds: ['s0'], count: 1 },
      { label: 'Read failed (tool_error)', stepIds: ['s1'], count: 1 },
    ])
  })

  it('collapses repeated identical labels into one entry with a ×N suffix, keeping every stepId', () => {
    const evidence: FailureEvidence[] = [
      { label: 'Edit signaled a problem the next response did not acknowledge', stepIds: ['r0', 'a0'] },
      { label: 'Edit signaled a problem the next response did not acknowledge', stepIds: ['r1', 'a1'] },
      { label: 'Edit signaled a problem the next response did not acknowledge', stepIds: ['r2', 'a2'] },
    ]
    const grouped = groupEvidenceByLabel(evidence)
    expect(grouped).toHaveLength(1)
    expect(grouped[0].label).toBe('Edit signaled a problem the next response did not acknowledge (×3)')
    expect(grouped[0].count).toBe(3)
    expect(grouped[0].stepIds).toEqual(['r0', 'a0', 'r1', 'a1', 'r2', 'a2'])
  })

  it('groups non-adjacent duplicates together and preserves first-occurrence order across groups', () => {
    const evidence: FailureEvidence[] = [
      { label: 'A', stepIds: ['s0'] },
      { label: 'B', stepIds: ['s1'] },
      { label: 'A', stepIds: ['s2'] },
    ]
    const grouped = groupEvidenceByLabel(evidence)
    expect(grouped.map((g) => g.label)).toEqual(['A (×2)', 'B'])
    expect(grouped[0].stepIds).toEqual(['s0', 's2'])
  })

  it('returns an empty array for empty evidence', () => {
    expect(groupEvidenceByLabel([])).toEqual([])
  })
})

describe('malformed trace', () => {
  it('does not throw on steps with missing optional fields and inconsistent tool_calls', () => {
    const steps: Step[] = [
      step('u0', { type: 'user', content: '' }),
      step('t0', { type: 'tool_use', tool_name: undefined, tool_input: undefined }),
      step('r0', { type: 'tool_result', tool_name: undefined, tool_output: undefined, content: '' }),
      step('a0', { type: 'assistant', content: '' }),
    ]
    // tool_calls deliberately empty/inconsistent with the steps above.
    const trace = makeTrace({ steps, tool_calls: [] })
    expect(() => detectFailures(trace)).not.toThrow()
    expect(detectFailures(trace)).toHaveLength(5)
  })
})
