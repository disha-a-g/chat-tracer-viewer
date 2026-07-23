import { useEffect, useState } from 'react'
import type { NormalizedTrace } from '../types'
import type { FailureModeEvidence } from '../lib/researchMemory'
import { stepLabel } from '../lib/stepVisuals'
import { summarizeStep } from '../lib/summarize'
import { oneLine } from '../lib/format'

interface NewFailureModeDialogProps {
  trace: NormalizedTrace
  onClose: () => void
  onSubmit: (input: { name: string; description: string; evidence: FailureModeEvidence[] }) => void
}

/** Name / Description / Evidence — evidence is a checklist over the current
 *  trace's steps rather than free text, so a custom failure mode is always
 *  backed by something a future reader can click through and judge for
 *  themselves, the same standard the built-in heuristics hold themselves to. */
export function NewFailureModeDialog({ trace, onClose, onSubmit }: NewFailureModeDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedStepIds, setSelectedStepIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function toggleStep(stepId: string) {
    setSelectedStepIds((prev) => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }

  const canSubmit = name.trim().length > 0 && description.trim().length > 0 && selectedStepIds.size > 0

  function submit() {
    if (!canSubmit) return
    const evidence: FailureModeEvidence[] = trace.steps
      .filter((s) => selectedStepIds.has(s.id))
      .map((s) => ({
        traceId: trace.id,
        stepId: s.id,
        label: oneLine(`${stepLabel(s)} ${summarizeStep(s)}`.trim(), 80),
      }))
    onSubmit({ name: name.trim(), description: description.trim(), evidence })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New failure mode"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-neutral-800 bg-neutral-950 shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-sm font-medium text-neutral-100">New Failure Mode</h2>
          <button type="button" onClick={onClose} className="rounded px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Context window thrashing"
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What did you notice, and why does it matter?"
              rows={3}
              className="w-full resize-y rounded-md border border-neutral-800 bg-neutral-900 p-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">Evidence</label>
              <span className="text-[11px] text-neutral-600">
                {selectedStepIds.size} step{selectedStepIds.size === 1 ? '' : 's'} selected
              </span>
            </div>
            <p className="mb-2 text-[11px] text-neutral-500">Attach one or more steps from this trace that show the pattern.</p>
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border border-neutral-800 p-1.5">
              {trace.steps.map((step) => (
                <li key={step.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-neutral-900">
                    <input type="checkbox" checked={selectedStepIds.has(step.id)} onChange={() => toggleStep(step.id)} className="shrink-0" />
                    <span className="shrink-0 rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 font-mono text-[10px] text-neutral-400">
                      {stepLabel(step)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-neutral-300">{summarizeStep(step) || '(no content)'}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-neutral-800 px-4 py-3">
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save Failure Mode
          </button>
        </div>
      </div>
    </div>
  )
}
