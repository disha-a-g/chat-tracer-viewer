import type { NormalizedTrace } from '../types'

const STORAGE_PREFIX = 'chat-trace-viewer:trace:'

// Above this, drop Trace.raw (the whole source document, largely redundant
// with steps[].raw) so one huge trace doesn't blow localStorage's ~5MB quota
// for every trace stored in the session — the raw-view tab degrades to
// steps[].raw instead.
const MAX_RAW_BYTES = 300_000

export function storageKeyFor(traceId: string): string {
  return `${STORAGE_PREFIX}${traceId}`
}

function estimateSize(value: unknown): number {
  if (value === undefined) return 0
  try {
    return JSON.stringify(value).length
  } catch {
    return 0
  }
}

/** Saves a trace to localStorage, keyed by its stable content-hash id.
 *  Never throws — a full quota or disabled storage (private browsing) just
 *  means this trace won't be shareable via URL, not a crash. */
export function saveTraceToStorage(trace: NormalizedTrace, storage: Storage = window.localStorage): void {
  const toStore: NormalizedTrace = estimateSize(trace.raw) > MAX_RAW_BYTES ? { ...trace, raw: undefined } : trace
  try {
    storage.setItem(storageKeyFor(trace.id), JSON.stringify(toStore))
  } catch {
    // quota exceeded or storage unavailable — degrade silently
  }
}

export function loadTraceFromStorage(traceId: string, storage: Storage = window.localStorage): NormalizedTrace | null {
  try {
    const raw = storage.getItem(storageKeyFor(traceId))
    if (!raw) return null
    return JSON.parse(raw) as NormalizedTrace
  } catch {
    return null
  }
}
