import type { Step } from '../types'

export function stringifyForSearch(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Case-insensitive substring match over content, tool_name, tool_input,
 *  tool_output, and error — the fields Block 5 of the spec calls out. */
export function stepMatchesQuery(step: Step, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true

  if (step.content.toLowerCase().includes(q)) return true
  if (step.tool_name && step.tool_name.toLowerCase().includes(q)) return true
  if (step.tool_input !== undefined && stringifyForSearch(step.tool_input).toLowerCase().includes(q)) return true
  if (step.tool_output !== undefined && stringifyForSearch(step.tool_output).toLowerCase().includes(q)) return true
  if (step.error && step.error.message.toLowerCase().includes(q)) return true

  return false
}
