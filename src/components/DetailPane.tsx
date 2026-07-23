import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Step } from '../types'
import { formatDuration, formatJson, formatTimestamp } from '../lib/format'
import { statusClasses, stepLabel, type StepStatus } from '../lib/stepVisuals'

interface DetailPaneProps {
  step: Step
  status: StepStatus
  onClose: () => void
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      {children}
    </div>
  )
}

function JsonBlock({ json }: { json: string }) {
  return <pre className="max-h-80 overflow-auto rounded bg-neutral-950 p-2 font-mono text-[11px] leading-relaxed text-neutral-300">{json}</pre>
}

export function DetailPane({ step, status, onClose }: DetailPaneProps) {
  const [showRaw, setShowRaw] = useState(false)
  const classes = statusClasses(status)
  const rawJson = formatJson(step.raw)
  const inputJson = formatJson(step.tool_input)
  const outputJson = formatJson(step.tool_output)

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col border-l border-neutral-800 bg-neutral-950">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${classes.badge}`}>
            {stepLabel(step)}
          </span>
          <span className="truncate font-mono text-xs text-neutral-500">{step.id}</span>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200" aria-label="Close detail pane">
          ✕
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-neutral-800 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setShowRaw(false)}
          className={`rounded px-2 py-1 text-xs ${!showRaw ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}
        >
          Parsed
        </button>
        <button
          type="button"
          onClick={() => setShowRaw(true)}
          disabled={!rawJson}
          className={`rounded px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${showRaw ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}
        >
          Raw JSON
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {showRaw ? (
          rawJson ? <JsonBlock json={rawJson} /> : <p className="text-xs text-neutral-500">No raw source available for this step.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {step.timestamp && (
              <Field label="Timestamp">
                <span className="font-mono text-xs text-neutral-300">{formatTimestamp(step.timestamp)}</span>
                <span className="ml-2 text-[11px] text-neutral-600">{step.timestamp}</span>
              </Field>
            )}

            {step.duration_ms !== undefined && (
              <Field label="Duration">
                <span className="font-mono text-xs text-neutral-300">
                  {formatDuration(step.duration_ms)}
                  <span className="ml-1 text-neutral-600">({step.duration_provenance})</span>
                </span>
              </Field>
            )}

            <Field label="Parent">
              <span className="font-mono text-xs text-neutral-300">
                {step.parent_id ?? '(root)'}
                <span className="ml-1 text-neutral-600">({step.parent_provenance})</span>
              </span>
            </Field>

            {step.tool_name && (
              <Field label="Tool name">
                <span className="text-xs text-neutral-200">{step.tool_name}</span>
              </Field>
            )}

            {step.content && (
              <Field label="Content">
                <p className="whitespace-pre-wrap break-words text-xs text-neutral-200">{step.content}</p>
              </Field>
            )}

            {inputJson && (
              <Field label="tool_input">
                <JsonBlock json={inputJson} />
              </Field>
            )}

            {outputJson && (
              <Field label="tool_output">
                <JsonBlock json={outputJson} />
              </Field>
            )}

            {step.error && (
              <Field label="Error">
                <div className="rounded border border-red-500/30 bg-red-950/20 p-2">
                  <p className="text-xs text-red-300">{step.error.message}</p>
                  <p className="mt-1 text-[11px] text-red-400/70">
                    {step.error.kind ?? 'unknown'} · {step.error.provenance}
                    {step.error.code !== undefined ? ` · code ${step.error.code}` : ''}
                  </p>
                </div>
              </Field>
            )}

            {step.confidence && (
              <Field label="Confidence">
                <div className="rounded border border-neutral-800 bg-neutral-900/50 p-2">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-sm text-neutral-100">{step.confidence.value.toFixed(2)}</span>
                    <span className="text-[11px] text-neutral-500">
                      {step.confidence.provenance === 'source' ? 'reported' : 'heuristic'}
                    </span>
                  </div>
                  {step.confidence.components && step.confidence.components.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {step.confidence.components.map((c, i) => (
                        <li key={i} className="flex items-start justify-between gap-2 text-[11px] text-neutral-400">
                          <span className="min-w-0 flex-1">
                            {c.name}
                            {c.detail && <span className="text-neutral-600"> — {c.detail}</span>}
                          </span>
                          <span className={`shrink-0 font-mono ${c.contribution < 0 ? 'text-red-400' : c.contribution > 0 ? 'text-emerald-400' : 'text-neutral-500'}`}>
                            {c.contribution >= 0 ? '+' : ''}
                            {c.contribution.toFixed(2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Field>
            )}

            {step.tokens && (
              <Field label="Tokens">
                <JsonBlock json={formatJson(step.tokens) ?? ''} />
              </Field>
            )}

            {step.meta && Object.keys(step.meta).length > 0 && (
              <Field label="Meta">
                <JsonBlock json={formatJson(step.meta) ?? ''} />
              </Field>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
