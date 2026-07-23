import { useState } from 'react'
import type { NormalizedTrace } from '../types'
import { BUILT_IN_FAILURE_MODES } from '../lib/researchMemory'
import type { CustomFailureMode, FailureModeEvidence } from '../lib/researchMemory'
import { NewFailureModeDialog } from './NewFailureModeDialog'

interface ResearchMemoryPanelProps {
  trace: NormalizedTrace
  customModes: CustomFailureMode[]
  onAddMode: (input: { name: string; description: string; evidence: FailureModeEvidence[] }) => void
  onSelectEvidenceStep: (stepId: string) => void
}

function EvidenceRow({ evidence, currentTraceId, onSelect }: { evidence: FailureModeEvidence; currentTraceId: string; onSelect: () => void }) {
  const isCurrentTrace = evidence.traceId === currentTraceId
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!isCurrentTrace}
      title={isCurrentTrace ? undefined : 'From a different trace — open it to jump to this step'}
      className="flex w-full items-center gap-2 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-left text-xs text-neutral-300 hover:border-neutral-600 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="min-w-0 flex-1 truncate">{evidence.label}</span>
      {!isCurrentTrace && <span className="shrink-0 text-[10px] text-neutral-600">other trace</span>}
    </button>
  )
}

function CustomModeCard({
  mode,
  currentTraceId,
  onSelectEvidenceStep,
}: {
  mode: CustomFailureMode
  currentTraceId: string
  onSelectEvidenceStep: (stepId: string) => void
}) {
  return (
    <div className="rounded-md border border-violet-500/30 bg-neutral-900/60 p-3 text-xs">
      <div className="mb-1 font-medium text-neutral-200">{mode.name}</div>
      <p className="mb-2 text-neutral-400">{mode.description}</p>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">Evidence</div>
      <ul className="flex flex-col gap-1">
        {mode.evidence.map((e, i) => (
          <li key={i}>
            <EvidenceRow evidence={e} currentTraceId={currentTraceId} onSelect={() => onSelectEvidenceStep(e.stepId)} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** "The debugger evolves as researchers discover new reasoning failures" —
 *  a research notebook, not a configuration screen. Built-in modes describe
 *  the taxonomy the heuristics already look for (failureTaxonomy.ts); custom
 *  modes are whatever a researcher has personally noticed, each backed by
 *  concrete evidence steps rather than a rule that runs automatically.
 *  Automatic detection of custom modes is intentionally out of scope. */
export function ResearchMemoryPanel({ trace, customModes, onAddMode, onSelectEvidenceStep }: ResearchMemoryPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-8">
        <div>
          <h2 className="text-sm font-medium text-neutral-200">Research Memory</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Institutional knowledge about how agents fail, backed by evidence traced back to real steps — not a rule engine.
          </p>
        </div>

        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Built-in Failure Modes</h3>
          <div className="flex flex-col gap-2">
            {BUILT_IN_FAILURE_MODES.map((m) => (
              <div key={m.name} className="rounded-md border border-neutral-800 bg-neutral-900/60 p-3 text-xs">
                <div className="mb-1 font-medium text-neutral-200">{m.name}</div>
                <p className="text-neutral-400">{m.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Custom Failure Modes</h3>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-900"
            >
              + New Failure Mode
            </button>
          </div>

          {customModes.length === 0 ? (
            <p className="text-xs text-neutral-500">
              Nothing here yet — attach evidence from this trace to start building this viewer's memory of how agents fail.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {customModes.map((mode) => (
                <CustomModeCard key={mode.id} mode={mode} currentTraceId={trace.id} onSelectEvidenceStep={onSelectEvidenceStep} />
              ))}
            </div>
          )}
        </section>
      </div>

      {dialogOpen && (
        <NewFailureModeDialog
          trace={trace}
          onClose={() => setDialogOpen(false)}
          onSubmit={(input) => {
            onAddMode(input)
            setDialogOpen(false)
          }}
        />
      )}
    </div>
  )
}
