// Research Memory (Phase 2). A research notebook, not a rules engine: the
// point is representing institutional debugging knowledge a team has
// accumulated across traces, not automating detection. Built-in modes are
// static reference material describing the taxonomy this viewer already
// knows how to spot heuristically (see failureTaxonomy.ts); custom modes are
// whatever a researcher has personally noticed and wants remembered, backed
// by concrete evidence steps rather than free text.
//
// Deliberately global (not per-trace, unlike annotations.ts / persistence.ts)
// — a failure mode discovered while debugging one trace is exactly the kind
// of knowledge worth having on hand for the next one.

export interface BuiltInFailureMode {
  name: string
  description: string
}

export const BUILT_IN_FAILURE_MODES: BuiltInFailureMode[] = [
  { name: 'Planner Oscillation', description: 'The agent repeatedly explores nearly identical actions without making progress.' },
  { name: 'Observation Ignored', description: 'The agent continues reasoning without acknowledging a contradictory or negative observation.' },
  { name: 'Retrieval Abandonment', description: 'The agent retrieves information but never incorporates it into later reasoning.' },
  { name: 'Tool Execution', description: 'A tool invocation fails and derails the reasoning that depended on its result.' },
  { name: 'Premature Termination', description: 'The trace ends before the planned work was actually completed.' },
]

/** One piece of evidence for a custom failure mode: a specific step in a
 *  specific trace. `label` is a snapshot taken at attach-time so the entry
 *  stays readable even if that trace is never reopened in this browser. */
export interface FailureModeEvidence {
  traceId: string
  stepId: string
  label: string
}

export interface CustomFailureMode {
  id: string
  name: string
  description: string
  evidence: FailureModeEvidence[]
  createdAt: string
}

const STORAGE_KEY = 'chat-trace-viewer:research-memory:custom-failure-modes'

export function generateFailureModeId(): string {
  return `mode_${Math.random().toString(36).slice(2, 10)}`
}

export function loadCustomFailureModes(storage: Storage = window.localStorage): CustomFailureMode[] {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as CustomFailureMode[]) : []
  } catch {
    return []
  }
}

export function saveCustomFailureModes(modes: CustomFailureMode[], storage: Storage = window.localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(modes))
  } catch {
    // quota exceeded or storage disabled — the mode still works for this session
  }
}
