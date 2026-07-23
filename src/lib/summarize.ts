import type { Step } from '../types'
import { oneLine } from './format'

function summarizeToolInput(input: unknown, max = 90): string {
  if (input == null) return ''
  if (typeof input === 'string') return oneLine(input, max)
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>
    for (const key of ['command', 'query', 'file_path', 'path', 'url']) {
      const v = obj[key]
      if (typeof v === 'string') return oneLine(v, max)
    }
    return oneLine(JSON.stringify(obj), max)
  }
  return oneLine(String(input), max)
}

/** One-line summary shown next to the tool name badge in the collapsed
 *  timeline row. Tool_use/tool_result rows already render `step.tool_name`
 *  as their own badge, so this never repeats it — when there's nothing
 *  beyond the name (no input preview, no result content), it returns ''
 *  and the row just shows the badge alone. */
export function summarizeStep(step: Step): string {
  if (step.type === 'tool_use') {
    return summarizeToolInput(step.tool_input)
  }
  if (step.type === 'tool_result') {
    return step.content ? oneLine(step.content) : ''
  }
  return step.content ? oneLine(step.content) : '(empty)'
}
