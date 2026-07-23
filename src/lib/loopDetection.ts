import type { Step } from '../types'

export const LOOP_SIMILARITY_THRESHOLD = 0.8
export const LOOP_MAX_GAP = 6
export const LOOP_MIN_SIZE = 3
const COMPARE_LENGTH_CAP = 500

export interface LoopGroup {
  id: string
  toolName: string
  /** The matching tool_use step ids, in order — the "N" in "called N times". */
  stepIds: string[]
  /** Index range into the full Step[] array, inclusive — everything in
   *  between (results, assistant text) collapses with the group. */
  startIndex: number
  endIndex: number
}

function stringifyInput(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const curr = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = curr
  }
  return prev[n]
}

/** Simple normalized edit-distance similarity (0..1) over tool_input,
 *  stringified. Capped-length inputs — this only needs to be good enough to
 *  tell "same call repeated" from "different call", not exact. */
export function inputSimilarity(a: unknown, b: unknown): number {
  const sa = stringifyInput(a).slice(0, COMPARE_LENGTH_CAP)
  const sb = stringifyInput(b).slice(0, COMPARE_LENGTH_CAP)
  const maxLen = Math.max(sa.length, sb.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(sa, sb) / maxLen
}

/** Groups of 3+ tool_use calls with the same tool_name and >80% similar
 *  tool_input, chained within LOOP_MAX_GAP *steps* of each other — the
 *  "agent keeps retrying the same thing" pattern (ideas.md: reasoning-loop
 *  surfacing, distinct from an infinite loop). "Within N steps" is a
 *  distance constraint on the same-named calls themselves: a Write call
 *  wedged between two Bash retries (the agent "fixing" the file between
 *  attempts — the canonical shape of this pattern) does not reset the
 *  chain, only a large index gap or dissimilar input does. Chains link
 *  consecutively (each call compared to the previous one of the same tool,
 *  not the first), so a loop tolerates gradual parameter drift. Computed on
 *  the full, unfiltered step list — filtering/search is a Timeline display
 *  concern, not a detection concern. */
export function detectLoops(steps: Step[]): LoopGroup[] {
  const byToolName = new Map<string, { step: Step; index: number }[]>()
  steps.forEach((step, index) => {
    if (step.type !== 'tool_use') return
    const name = step.tool_name ?? 'unknown'
    const list = byToolName.get(name)
    if (list) list.push({ step, index })
    else byToolName.set(name, [{ step, index }])
  })

  const groups: LoopGroup[] = []

  for (const [toolName, items] of byToolName) {
    let chainStart = 0
    for (let i = 1; i <= items.length; i++) {
      const chainBreaks =
        i === items.length ||
        items[i].index - items[i - 1].index > LOOP_MAX_GAP ||
        inputSimilarity(items[i - 1].step.tool_input, items[i].step.tool_input) < LOOP_SIMILARITY_THRESHOLD

      if (!chainBreaks) continue

      const chain = items.slice(chainStart, i)
      if (chain.length >= LOOP_MIN_SIZE) {
        groups.push({
          id: `loop-${chain[0].index}`,
          toolName,
          stepIds: chain.map((c) => c.step.id),
          startIndex: chain[0].index,
          endIndex: chain[chain.length - 1].index,
        })
      }
      chainStart = i
    }
  }

  groups.sort((a, b) => a.startIndex - b.startIndex)

  // Chains are built per tool name, so two different tools retried in
  // alternation (Bash, Grep, Bash, Grep, ...) can produce groups whose
  // index ranges overlap. Every consumer (Timeline's index->group map)
  // assumes one step index belongs to at most one group — an overlap
  // there silently reassigns the earlier group's tail steps to the later
  // group, permanently hiding them (neither header's expand toggle ever
  // reveals them). Keep the earliest-starting group and drop any later
  // one that overlaps it.
  const nonOverlapping: LoopGroup[] = []
  let lastEnd = -1
  for (const group of groups) {
    if (group.startIndex > lastEnd) {
      nonOverlapping.push(group)
      lastEnd = group.endIndex
    }
  }
  return nonOverlapping
}
