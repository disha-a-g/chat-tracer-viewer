import type { LoopGroup } from '../lib/loopDetection'

interface LoopHeaderRowProps {
  group: LoopGroup
  expanded: boolean
  onToggle: () => void
  /** True when a jump-to-step target (interesting event, evidence click) is
   *  hidden inside this collapsed loop — flashes the header itself since
   *  there's no visible row for the target step to flash on. */
  isFlashing?: boolean
}

export function LoopHeaderRow({ group, expanded, onToggle, isFlashing }: LoopHeaderRowProps) {
  const count = group.stepIds.length
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center gap-2 border-b border-l-4 border-amber-500/50 bg-amber-500/[0.06] px-4 py-3 text-left text-xs hover:bg-amber-500/[0.1] ${isFlashing ? 'animate-pulse bg-sky-500/15' : ''}`}
    >
      <span className="shrink-0 rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
        LOOP
      </span>
      <span className="min-w-0 flex-1 truncate text-amber-200">
        Loop detected: {group.toolName} called {count} times
      </span>
      <span className="shrink-0 text-[11px] text-amber-400/70">{expanded ? '▲ collapse' : `▼ expand ${count} steps`}</span>
    </button>
  )
}
