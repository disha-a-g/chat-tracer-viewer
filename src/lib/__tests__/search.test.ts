import { describe, expect, it } from 'vitest'
import { stepMatchesQuery } from '../search'
import type { Step } from '../../types'

function makeStep(overrides: Partial<Step>): Step {
  return {
    id: 's1',
    parent_id: null,
    parent_provenance: 'inferred',
    type: 'assistant',
    duration_provenance: 'unknown',
    content: '',
    ...overrides,
  }
}

describe('stepMatchesQuery', () => {
  it('empty query matches everything', () => {
    expect(stepMatchesQuery(makeStep({ content: 'anything' }), '')).toBe(true)
    expect(stepMatchesQuery(makeStep({ content: 'anything' }), '   ')).toBe(true)
  })

  it('matches content case-insensitively', () => {
    expect(stepMatchesQuery(makeStep({ content: 'CUDA out of memory' }), 'cuda')).toBe(true)
    expect(stepMatchesQuery(makeStep({ content: 'all good here' }), 'cuda')).toBe(false)
  })

  it('matches tool_name', () => {
    expect(stepMatchesQuery(makeStep({ type: 'tool_use', tool_name: 'Bash' }), 'bash')).toBe(true)
  })

  it('matches tool_input and tool_output through their stringified JSON', () => {
    const step = makeStep({
      type: 'tool_use',
      tool_input: { command: 'python -m pytest tests/test_date_helpers.py' },
    })
    expect(stepMatchesQuery(step, 'test_date_helpers')).toBe(true)

    const resultStep = makeStep({
      type: 'tool_result',
      tool_output: { stdout: 'ModuleNotFoundError: No module named utilss' },
    })
    expect(stepMatchesQuery(resultStep, 'modulenotfounderror')).toBe(true)
  })

  it('matches error message', () => {
    const step = makeStep({
      type: 'tool_result',
      error: { message: 'relation "revenue" does not exist', provenance: 'inferred' },
    })
    expect(stepMatchesQuery(step, 'revenue')).toBe(true)
    expect(stepMatchesQuery(step, 'nonexistent-term')).toBe(false)
  })
})
