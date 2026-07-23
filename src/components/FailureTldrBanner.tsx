import type { NormalizedTrace } from '../types'
import { generateFailureTldr } from '../lib/failureTldr'

interface FailureTldrBannerProps {
  trace: NormalizedTrace
}

export function FailureTldrBanner({ trace }: FailureTldrBannerProps) {
  const tldr = generateFailureTldr(trace)
  if (!tldr) return null

  return (
    <div className="shrink-0 border-b border-red-500/25 bg-red-950/15 px-4 py-2 text-xs text-red-200">
      <span className="mr-1.5 font-semibold uppercase tracking-wide text-red-400/80">TLDR</span>
      {tldr}
    </div>
  )
}
