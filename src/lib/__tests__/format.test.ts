import { describe, expect, it } from 'vitest'
import { formatDuration, formatTokenCount } from '../format'

describe('formatDuration', () => {
  it('returns an em dash for undefined/NaN/negative', () => {
    expect(formatDuration(undefined)).toBe('—')
    expect(formatDuration(NaN)).toBe('—')
    expect(formatDuration(-5)).toBe('—')
  })

  it('formats sub-second durations in ms', () => {
    expect(formatDuration(500)).toBe('500ms')
  })

  it('formats sub-minute durations in seconds', () => {
    expect(formatDuration(1500)).toBe('1.50s')
    expect(formatDuration(45_000)).toBe('45.0s')
  })

  it('formats minute-scale durations as Nm Ns', () => {
    expect(formatDuration(125_000)).toBe('2m 5s')
    expect(formatDuration(60_000)).toBe('1m 0s')
  })

  it('carries a seconds value that rounds up to 60 into the minutes place', () => {
    // 119999ms is 1m 59.999s — rounding minutes (floor) and seconds (round)
    // independently used to produce the impossible "1m 60s".
    expect(formatDuration(119_999)).toBe('2m 0s')
  })
})

describe('formatTokenCount', () => {
  it('formats sub-1000 counts as-is', () => {
    expect(formatTokenCount(42)).toBe('42')
  })

  it('formats thousands with a k suffix', () => {
    expect(formatTokenCount(1500)).toBe('1.5k')
    expect(formatTokenCount(42_000)).toBe('42k')
  })

  it('formats millions with an M suffix', () => {
    expect(formatTokenCount(2_500_000)).toBe('2.5M')
  })

  it('crosses over to M once the k value would round up to 1000, instead of printing "1000k"', () => {
    // 999999/1000 rounds to 1000 at 0 decimals — the k/M bucket must be
    // chosen from the rounded display value, not the raw one.
    expect(formatTokenCount(999_999)).toBe('1.0M')
    expect(formatTokenCount(999_499)).toBe('999k')
  })
})
