// Shared test builders. Consolidated here after `step`, `makeTrace`, and
// `FakeStorage` had each been copy-pasted verbatim into several *.test.ts
// files independently.

import type { NormalizedTrace, Step } from '../../types'

export function step(id: string, overrides: Partial<Step> = {}): Step {
  return {
    id,
    parent_id: null,
    parent_provenance: 'inferred',
    type: 'assistant',
    duration_provenance: 'unknown',
    content: '',
    ...overrides,
  }
}

export function makeTrace(overrides: Partial<NormalizedTrace> = {}): NormalizedTrace {
  const steps = overrides.steps ?? []
  const tool_calls = overrides.tool_calls ?? []
  return {
    id: 'trc_test',
    format: 'generic-json',
    schema_version: 1,
    steps,
    tool_calls,
    stats: {
      step_count: steps.length,
      duration_provenance: 'unknown',
      tool_call_count: tool_calls.length,
      error_count: steps.filter((s) => s.error != null).length,
      model_call_count: steps.filter((s) => s.type === 'assistant' || s.type === 'thinking').length,
    },
    issues: [],
    has_explicit_confidence: false,
    ...overrides,
  }
}

export class FakeStorage implements Storage {
  private store = new Map<string, string>()
  get length(): number {
    return this.store.size
  }
  clear(): void {
    this.store.clear()
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}
