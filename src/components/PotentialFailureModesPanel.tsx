import { useMemo, useState } from 'react'
import type { NormalizedTrace } from '../types'
import { FAILURE_MODE_LABELS, groupEvidenceByLabel } from '../lib/failureTaxonomy'
import type { FailureDetection, FailureMode, GroupedEvidence, Likelihood } from '../lib/failureTaxonomy'
import { Section } from './Section'
import { Chip } from './Chip'

interface PotentialFailureModesPanelProps {
  trace: NormalizedTrace
  failures: FailureDetection[]
  /** Set when the user is viewing one mode's evidence in isolation (View
   *  clicked, or an evidence line on this card clicked) — highlights this
   *  card as active. Every card stays visible either way; this never
   *  narrows the list. */
  isolatedMode: FailureDetection | null
  /** Set when the active filter is one specific deduped evidence line
   *  rather than the whole mode — highlights that one line within the
   *  active card. */
  evidenceFilter: { label: string; stepIds: string[] } | null
  onIsolate: (detection: FailureDetection) => void
  onFilterEvidence: (detection: FailureDetection, group: GroupedEvidence) => void
  onClearIsolation: () => void
}

const LIKELIHOOD_STYLES: Record<Likelihood, { dot: string; chip: string; label: string; border: string }> = {
  none: { dot: 'bg-emerald-500', chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', label: 'None detected', border: 'border-emerald-500/30' },
  low: { dot: 'bg-yellow-400', chip: 'border-yellow-400/30 bg-yellow-400/10 text-yellow-300', label: 'Low', border: 'border-yellow-400/30' },
  medium: { dot: 'bg-orange-400', chip: 'border-orange-400/30 bg-orange-400/10 text-orange-300', label: 'Medium', border: 'border-orange-400/30' },
  high: { dot: 'bg-red-500', chip: 'border-red-500/30 bg-red-500/10 text-red-300', label: 'High', border: 'border-red-500/30' },
}

const DETAIL_BORDER: Record<Likelihood, string> = {
  none: 'border-t border-r border-b border-l-2 border-t-emerald-500/30 border-r-emerald-500/30 border-b-emerald-500/30 border-l-emerald-500',
  low: 'border-t border-r border-b border-l-2 border-t-yellow-400/30 border-r-yellow-400/30 border-b-yellow-400/30 border-l-yellow-400',
  medium: 'border-t border-r border-b border-l-2 border-t-orange-400/30 border-r-orange-400/30 border-b-orange-400/30 border-l-orange-400',
  high: 'border-t border-r border-b border-l-2 border-t-red-500/30 border-r-red-500/30 border-b-red-500/30 border-l-red-500',
}

function ModeChip({ detection, active, onClick }: { detection: FailureDetection; active: boolean; onClick: () => void }) {
  const styles = LIKELIHOOD_STYLES[detection.likelihood]
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors ${styles.border} ${
        active ? 'bg-neutral-800' : 'bg-neutral-900 hover:bg-neutral-800/60'
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot}`} />
      <span className="text-neutral-300">{FAILURE_MODE_LABELS[detection.mode]}</span>
      <Chip colorClassName={styles.chip}>{styles.label}</Chip>
    </button>
  )
}

function FailureModeDetail({
  detection,
  isActive,
  activeEvidenceLabel,
  onIsolate,
  onFilterEvidence,
}: {
  detection: FailureDetection
  isActive: boolean
  activeEvidenceLabel?: string
  onIsolate: (detection: FailureDetection) => void
  onFilterEvidence: (detection: FailureDetection, group: GroupedEvidence) => void
}) {
  const firstStepId = detection.firstOccurrenceStepId
  const groupedEvidence = useMemo(() => groupEvidenceByLabel(detection.evidence), [detection.evidence])

  return (
    <div className={`rounded-md bg-neutral-900/60 p-4 text-xs ${DETAIL_BORDER[detection.likelihood]}`}>
      <div>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">Reason</div>
        <p className="text-neutral-300">{detection.summary}</p>
      </div>

      {groupedEvidence.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">Evidence</div>
          <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
            {groupedEvidence.map((g) => {
              const isLineActive = isActive && activeEvidenceLabel === g.label
              return (
                <li key={g.label}>
                  <button
                    type="button"
                    onClick={() => onFilterEvidence(detection, g)}
                    title="Filter the timeline to just this evidence"
                    className={`w-full rounded px-1.5 py-1 text-left transition-colors ${
                      isLineActive ? 'bg-sky-400/15 text-sky-300' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                    }`}
                  >
                    • {g.label}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {firstStepId && (
        <button
          type="button"
          onClick={() => onIsolate(detection)}
          className="mt-3 self-start rounded-md border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800"
        >
          View →
        </button>
      )}
    </div>
  )
}

/** Research-assistant framing, not a verdict: every number here traces back
 *  to a deterministic rule over concrete steps (see lib/failureTaxonomy.ts).
 *  The goal is to shorten "read the trace" to "form a hypothesis," not to
 *  replace the engineer's own judgment about what actually went wrong.
 *
 *  Collapsed by default every time a trace loads — needs `key={trace.id}`
 *  from the caller so a new trace doesn't inherit a previous one's state.
 *  Clicking View keeps this panel open and scrolls the Timeline into view
 *  instead of hiding this context to make room for it. */
export function PotentialFailureModesPanel({
  failures,
  isolatedMode,
  evidenceFilter,
  onIsolate,
  onFilterEvidence,
  onClearIsolation,
}: PotentialFailureModesPanelProps) {
  const [collapsed, setCollapsed] = useState(true)
  const [expandedMode, setExpandedMode] = useState<FailureMode | null>(null)

  const sorted = useMemo(() => [...failures].sort((a, b) => b.confidence - a.confidence), [failures])

  if (failures.length === 0) return null

  const flaggedCount = failures.filter((f) => f.likelihood !== 'none').length
  const isOpen = !collapsed
  const expanded = sorted.find((f) => f.mode === expandedMode) ?? null

  // Closing the thing that produced the Timeline filter should clear it —
  // otherwise the Timeline stays filtered to a mode the user can no longer
  // even see is selected, with no visible way back to "showing everything."
  function handleChipClick(mode: FailureMode) {
    setExpandedMode((m) => {
      const next = m === mode ? null : mode
      if (next === null && isolatedMode?.mode === mode) onClearIsolation()
      return next
    })
  }

  function handleToggleCollapse() {
    setCollapsed((v) => {
      const next = !v
      if (next && isolatedMode) onClearIsolation()
      return next
    })
  }

  return (
    <Section
      title="Potential Failure Modes"
      collapsed={!isOpen}
      onToggleCollapse={handleToggleCollapse}
      collapsedSummary={flaggedCount === 0 ? 'nothing flagged' : `${flaggedCount} mode${flaggedCount === 1 ? '' : 's'} flagged`}
    >
      <div className="flex flex-wrap gap-2">
        {sorted.map((f) => (
          <ModeChip key={f.mode} detection={f} active={expandedMode === f.mode} onClick={() => handleChipClick(f.mode)} />
        ))}
      </div>
      {expanded && (
        <FailureModeDetail
          detection={expanded}
          isActive={isolatedMode?.mode === expanded.mode}
          activeEvidenceLabel={isolatedMode?.mode === expanded.mode ? (evidenceFilter?.label ?? undefined) : undefined}
          onIsolate={onIsolate}
          onFilterEvidence={onFilterEvidence}
        />
      )}
    </Section>
  )
}
