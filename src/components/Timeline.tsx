import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { NormalizedTrace, Step, ToolCall } from '../types'
import type { Annotation } from '../lib/annotations'
import { matchesStatFilter, stepStatus, type StatFilterKey } from '../lib/stepVisuals'
import { stepMatchesQuery } from '../lib/search'
import { detectLoops, type LoopGroup } from '../lib/loopDetection'
import { FAILURE_MODE_LABELS } from '../lib/failureTaxonomy'
import type { FailureDetection } from '../lib/failureTaxonomy'
import { StepRow } from './StepRow'
import { LoopHeaderRow } from './LoopHeaderRow'

interface TimelineProps {
  trace: NormalizedTrace
  selectedStepId: string | null
  onSelectStep: (stepId: string) => void
  toolCallByStepId: Map<string, ToolCall>
  activeFilter: StatFilterKey | null
  /** A step id to scroll to once, right after mount — set when the trace was
   *  loaded from a shared ?trace=<id>&step=<id> URL. Not re-applied on later
   *  selection changes; the user's own scroll position takes over after that. */
  initialScrollToStepId?: string | null
  annotations: Annotation[]
  onAddAnnotation: (stepId: string, text: string) => void
  /** A step id to briefly pulse-highlight — set by App on a jump-to-step
   *  click (interesting event, evidence, sparkline) and cleared on a timer. */
  flashStepId?: string | null
  /** Set when viewing one failure mode's evidence in isolation — overrides
   *  the search box and stat filter, showing only that mode's evidence
   *  steps (or, if `evidenceFilter` is also set, just that narrower set —
   *  see below). Also used for the sticky header's mode label. */
  isolatedMode: FailureDetection | null
  /** Set when the user clicked one specific deduped evidence line on a card
   *  rather than the card's "View" button — narrows the filtered set (and
   *  the sticky header's label) down to just that line's steps instead of
   *  the whole mode's evidence. Always accompanied by a matching
   *  `isolatedMode`; ignored when `isolatedMode` is null. */
  evidenceFilter?: { label: string; stepIds: string[] } | null
  onClearIsolation: () => void
}

export interface TimelineHandle {
  /** Imperative scroll, usable any number of times — e.g. from the
   *  confidence sparkline, which can be clicked repeatedly. */
  scrollToStep: (stepId: string) => void
}

type DisplayItem = { kind: 'step'; step: Step } | { kind: 'loop'; group: LoopGroup }

