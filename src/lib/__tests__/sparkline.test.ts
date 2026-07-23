import { describe, expect, it } from 'vitest'
import { computeSparklinePoints, computeYDomain } from '../sparkline'
import { step } from './testHelpers'

describe('computeSparklinePoints', () => {
  it('skips steps without a confidence signal, keeping the original step index', () => {
    const steps = [
      step('s0', { type: 'user', content: 'hi' }),
      step('s1', { confidence: { value: 0.8, provenance: 'inferred' } }),
      step('s2', { type: 'tool_use' }),
      step('s3', { confidence: { value: 0.75, provenance: 'inferred' } }),
    ]
    const points = computeSparklinePoints(steps)
    expect(points.map((p) => p.stepId)).toEqual(['s1', 's3'])
    expect(points.map((p) => p.index)).toEqual([1, 3])
  })

  it('flags a >0.3 drop between consecutive confident steps', () => {
    const steps = [
      step('s0', { confidence: { value: 0.85, provenance: 'inferred' } }),
      step('s1', { confidence: { value: 0.44, provenance: 'inferred' } }),
      step('s2', { confidence: { value: 0.4, provenance: 'inferred' } }),
    ]
    const points = computeSparklinePoints(steps)
    expect(points[0].isDrop).toBe(false)
    expect(points[1].isDrop).toBe(true) // 0.85 -> 0.44 = 0.41 drop
    expect(points[2].isDrop).toBe(false) // 0.44 -> 0.40 = 0.04, not sharp
  })

  it('does not flag drops of exactly the threshold or smaller', () => {
    const steps = [
      step('s0', { confidence: { value: 0.7, provenance: 'inferred' } }),
      step('s1', { confidence: { value: 0.4, provenance: 'inferred' } }), // exactly 0.3
    ]
    expect(computeSparklinePoints(steps)[1].isDrop).toBe(false)
  })

  it('captures the most negative component as the drop cause', () => {
    const steps = [
      step('s0', { confidence: { value: 0.85, provenance: 'inferred' } }),
      step('s1', {
        confidence: {
          value: 0.4,
          provenance: 'inferred',
          components: [
            { name: 'hedging_density', contribution: -0.1, detail: 'mild hedging' },
            { name: 'error_proximity', contribution: -0.3, detail: '2 errors nearby' },
          ],
        },
      }),
    ]
    const points = computeSparklinePoints(steps)
    expect(points[1].isDrop).toBe(true)
    expect(points[1].causeDetail).toBe('2 errors nearby')
  })

  it('returns an empty array when no step carries confidence', () => {
    expect(computeSparklinePoints([step('s0', { type: 'user' })])).toEqual([])
  })
})

describe('computeYDomain', () => {
  it('pads a wide observed range symmetrically, real variation stays at its natural amplitude', () => {
    const domain = computeYDomain([0.9, 0.5, 0.7])
    // range = 0.4, half = 0.2, padding = 0.2 * 0.15 = 0.03
    expect(domain.min).toBeCloseTo(0.5 - 0.03, 5)
    expect(domain.max).toBeCloseTo(0.9 + 0.03, 5)
  })

  it('floors a narrow observed range at MIN_DISPLAY_RANGE, so trivial noise is not blown up into a dramatic swing', () => {
    const domain = computeYDomain([0.61, 0.6, 0.59])
    // observed range is only 0.02, far under the 0.2 floor
    expect(domain.max - domain.min).toBeGreaterThan(0.2)
    expect(domain.max - domain.min).toBeCloseTo(0.2 * 1.15, 5)
  })

  it('centers a flat (single distinct value) trace instead of dividing by zero', () => {
    const domain = computeYDomain([0.6, 0.6, 0.6])
    const center = (domain.min + domain.max) / 2
    expect(center).toBeCloseTo(0.6, 5)
    expect(domain.max).toBeGreaterThan(domain.min)
  })
})
