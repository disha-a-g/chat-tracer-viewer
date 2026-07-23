import { useState } from 'react'
import type { Step } from '../types'
import type { Annotation } from '../lib/annotations'
import { formatDuration, formatJson, formatTimestamp } from '../lib/format'
import { summarizeStep } from '../lib/summarize'
import { statusClasses, stepLabel, type StepStatus } from '../lib/stepVisuals'

interface StepRowProps {
  step: Step
  status: StepStatus
  isSelected: boolean
  /** Briefly true right after a jump-to-step click (sparkline, failure
   *  evidence, interesting event) — a transient pulse distinct from the
   *  persistent isSelected highlight, so "I just jumped here" reads
   *  differently from "this is what's open in the detail pane." */
  isFlashing: boolean
  /** True while this step belongs to an expanded loop group — a subtle
   *  highlight tying the participating rows together, gone the moment the
   *  loop collapses (the rows themselves stop rendering then). */
  isInLoop: boolean
  isExpandable: boolean
  isExpanded: boolean
  onSelect: () => void
  onToggleExpand: () => void
  annotations: Annotation[]
  isComposingNote: boolean
  onStartNote: () => void
  onCancelNote: () => void
  onSubmitNote: (text: string) => void
}

export function StepRow({
  step,
  status,
  isSelected,
  isFlashing,
  isInLoop,
  isExpandable,
  isExpanded,
  onSelect,
  onToggleExpand,
  annotations,
  isComposingNote,
  onStartNote,
  onCancelNote,
  onSubmitNote,
}: StepRowProps) {
  const classes = statusClasses(status)
  const inputJson = step.type === 'tool_use' ? formatJson(step.tool_input) : null
  const outputJson = step.type === 'tool_result' ? formatJson(step.tool_output) : null
  const [draft, setDraft] = useState('')

  function submit() {
    const trimmed = draft.trim()
    if (!trimmed) return
    onSubmitNote(trimmed)
    setDraft('')
  }

  function cancel() {
    setDraft('')
    onCancelNote()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className={`w-full cursor-pointer border-b border-l-4 border-neutral-800 px-4 py-3 text-left outline-none transition-colors ${classes.border} ${
        isInLoop ? 'ring-1 ring-inset ring-amber-400/20' : ''
      } ${
        isFlashing
          ? 'animate-pulse bg-sky-500/15'
          : isSelected
            ? 'bg-neutral-800/60'
            : isInLoop
              ? 'bg-amber-400/[0.06] hover:bg-amber-400/10'
              : 'hover:bg-neutral-900/60'
      } focus-visible:ring-1 ${classes.ring}`}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${classes.badge}`}>
          {stepLabel(step)}
        </span>
        {step.timestamp && (
          <span className="shrink-0 font-mono text-neutral-500" title={step.timestamp}>
            {formatTimestamp(step.timestamp)}
          </span>
        )}
        {step.duration_ms !== undefined && <span className="shrink-0 font-mono text-neutral-600">{formatDuration(step.duration_ms)}</span>}
        {step.tool_name && <span className="shrink-0 font-medium text-neutral-300">{step.tool_name}</span>}
        <span className="min-w-0 flex-1 truncate text-neutral-400">{summarizeStep(step)}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onStartNote()
          }}
          className="shrink-0 rounded px-1.5 py-0.5 text-neutral-500 hover:bg-violet-500/10 hover:text-violet-300"
        >
          + note
        </button>
        {isExpandable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand()
            }}
            className="shrink-0 rounded px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? '▲' : '▼'}
          </button>
        )}
      </div>

      {isExpanded && (inputJson || outputJson || step.error) && (
        <div className="mt-3 space-y-2 pl-1">
          {inputJson && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-600">tool_input</div>
              <pre className="max-h-64 overflow-auto rounded bg-neutral-950 p-2 font-mono text-[11px] text-neutral-300">{inputJson}</pre>
            </div>
          )}
          {outputJson && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-600">tool_output</div>
              <pre className="max-h-64 overflow-auto rounded bg-neutral-950 p-2 font-mono text-[11px] text-neutral-300">{outputJson}</pre>
            </div>
          )}
          {step.error && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-red-500/70">error</div>
              <pre className="max-h-64 overflow-auto rounded bg-red-950/20 p-2 font-mono text-[11px] text-red-300">{step.error.message}</pre>
            </div>
          )}
        </div>
      )}

      {annotations.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5 pl-1">
          {annotations.map((note) => (
            <div key={note.id} className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-violet-400/80">
                <span>note</span>
                <span className="text-violet-500/50">·</span>
                <span className="normal-case text-violet-400/60">{new Date(note.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-violet-100">{note.text}</p>
            </div>
          ))}
        </div>
      )}

      {isComposingNote && (
        <div className="mt-2 flex flex-col gap-1.5 pl-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a note…"
            rows={2}
            className="w-full resize-y rounded-md border border-violet-500/40 bg-neutral-950 p-2 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-violet-400 focus:outline-none"
          />
          <div className="flex gap-2">
            <button type="button" onClick={submit} disabled={!draft.trim()} className="rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">
              Save
            </button>
            <button type="button" onClick={cancel} className="rounded px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
