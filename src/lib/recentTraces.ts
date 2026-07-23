import type { NormalizedTrace, TraceFormat } from '../types'

const STORAGE_KEY = 'chat-trace-viewer:recent'
const MAX_RECENT = 5

export interface RecentTraceEntry {
  id: string
  title: string
  format: TraceFormat
  stepCount: number
  loadedAt: string // ISO
}

export function loadRecentTraces(storage: Storage = window.localStorage): RecentTraceEntry[] {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as RecentTraceEntry[]) : []
  } catch {
    return []
  }
}

function saveRecentTraces(entries: RecentTraceEntry[], storage: Storage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // quota exceeded or storage disabled — the list just won't persist this time
  }
}

/** Records (or re-bumps) a trace at the front of the recent list, capped at
 *  MAX_RECENT. Returns the updated list so callers can sync UI state in one
 *  call instead of a separate load. */
export function recordRecentTrace(trace: NormalizedTrace, storage: Storage = window.localStorage): RecentTraceEntry[] {
  const entry: RecentTraceEntry = {
    id: trace.id,
    title: trace.title ?? `${trace.format} trace`,
    format: trace.format,
    stepCount: trace.steps.length,
    loadedAt: new Date().toISOString(),
  }
  const next = [entry, ...loadRecentTraces(storage).filter((e) => e.id !== trace.id)].slice(0, MAX_RECENT)
  saveRecentTraces(next, storage)
  return next
}

/** Drops an entry whose underlying trace is no longer in localStorage (e.g.
 *  evicted for space) so the list doesn't keep offering a dead link. */
export function forgetRecentTrace(traceId: string, storage: Storage = window.localStorage): RecentTraceEntry[] {
  const next = loadRecentTraces(storage).filter((e) => e.id !== traceId)
  saveRecentTraces(next, storage)
  return next
}

/** Empties the whole recent-traces list (the list itself, not the stored
 *  traces/annotations behind each entry). */
export function clearRecentTraces(storage: Storage = window.localStorage): RecentTraceEntry[] {
  saveRecentTraces([], storage)
  return []
}