export const Timeline = forwardRef<TimelineHandle, TimelineProps>(function Timeline(
  {
    trace,
    selectedStepId,
    onSelectStep,
    toolCallByStepId,
    activeFilter,
    initialScrollToStepId,
    annotations,
    onAddAnnotation,
    flashStepId,
    isolatedMode,
    evidenceFilter,
    onClearIsolation,
  },
  ref,
) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [expandedLoopIds, setExpandedLoopIds] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [composingStepId, setComposingStepId] = useState<string | null>(null)
  const hasScrolledToInitialStep = useRef(false)

  const annotationsByStepId = useMemo(() => {
    const map = new Map<string, Annotation[]>()
    for (const a of annotations) {
      const list = map.get(a.stepId)
      if (list) list.push(a)
      else map.set(a.stepId, [a])
    }
    return map
  }, [annotations])

  // Isolating a failure mode is a hard override: it replaces the search box
  // and stat filter rather than combining with them, so "showing N evidence
  // steps" always means exactly that, not "N evidence steps that also
  // happen to match whatever was left in the search box." `evidenceFilter`,
  // when present, narrows this further to one specific evidence line's
  // steps rather than the whole mode's.
  const isolatedStepIds = useMemo(() => {
    if (evidenceFilter) return new Set(evidenceFilter.stepIds)
    if (isolatedMode) return new Set(isolatedMode.evidence.flatMap((e) => e.stepIds))
    return null
  }, [isolatedMode, evidenceFilter])

  const isolatedLabel = evidenceFilter?.label ?? (isolatedMode ? FAILURE_MODE_LABELS[isolatedMode.mode] : '')

  const filteredByStat = useMemo(() => {
    if (isolatedStepIds) return trace.steps.filter((step) => isolatedStepIds.has(step.id))
    return trace.steps.filter((step) => matchesStatFilter(step, activeFilter, toolCallByStepId))
  }, [trace.steps, activeFilter, toolCallByStepId, isolatedStepIds])

  const visibleSteps = useMemo(() => {
    if (isolatedStepIds) return filteredByStat
    return filteredByStat.filter((step) => stepMatchesQuery(step, query))
  }, [filteredByStat, query, isolatedStepIds])

  // Reasoning-loop grouping (ideas.md Layer 3 preview): 3+ near-identical
  // consecutive-ish tool_use calls collapse behind one header row. Computed
  // on the full trace and only applied to the unfiltered view — combining
  // it with an active search/status filter would mean deciding whether to
  // hide interleaved context that didn't match the filter, which isn't
  // worth the complexity for what's fundamentally a "browse the whole
  // trace" affordance.
  const loopGroups = useMemo(() => detectLoops(trace.steps), [trace.steps])

  const indexToGroup = useMemo(() => {
    const map = new Map<number, LoopGroup>()
    for (const group of loopGroups) {
      for (let i = group.startIndex; i <= group.endIndex; i++) map.set(i, group)
    }
    return map
  }, [loopGroups])

  const stepIndexInTrace = useMemo(() => {
    const map = new Map<string, number>()
    trace.steps.forEach((s, i) => map.set(s.id, i))
    return map
  }, [trace.steps])

  const isFilteredView = Boolean(activeFilter) || query.trim().length > 0 || isolatedStepIds !== null

  const displayItems = useMemo<DisplayItem[]>(() => {
    if (isFilteredView || loopGroups.length === 0) {
      return visibleSteps.map((step) => ({ kind: 'step', step }))
    }
    const items: DisplayItem[] = []
    trace.steps.forEach((step, index) => {
      const group = indexToGroup.get(index)
      if (group) {
        if (index === group.startIndex) items.push({ kind: 'loop', group })
        if (expandedLoopIds.has(group.id)) items.push({ kind: 'step', step })
        return
      }
      items.push({ kind: 'step', step })
    })
    return items
  }, [isFilteredView, loopGroups, visibleSteps, trace.steps, indexToGroup, expandedLoopIds])

  function resolveDisplayIndex(stepId: string): number {
    const directIndex = displayItems.findIndex((item) => item.kind === 'step' && item.step.id === stepId)
    if (directIndex !== -1) return directIndex
    const originalIndex = stepIndexInTrace.get(stepId)
    if (originalIndex === undefined) return -1
    const group = indexToGroup.get(originalIndex)
    if (!group) return -1
    return displayItems.findIndex((item) => item.kind === 'loop' && item.group.id === group.id)
  }

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 12,
  })

  useEffect(() => {
    if (hasScrolledToInitialStep.current || !initialScrollToStepId) return
    const index = resolveDisplayIndex(initialScrollToStepId)
    if (index === -1) return
    virtualizer.scrollToIndex(index, { align: 'center' })
    hasScrolledToInitialStep.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialScrollToStepId, displayItems, virtualizer])

  useImperativeHandle(
    ref,
    () => ({
      scrollToStep(stepId: string) {
        const index = resolveDisplayIndex(stepId)
        if (index !== -1) virtualizer.scrollToIndex(index, { align: 'center' })
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayItems, virtualizer],
  )

  function toggleExpand(stepId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }

  function isStepInExpandedLoop(stepId: string): boolean {
    const originalIndex = stepIndexInTrace.get(stepId)
    const group = originalIndex !== undefined ? indexToGroup.get(originalIndex) : undefined
    return group !== undefined && expandedLoopIds.has(group.id)
  }

  function toggleLoop(groupId: string) {
    setExpandedLoopIds((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  if (trace.steps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">
        This trace has no steps to show.
      </div>
    )
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4 py-3">
        {isolatedMode ? (
          <>
            <span className="min-w-0 flex-1 truncate text-xs text-neutral-300">
              Showing {isolatedStepIds?.size ?? 0} evidence step{(isolatedStepIds?.size ?? 0) === 1 ? '' : 's'} for{' '}
              <span className="font-medium">{isolatedLabel}</span>
            </span>
            <button
              type="button"
              onClick={onClearIsolation}
              className="shrink-0 rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-neutral-900"
            >
              Clear
            </button>
          </>
        ) : (
          <>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search content, tool name, input, output, error…"
              className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
            />
            {query.trim() && (
              <span className="shrink-0 text-xs text-neutral-500">
                {visibleSteps.length} match{visibleSteps.length === 1 ? '' : 'es'}
              </span>
            )}
          </>
        )}
      </div>

      {displayItems.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-sm text-neutral-500">
          {isolatedMode ? 'No evidence steps found.' : query.trim() ? 'No steps match your search.' : 'No steps match the current filter.'}
        </div>
      ) : (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = displayItems[virtualItem.index]
            const key = item.kind === 'loop' ? item.group.id : item.step.id
            return (
              <div
                key={key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualItem.start}px)` }}
              >
                {item.kind === 'loop' ? (
                  <LoopHeaderRow
                    group={item.group}
                    expanded={expandedLoopIds.has(item.group.id)}
                    onToggle={() => toggleLoop(item.group.id)}
                    isFlashing={
                      !!flashStepId &&
                      !expandedLoopIds.has(item.group.id) &&
                      stepIndexInTrace.get(flashStepId) !== undefined &&
                      stepIndexInTrace.get(flashStepId)! >= item.group.startIndex &&
                      stepIndexInTrace.get(flashStepId)! <= item.group.endIndex
                    }
                  />
                ) : (
                  <StepRow
                    step={item.step}
                    status={stepStatus(item.step, toolCallByStepId)}
                    isSelected={selectedStepId === item.step.id}
                    isFlashing={flashStepId === item.step.id}
                    isInLoop={isStepInExpandedLoop(item.step.id)}
                    isExpandable={item.step.type === 'tool_use' || item.step.type === 'tool_result'}
                    isExpanded={expandedIds.has(item.step.id)}
                    onSelect={() => onSelectStep(item.step.id)}
                    onToggleExpand={() => toggleExpand(item.step.id)}
                    annotations={annotationsByStepId.get(item.step.id) ?? []}
                    isComposingNote={composingStepId === item.step.id}
                    onStartNote={() => setComposingStepId(item.step.id)}
                    onCancelNote={() => setComposingStepId(null)}
                    onSubmitNote={(text) => {
                      onAddAnnotation(item.step.id, text)
                      setComposingStepId(null)
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})
