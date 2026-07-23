import type { NormalizedTrace } from '../types'

interface RawTraceViewProps {
  trace: NormalizedTrace
}

export function RawTraceView({ trace }: RawTraceViewProps) {
  if (trace.raw === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">
        No raw source was retained for this trace.
      </div>
    )
  }

  const text = typeof trace.raw === 'string' ? trace.raw : JSON.stringify(trace.raw, null, 2)

  return (
    <div className="h-full overflow-auto p-4">
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-neutral-300">{text}</pre>
    </div>
  )
}
