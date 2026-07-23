import { describe, expect, it } from 'vitest'
import { computeLargestConfidenceDrop, computeLongestPause } from '../temporalSignals'
import { step } from './testHelpers'

const BASE_TIME = Date.parse('2024-01-01T00:00:00.000Z')
function at(ms: number): string {
  return new Date(BASE_TIME + ms).toISOString()
}

describe('computeLargestConfidenceDrop', () => {
  it('returns undefined when nothing drops sharply', () => {
    const steps = [
      step('a0', { confidence: { value: 0.9, provenance: 'inferred' } }),
      step('a1', { confidence: { value: 0.85, provenance: 'inferred' } }),
    ]
    expect(computeLargestConfidenceDrop(steps)).toBeUndefined()
  })

  it('reports before/after values and the worst contributing cause for the sharpest drop', () => {
    const steps = [
      step('a0', { confidence: { value: 0.9, provenance: 'inferred' } }),
      step('a1', { confidence: { value: 0.85, provenance: 'inferred' } }), // small drop, not sharp
      step('a2', {
        confidence: {
          value: 0.2,
          provenance: 'inferred',
          components: [
            { name: 'hedging_density', contribution: -0.1, detail: 'mild hedging' },
            { name: 'error_proximity', contribution: -0.3, detail: '2 errors nearby' },
          ],
        },
      }),
    ]
    const drop = computeLargestConfidenceDrop(steps)
    expect(drop).toEqual({ stepId: 'a2', before: 0.85, after: 0.2, cause: '2 errors nearby' })
  })
})

describe('computeLongestPause', () => {
  it('flags a pause far longer than the typical gap, describing what followed it', () => {
    const steps = [
      step('s0', { timestamp: at(0) }),
      step('s1', { timestamp: at(1000) }),
      step('s2', { timestamp: at(2000) }),
      step('s3', { type: 'tool_use', tool_name: 'Bash', timestamp: at(30_000) }),
    ]
    const pause = computeLongestPause(steps)
    expect(pause).toEqual({ stepId: 's3', ms: 28_000, followingDescription: 'a new Bash call' })
  })

  it('does not flag a pause below the absolute floor', () => {
    const steps = [step('s0', { timestamp: at(0) }), step('s1', { timestamp: at(100) }), step('s2', { timestamp: at(200) }), step('s3', { timestamp: at(1000) })]
    expect(computeLongestPause(steps)).toBeUndefined()
  })

  it('returns undefined with fewer than 4 timed steps', () => {
    const steps = [step('s0', { timestamp: at(0) }), step('s1', { timestamp: at(60_000) })]
    expect(computeLongestPause(steps)).toBeUndefined()
  })
})
