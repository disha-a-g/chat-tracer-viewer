import { describe, expect, it } from 'vitest'
import { loadTraceFromStorage, saveTraceToStorage, storageKeyFor } from '../persistence'
import { FakeStorage, makeTrace } from './testHelpers'

describe('saveTraceToStorage / loadTraceFromStorage', () => {
  it('round-trips a trace through storage', () => {
    const storage = new FakeStorage()
    const trace = makeTrace({ title: 'Test trace' })
    saveTraceToStorage(trace, storage)
    expect(loadTraceFromStorage('trc_test', storage)).toEqual(trace)
  })

  it('returns null for a trace id that was never stored', () => {
    const storage = new FakeStorage()
    expect(loadTraceFromStorage('trc_missing', storage)).toBeNull()
  })

  it('drops Trace.raw above the size threshold but keeps everything else', () => {
    const storage = new FakeStorage()
    const trace = makeTrace({ raw: 'x'.repeat(400_000) })
    saveTraceToStorage(trace, storage)
    const loaded = loadTraceFromStorage('trc_test', storage)
    expect(loaded?.raw).toBeUndefined()
    expect(loaded?.id).toBe('trc_test')
  })

  it('keeps a small Trace.raw intact', () => {
    const storage = new FakeStorage()
    const trace = makeTrace({ raw: { small: true } })
    saveTraceToStorage(trace, storage)
    expect(loadTraceFromStorage('trc_test', storage)?.raw).toEqual({ small: true })
  })

  it('never throws when storage.setItem throws (quota exceeded / disabled)', () => {
    const storage = new FakeStorage()
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(() => saveTraceToStorage(makeTrace(), storage)).not.toThrow()
  })

  it('namespaces keys so traces do not collide with other localStorage users', () => {
    expect(storageKeyFor('trc_test123')).toBe('chat-trace-viewer:trace:trc_test123')
  })
})
