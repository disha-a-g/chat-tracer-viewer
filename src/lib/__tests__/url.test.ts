import { describe, expect, it } from 'vitest'
import { buildUrlSearch, parseUrlParams } from '../url'

describe('parseUrlParams', () => {
  it('reads trace, step, and notes from a query string', () => {
    expect(parseUrlParams('?trace=trc_abc123&step=msg-4&notes=%5B%5D')).toEqual({
      traceId: 'trc_abc123',
      stepId: 'msg-4',
      notes: '[]',
    })
  })

  it('returns nulls when absent', () => {
    expect(parseUrlParams('')).toEqual({ traceId: null, stepId: null, notes: null })
    expect(parseUrlParams('?other=1')).toEqual({ traceId: null, stepId: null, notes: null })
  })
})

describe('buildUrlSearch', () => {
  it('sets trace, step, and notes params', () => {
    expect(buildUrlSearch('', 'trc_abc123', 'msg-4', 'abc')).toBe('?trace=trc_abc123&step=msg-4&notes=abc')
  })

  it('omits step and notes when null', () => {
    expect(buildUrlSearch('', 'trc_abc123', null, null)).toBe('?trace=trc_abc123')
  })

  it('clears all three when traceId is null', () => {
    expect(buildUrlSearch('?trace=trc_old&step=msg-1&notes=abc', null, null, null)).toBe('')
  })

  it('preserves unrelated existing params', () => {
    expect(buildUrlSearch('?foo=bar', 'trc_abc123', null, null)).toBe('?foo=bar&trace=trc_abc123')
  })

  it('replaces an existing trace/step/notes triple rather than duplicating', () => {
    expect(buildUrlSearch('?trace=trc_old&step=msg-1&notes=abc', 'trc_new', 'msg-9', 'xyz')).toBe(
      '?trace=trc_new&step=msg-9&notes=xyz',
    )
  })

  it('can clear just notes while keeping trace and step', () => {
    expect(buildUrlSearch('?trace=trc_abc&step=msg-1&notes=abc', 'trc_abc', 'msg-1', null)).toBe(
      '?trace=trc_abc&step=msg-1',
    )
  })
})
