import { describe, expect, it } from 'vitest'
import { BUILT_IN_FAILURE_MODES, generateFailureModeId, loadCustomFailureModes, saveCustomFailureModes } from '../researchMemory'
import type { CustomFailureMode } from '../researchMemory'
import { FakeStorage } from './testHelpers'

function mode(overrides: Partial<CustomFailureMode> = {}): CustomFailureMode {
  return {
    id: generateFailureModeId(),
    name: 'Context Window Thrashing',
    description: 'The agent repeatedly re-reads the same file after it should already be in context.',
    evidence: [{ traceId: 'trc_1', stepId: 's5', label: 'TOOL Read src/app.ts' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('BUILT_IN_FAILURE_MODES', () => {
  it('has all five canonical modes with a name and description', () => {
    expect(BUILT_IN_FAILURE_MODES.map((m) => m.name)).toEqual([
      'Planner Oscillation',
      'Observation Ignored',
      'Retrieval Abandonment',
      'Tool Execution',
      'Premature Termination',
    ])
    for (const m of BUILT_IN_FAILURE_MODES) expect(m.description.length).toBeGreaterThan(0)
  })
})

describe('custom failure mode storage', () => {
  it('round-trips through a fake Storage', () => {
    const storage = new FakeStorage()
    const modes = [mode(), mode({ name: 'Second Mode' })]
    saveCustomFailureModes(modes, storage)
    expect(loadCustomFailureModes(storage)).toEqual(modes)
  })

  it('returns an empty array when nothing is stored', () => {
    expect(loadCustomFailureModes(new FakeStorage())).toEqual([])
  })

  it('returns an empty array for garbage JSON rather than throwing', () => {
    const storage = new FakeStorage()
    storage.setItem('chat-trace-viewer:research-memory:custom-failure-modes', 'not-json')
    expect(loadCustomFailureModes(storage)).toEqual([])
  })

  it('never throws when storage.setItem throws', () => {
    const storage = new FakeStorage()
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(() => saveCustomFailureModes([mode()], storage)).not.toThrow()
  })
})

describe('generateFailureModeId', () => {
  it('produces unique, prefixed ids', () => {
    const a = generateFailureModeId()
    const b = generateFailureModeId()
    expect(a).not.toBe(b)
    expect(a.startsWith('mode_')).toBe(true)
  })
})
