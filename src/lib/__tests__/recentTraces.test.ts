import { describe, expect, it } from 'vitest'
import { clearRecentTraces, forgetRecentTrace, loadRecentTraces, recordRecentTrace } from '../recentTraces'
import { FakeStorage, makeTrace } from './testHelpers'

describe('recordRecentTrace / loadRecentTraces', () => {
  it('records a trace and makes it loadable', () => {
    const storage = new FakeStorage()
    recordRecentTrace(makeTrace({ id: 'trc_a', title: 'First trace', steps: [{ id: 's0' } as never] }), storage)
    const list = loadRecentTraces(storage)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'trc_a', title: 'First trace', stepCount: 1, format: 'generic-json' })
  })

  it('most recently recorded trace is first', () => {
    const storage = new FakeStorage()
    recordRecentTrace(makeTrace({ id: 'trc_a' }), storage)
    recordRecentTrace(makeTrace({ id: 'trc_b' }), storage)
    expect(loadRecentTraces(storage).map((e) => e.id)).toEqual(['trc_b', 'trc_a'])
  })

  it('re-recording an existing trace bumps it to the front instead of duplicating', () => {
    const storage = new FakeStorage()
    recordRecentTrace(makeTrace({ id: 'trc_a' }), storage)
    recordRecentTrace(makeTrace({ id: 'trc_b' }), storage)
    recordRecentTrace(makeTrace({ id: 'trc_a' }), storage)
    const list = loadRecentTraces(storage)
    expect(list.map((e) => e.id)).toEqual(['trc_a', 'trc_b'])
    expect(list).toHaveLength(2)
  })

  it('caps the list at 5 entries, dropping the oldest', () => {
    const storage = new FakeStorage()
    for (let i = 0; i < 7; i++) recordRecentTrace(makeTrace({ id: `trc_${i}` }), storage)
    const list = loadRecentTraces(storage)
    expect(list).toHaveLength(5)
    expect(list.map((e) => e.id)).toEqual(['trc_6', 'trc_5', 'trc_4', 'trc_3', 'trc_2'])
  })

  it('falls back to a format-based title when the trace has none', () => {
    const storage = new FakeStorage()
    recordRecentTrace(makeTrace({ id: 'trc_a', title: undefined, format: 'openai-chat-completions' }), storage)
    expect(loadRecentTraces(storage)[0].title).toBe('openai-chat-completions trace')
  })

  it('returns [] for an empty or corrupt store, and never throws when storage is disabled', () => {
    expect(loadRecentTraces(new FakeStorage())).toEqual([])

    const corrupt = new FakeStorage()
    corrupt.setItem('chat-trace-viewer:recent', 'not json')
    expect(loadRecentTraces(corrupt)).toEqual([])

    const brokenStorage = new FakeStorage()
    brokenStorage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(() => recordRecentTrace(makeTrace({ id: 'trc_a' }), brokenStorage)).not.toThrow()
  })
})

describe('forgetRecentTrace', () => {
  it('removes a single entry and leaves the rest intact and in order', () => {
    const storage = new FakeStorage()
    recordRecentTrace(makeTrace({ id: 'trc_a' }), storage)
    recordRecentTrace(makeTrace({ id: 'trc_b' }), storage)
    recordRecentTrace(makeTrace({ id: 'trc_c' }), storage)
    forgetRecentTrace('trc_b', storage)
    expect(loadRecentTraces(storage).map((e) => e.id)).toEqual(['trc_c', 'trc_a'])
  })
})

describe('clearRecentTraces', () => {
  it('empties the whole list and returns []', () => {
    const storage = new FakeStorage()
    recordRecentTrace(makeTrace({ id: 'trc_a' }), storage)
    recordRecentTrace(makeTrace({ id: 'trc_b' }), storage)
    expect(clearRecentTraces(storage)).toEqual([])
    expect(loadRecentTraces(storage)).toEqual([])
  })
})
