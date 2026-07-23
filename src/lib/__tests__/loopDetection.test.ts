import { describe, expect, it } from 'vitest'
import { detectLoops, inputSimilarity } from '../loopDetection'
import type { Step } from '../../types'
import { step } from './testHelpers'

function toolUse(id: string, toolName: string, input: unknown): Step {
  return step(id, { type: 'tool_use', tool_name: toolName, tool_input: input })
}

describe('inputSimilarity', () => {
  it('is 1 for identical input', () => {
    expect(inputSimilarity({ command: 'pytest' }, { command: 'pytest' })).toBe(1)
  })

  it('is below the loop-detection threshold for clearly different input', () => {
    expect(inputSimilarity({ command: 'pytest tests/' }, { command: 'ls -la /var/log' })).toBeLessThan(0.8)
  })

  it('is 1 when both are empty/undefined', () => {
    expect(inputSimilarity(undefined, undefined)).toBe(1)
  })
})

describe('detectLoops', () => {
  it('detects 3 identical Bash calls interspersed with results and assistant text', () => {
    const steps = [
      step('u0', { type: 'user' }),
      step('a0'),
      toolUse('t0', 'Bash', { command: 'pytest tests/' }),
      step('r0', { type: 'tool_result', tool_name: 'Bash', tool_call_id: 't0' }),
      step('a1'),
      toolUse('t1', 'Bash', { command: 'pytest tests/' }),
      step('r1', { type: 'tool_result', tool_name: 'Bash', tool_call_id: 't1' }),
      step('a2'),
      toolUse('t2', 'Bash', { command: 'pytest tests/' }),
      step('r2', { type: 'tool_result', tool_name: 'Bash', tool_call_id: 't2' }),
    ]
    const groups = detectLoops(steps)
    expect(groups).toHaveLength(1)
    expect(groups[0].toolName).toBe('Bash')
    expect(groups[0].stepIds).toEqual(['t0', 't1', 't2'])
    expect(groups[0].startIndex).toBe(2)
    expect(groups[0].endIndex).toBe(8)
  })

  it('does not flag fewer than 3 matching calls', () => {
    const steps = [toolUse('t0', 'Bash', { command: 'x' }), toolUse('t1', 'Bash', { command: 'x' })]
    expect(detectLoops(steps)).toEqual([])
  })

  it('does not flag calls with dissimilar input', () => {
    const steps = [
      toolUse('t0', 'Bash', { command: 'ls' }),
      toolUse('t1', 'Bash', { command: 'find / -name "*.py" -newer /tmp/x' }),
      toolUse('t2', 'Bash', { command: 'curl https://example.com/api/v2/status?verbose=true' }),
    ]
    expect(detectLoops(steps)).toEqual([])
  })

  it('does not chain across a gap larger than LOOP_MAX_GAP', () => {
    const filler = Array.from({ length: 8 }, (_, i) => step(`filler${i}`))
    const steps = [toolUse('t0', 'Bash', { command: 'x' }), ...filler, toolUse('t1', 'Bash', { command: 'x' }), toolUse('t2', 'Bash', { command: 'x' })]
    // t0 -> t1 gap is 9 (> 6), so t0 starts a fresh chain broken before t1;
    // t1/t2 alone don't reach the minimum size of 3.
    expect(detectLoops(steps)).toEqual([])
  })

  it('does NOT break the chain on an interleaved different tool_name, as long as the same-tool gap stays within LOOP_MAX_GAP', () => {
    // The canonical shape this feature exists to catch: Bash fails, the
    // agent "fixes" the file with an unrelated Write in between, reruns
    // Bash, fails again — same story as the swe_bench_failed_run fixture.
    // "within N steps of each other" is a distance constraint between the
    // matching calls, not a requirement that nothing else happens between them.
    const steps = [
      toolUse('t0', 'Bash', { command: 'pytest' }),
      step('r0', { type: 'tool_result' }),
      toolUse('t1', 'Write', { file_path: 'a.py' }),
      step('r1', { type: 'tool_result' }),
      toolUse('t2', 'Bash', { command: 'pytest' }),
      step('r2', { type: 'tool_result' }),
      toolUse('t3', 'Bash', { command: 'pytest' }),
    ]
    const groups = detectLoops(steps)
    expect(groups).toHaveLength(1)
    expect(groups[0].toolName).toBe('Bash')
    expect(groups[0].stepIds).toEqual(['t0', 't2', 't3'])
  })

  it('still breaks the chain when the same-tool gap itself exceeds LOOP_MAX_GAP, even counting through an interleaved tool', () => {
    const farApart = Array.from({ length: 7 }, (_, i) => step(`filler${i}`))
    const steps = [toolUse('t0', 'Bash', { command: 'x' }), ...farApart, toolUse('t1', 'Bash', { command: 'x' }), toolUse('t2', 'Bash', { command: 'x' })]
    // t0 -> t1 is 8 apart (> 6), so only t1/t2 could chain — 2 calls, below
    // the minimum loop size of 3.
    expect(detectLoops(steps)).toEqual([])
  })

  it('drops the later group when two different tools chain in interleaved, overlapping ranges', () => {
    // A and B each retry 3x in alternation: A0 B0 A1 B1 A2 B2 (indices 0-5).
    // Both qualify as their own loop, but the ranges overlap (A: 0-4, B:
    // 1-5) — every consumer assumes one step index maps to at most one
    // group, so keeping both would silently reassign A's tail steps to B.
    const steps = [
      toolUse('a0', 'A', { x: 1 }),
      toolUse('b0', 'B', { x: 1 }),
      toolUse('a1', 'A', { x: 1 }),
      toolUse('b1', 'B', { x: 1 }),
      toolUse('a2', 'A', { x: 1 }),
      toolUse('b2', 'B', { x: 1 }),
    ]
    const groups = detectLoops(steps)
    expect(groups).toHaveLength(1)
    expect(groups[0].toolName).toBe('A')
    expect(groups[0].startIndex).toBe(0)
    expect(groups[0].endIndex).toBe(4)
  })

  it('detects a loop with slight parameter drift (still >80% similar)', () => {
    const steps = [
      toolUse('t0', 'run_sql', { query: "SELECT * FROM revenue WHERE month = '2026-01'" }),
      toolUse('t1', 'run_sql', { query: "SELECT * FROM revenue WHERE month = '2026-02'" }),
      toolUse('t2', 'run_sql', { query: "SELECT * FROM revenue WHERE month = '2026-03'" }),
    ]
    const groups = detectLoops(steps)
    expect(groups).toHaveLength(1)
    expect(groups[0].stepIds).toHaveLength(3)
  })
})
