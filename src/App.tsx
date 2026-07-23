import { useEffect, useMemo, useRef, useState } from 'react'
import { parseTrace } from './adapters'
import type { NormalizedTrace, ToolCall } from './types'
import { Landing } from './components/Landing'
import { IssuesBanner } from './components/IssuesBanner'
import { Timeline } from './components/Timeline'
import type { TimelineHandle } from './components/Timeline'
import { DetailPane } from './components/DetailPane'
import { RawTraceView } from './components/RawTraceView'
import { StatsBar } from './components/StatsBar'
import { ConfidenceSparkline } from './components/ConfidenceSparkline'
import { FailureTldrBanner } from './components/FailureTldrBanner'
import { PotentialFailureModesPanel } from './components/PotentialFailureModesPanel'
import { ResearchMemoryPanel } from './components/ResearchMemoryPanel'
import { detectFailures } from './lib/failureTaxonomy'
import type { FailureDetection, GroupedEvidence } from './lib/failureTaxonomy'
import { generateFailureModeId, loadCustomFailureModes, saveCustomFailureModes } from './lib/researchMemory'
import type { CustomFailureMode, FailureModeEvidence } from './lib/researchMemory'
import { stepStatus } from './lib/stepVisuals'
import { oneLine } from './lib/format'
import type { StatFilterKey } from './lib/stepVisuals'
import { loadTraceFromStorage, saveTraceToStorage } from './lib/persistence'
import { clearRecentTraces, forgetRecentTrace, loadRecentTraces, recordRecentTrace } from './lib/recentTraces'
import type { RecentTraceEntry } from './lib/recentTraces'
import { buildUrlSearch, parseUrlParams } from './lib/url'
import {
  decodeAnnotationsFromUrl,
  encodeAnnotationsForUrl,
  generateAnnotationId,
  loadAnnotationsFromStorage,
  mergeAnnotations,
  saveAnnotationsToStorage,
} from './lib/annotations'
import type { Annotation } from './lib/annotations'

type Tab = 'timeline' | 'raw' | 'memory'

/** The narrow, evidence-line-level filter set by clicking one deduped
 *  evidence line on a failure mode card (as opposed to `isolatedMode`,
 *  which just marks that card "active" and drives the coarser whole-mode
 *  jump/highlight behavior of the View button). When set, this — not
 *  `isolatedMode`'s full evidence list — is what the Timeline filters to. */
interface EvidenceFilter {
  label: string
  stepIds: string[]
}

function currentFullUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

/** `push: true` for user-facing navigation (loading a trace, selecting a
 *  step) so the back/forward buttons can walk through it; `push: false` for
 *  background updates (annotations, error cleanup) that shouldn't clutter
 *  history. Skips a push when it wouldn't change the URL, so re-clicking an
 *  already-selected step doesn't pile up duplicate history entries. */
function applyUrl(traceId: string | null, stepId: string | null, notes: string | null, push: boolean) {
  const search = buildUrlSearch(window.location.search, traceId, stepId, notes)
  const newUrl = `${window.location.pathname}${search}${window.location.hash}`
  if (push) {
    if (newUrl === currentFullUrl()) return
    window.history.pushState(null, '', newUrl)
  } else {
    window.history.replaceState(null, '', newUrl)
  }
}

function App() {
  const [trace, setTrace] = useState<NormalizedTrace | null>(null)
  const [sourceLabel, setSourceLabel] = useState<string | undefined>()
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [initialStepId, setInitialStepId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('timeline')
  const [activeFilter, setActiveFilter] = useState<StatFilterKey | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [flashStepId, setFlashStepId] = useState<string | null>(null)
  const [recentTraces, setRecentTraces] = useState<RecentTraceEntry[]>(() => loadRecentTraces())
  const [customFailureModes, setCustomFailureModes] = useState<CustomFailureMode[]>(() => loadCustomFailureModes())
  const [isolatedMode, setIsolatedMode] = useState<FailureDetection | null>(null)
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter | null>(null)

  // The two state transitions every trace-loading path goes through: land on
  // a trace (mount deep-link, popstate, paste/upload/URL, recent-trace open)
  // or drop back to none (popstate with no ?trace=, New trace). Each used to
  // be its own 7-9 line block of setState calls repeated at every call site
  // — easy to update three of the four and forget the rest, which is exactly
  // how isolatedMode's reset was almost missed in an earlier pass.
  function applyLoadedTrace(loaded: NormalizedTrace, opts: { sourceLabel?: string; stepId?: string | null; annotations: Annotation[] }) {
    setTrace(loaded)
    setSourceLabel(opts.sourceLabel)
    setSelectedStepId(opts.stepId ?? null)
    setInitialStepId(opts.stepId ?? null)
    setLoadError(null)
    setActiveFilter(null)
    setIsolatedMode(null)
    setEvidenceFilter(null)
    setAnnotations(opts.annotations)
    setRecentTraces(recordRecentTrace(loaded))
  }

  function clearTraceState() {
    setTrace(null)
    setSourceLabel(undefined)
    setSelectedStepId(null)
    setInitialStepId(null)
    setLoadError(null)
    setActiveFilter(null)
    setIsolatedMode(null)
    setEvidenceFilter(null)
    setAnnotations([])
  }

  // Clears a jump-to-step flash a moment after it's set — local UI state
  // only, never persisted.
  useEffect(() => {
    if (!flashStepId) return
    const timer = setTimeout(() => setFlashStepId(null), 1200)
    return () => clearTimeout(timer)
  }, [flashStepId])

  // On first mount, a ?trace=<id> in the URL means someone shared a link:
  // load that trace from localStorage (and select ?step=<id> if present).
  // Any ?notes=<encoded> annotations ride along with the link and get
  // merged into whatever's already stored locally for this trace.
  // Persistence is browser-local, so a missing id is expected for links
  // opened in a different browser — surface that clearly, not as a crash.
  useEffect(() => {
    const { traceId, stepId, notes } = parseUrlParams(window.location.search)
    if (!traceId) return
    const stored = loadTraceFromStorage(traceId)
    if (stored) {
      const localNotes = loadAnnotationsFromStorage(traceId)
      const merged = mergeAnnotations(localNotes, decodeAnnotationsFromUrl(notes))
      saveAnnotationsToStorage(traceId, merged)
      applyLoadedTrace(stored, { stepId, annotations: merged })
      // Normalizing the current entry (merged notes), not a new navigation.
      applyUrl(traceId, stepId, encodeAnnotationsForUrl(merged), false)
    } else {
      setLoadError(
        `This link points to a trace (${traceId}) that isn't in this browser's local storage. ` +
          'Shared links only work in the browser where the trace was originally loaded — ask the sender to share the trace file itself instead.',
      )
      applyUrl(null, null, null, false)
    }
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Browser back/forward: re-sync React state from the URL the user just
  // navigated to. Trace/step selection are pushed to history (see applyUrl
  // call sites below), so this is what makes those pushes actually
  // navigable rather than just cosmetic URL changes.
  useEffect(() => {
    function handlePopState() {
      const { traceId, stepId, notes } = parseUrlParams(window.location.search)

      if (!traceId) {
        clearTraceState()
        return
      }

      if (trace?.id === traceId) {
        // Same trace — just move the selection/scroll, no reload needed.
        setSelectedStepId(stepId)
        if (stepId) timelineRef.current?.scrollToStep(stepId)
        return
      }

      const stored = loadTraceFromStorage(traceId)
      if (stored) {
        applyLoadedTrace(stored, { stepId, annotations: mergeAnnotations(loadAnnotationsFromStorage(traceId), decodeAnnotationsFromUrl(notes)) })
      } else {
        setTrace(null)
        setLoadError(
          `This link points to a trace (${traceId}) that isn't in this browser's local storage. ` +
            'Shared links only work in the browser where the trace was originally loaded — ask the sender to share the trace file itself instead.',
        )
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [trace])

  function handleLoad(raw: string, label?: string) {
    try {
      const parsed = parseTrace(raw)
      // Every adapter degrades gracefully rather than throwing (see
      // adapters/generic.ts) — invalid JSON, valid JSON with no step-like
      // array, or plain text all come back as a 0-step trace with an
      // error-severity issue instead of an exception. Catch that here and
      // keep the user on the Landing page with a clear message, rather than
      // dropping them into an empty, useless trace view.
      const unreadable = parsed.steps.length === 0 && parsed.issues.some((i) => i.severity === 'error')
      if (unreadable) {
        const detail = parsed.issues.find((i) => i.severity === 'error')?.message
        setLoadError(
          `That doesn't look like a supported agent trace${detail ? ` (${detail})` : ''}. ` +
            'Supported formats: Claude Code JSONL, OpenAI chat completions JSON, or generic JSON/JSONL with an array of step-like objects.',
        )
        return
      }
      saveTraceToStorage(parsed)
      const storedNotes = loadAnnotationsFromStorage(parsed.id)
      applyLoadedTrace(parsed, { sourceLabel: label, annotations: storedNotes })
      applyUrl(parsed.id, null, encodeAnnotationsForUrl(storedNotes), true)
    } catch (err) {
      setLoadError(`Failed to load trace: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }

  function handleReset() {
    clearTraceState()
    setActiveTab('timeline')
    applyUrl(null, null, null, true)
  }

  function handleOpenRecent(traceId: string) {
    const stored = loadTraceFromStorage(traceId)
    if (!stored) {
      setRecentTraces(forgetRecentTrace(traceId))
      setLoadError(`That trace (${traceId}) is no longer available in this browser's local storage.`)
      return
    }
    const storedNotes = loadAnnotationsFromStorage(traceId)
    applyLoadedTrace(stored, { annotations: storedNotes })
    applyUrl(traceId, null, encodeAnnotationsForUrl(storedNotes), true)
  }

  function handleClearRecent() {
    setRecentTraces(clearRecentTraces())
  }

  function handleForgetRecent(traceId: string) {
    setRecentTraces(forgetRecentTrace(traceId))
  }

  function handleSelectStep(stepId: string | null) {
    setSelectedStepId(stepId)
    if (trace) applyUrl(trace.id, stepId, encodeAnnotationsForUrl(annotations), true)
  }

  function handleSparklinePointClick(stepId: string) {
    handleSelectStep(stepId)
    timelineRef.current?.scrollToStep(stepId)
  }

  function handleFailureEvidenceClick(stepId: string) {
    handleSelectStep(stepId)
    timelineRef.current?.scrollToStep(stepId)
    setFlashStepId(stepId)
    // Also queued through the effect below: if the caller is about to switch
    // to the Timeline tab in the same call (see handleResearchEvidenceClick),
    // Timeline isn't mounted yet and the ref above is a no-op. Harmless to
    // set even when already mounted — scrolling to the same index twice is a
    // no-op the second time.
    setPendingScroll({ stepId })
  }

  // Research Memory evidence rows are the one caller of
  // handleFailureEvidenceClick that isn't already inside the Timeline tab
  // (unlike the sparkline's temporal-signal blocks, which only render
  // there) — without switching tabs first, clicking evidence updated the
  // selected step with no visible effect at all, since the detail pane and
  // Timeline only render under the Timeline tab.
  function handleResearchEvidenceClick(stepId: string) {
    setActiveTab('timeline')
    handleFailureEvidenceClick(stepId)
  }

  function handleAddAnnotation(stepId: string, text: string) {
    if (!trace) return
    const next = [...annotations, { id: generateAnnotationId(), stepId, text, createdAt: new Date().toISOString() }]
    setAnnotations(next)
    saveAnnotationsToStorage(trace.id, next)
    // Background data change, not a navigation — don't push a history entry.
    applyUrl(trace.id, selectedStepId, encodeAnnotationsForUrl(next), false)
  }

  function toggleFilter(key: StatFilterKey) {
    setActiveFilter((prev) => (prev === key ? null : key))
  }

  function handleAddCustomFailureMode(input: { name: string; description: string; evidence: FailureModeEvidence[] }) {
    const next: CustomFailureMode[] = [
      ...customFailureModes,
      { id: generateFailureModeId(), createdAt: new Date().toISOString(), ...input },
    ]
    setCustomFailureModes(next)
    saveCustomFailureModes(next)
  }

  // Switches to the Timeline tab and filters it down to just this failure
  // mode's evidence steps. The tab switch unmounts/remounts Timeline, so the
  // scroll-to-step has to wait for that remount — see the effect below.
  // pendingScroll (not isolatedMode) drives that effect: `failures` is
  // memoized on `trace` alone, so re-clicking View on the *same* mode passes
  // the exact same detection object back — React bails out on an
  // Object.is-equal state update and the effect would never re-fire. A
  // fresh `{ stepId }` literal every call guarantees it always does.
  function handleIsolateFailureMode(detection: FailureDetection) {
    setIsolatedMode(detection)
    setEvidenceFilter(null) // whole-mode View overrides any narrower evidence-line filter
    setActiveTab('timeline')
    mainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (detection.firstOccurrenceStepId) {
      handleSelectStep(detection.firstOccurrenceStepId)
      setFlashStepId(detection.firstOccurrenceStepId)
      setPendingScroll({ stepId: detection.firstOccurrenceStepId })
    }
  }

  // Hovering/clicking one deduped evidence line on a card: narrows the
  // Timeline down to just that line's steps, rather than the whole mode's
  // evidence (that's what View/handleIsolateFailureMode is for). Still marks
  // the card "active" via isolatedMode so the card and this specific line
  // both show as selected.
  function handleFilterEvidence(detection: FailureDetection, group: GroupedEvidence) {
    setIsolatedMode(detection)
    setEvidenceFilter({ label: group.label, stepIds: group.stepIds })
    setActiveTab('timeline')
    const firstStepId = group.stepIds[0]
    if (firstStepId) {
      handleSelectStep(firstStepId)
      setFlashStepId(firstStepId)
      setPendingScroll({ stepId: firstStepId })
    }
  }

  function handleClearIsolation() {
    setIsolatedMode(null)
    setEvidenceFilter(null)
  }

  const timelineRef = useRef<TimelineHandle>(null)
  const mainRef = useRef<HTMLElement>(null)
  const [pendingScroll, setPendingScroll] = useState<{ stepId: string } | null>(null)

  useEffect(() => {
    if (!pendingScroll) return
    timelineRef.current?.scrollToStep(pendingScroll.stepId)
  }, [pendingScroll])

  const toolCallByStepId = useMemo<Map<string, ToolCall>>(() => {
    if (!trace) return new Map()
    return new Map(trace.tool_calls.map((c) => [c.step_id, c]))
  }, [trace])

  const failures = useMemo(() => (trace ? detectFailures(trace) : []), [trace])

  const selectedStep = trace?.steps.find((s) => s.id === selectedStepId) ?? null

  if (!trace) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100">
        <Landing
          onLoad={handleLoad}
          recentTraces={recentTraces}
          onOpenRecent={handleOpenRecent}
          onClearRecent={handleClearRecent}
          onForgetRecent={handleForgetRecent}
          loadError={loadError}
        />
      </div>
    )
  }

  const displayTitle = trace.title ?? sourceLabel ?? 'Untitled trace'

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-neutral-800 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            title="Back to landing page"
            aria-label="Back to landing page"
            className="shrink-0 rounded p-0.5 text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11.5 12 4l9 7.5" />
              <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
            </svg>
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium text-neutral-100" title={displayTitle}>
              {oneLine(displayTitle, 60)}
            </h1>
            <p className="truncate text-xs text-neutral-500">
              {trace.format} · {trace.steps.length} steps
              {sourceLabel && sourceLabel !== trace.title ? ` · ${sourceLabel}` : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex items-center gap-1 rounded-md border border-neutral-800 p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab('timeline')}
              className={`rounded px-2.5 py-1 text-xs ${activeTab === 'timeline' ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}
            >
              Timeline
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('raw')}
              className={`rounded px-2.5 py-1 text-xs ${activeTab === 'raw' ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}
            >
              Raw Trace
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('memory')}
              className={`rounded px-2.5 py-1 text-xs ${activeTab === 'memory' ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}
            >
              Research Memory
            </button>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
          >
            New trace
          </button>
        </div>
      </header>

      <IssuesBanner issues={trace.issues} />
      <FailureTldrBanner trace={trace} />
      {/* Grows to fit its content, same as IssuesBanner/FailureTldrBanner
          above — no inner scrollbox. This used to be capped at max-h-[40vh]
          because an isolated failure mode card showed its full,
          undeduplicated evidence list (sometimes 50+ near-identical lines),
          which could push this region taller than the viewport with no way
          to reach Main below (the app shell is a fixed h-screen column with
          no scroll of its own — see the min-h-0/min-h-[560px] note on
          `main`). Now that evidence is deduped (groupEvidenceByLabel) before
          display and only the *active* card's list uncaps, the pathological
          case collapses to a handful of distinct lines instead — normal
          growth here is bounded by the panel's own MAX_VISIBLE_EVIDENCE cap
          on every non-active card. Two remaining escape valves if this
          region is still ever taller than the viewport: the panel's own
          collapse toggle, and the browser's own page scroll (nothing here
          sets overflow-hidden, so it's not actually trapped even then). */}
      <div className="flex flex-col gap-6 px-4 py-4">
        <StatsBar trace={trace} toolCallByStepId={toolCallByStepId} activeFilter={activeFilter} onToggleFilter={toggleFilter} />
        <PotentialFailureModesPanel
          key={`failures-${trace.id}`}
          trace={trace}
          failures={failures}
          isolatedMode={isolatedMode}
          evidenceFilter={evidenceFilter}
          onIsolate={handleIsolateFailureMode}
          onFilterEvidence={handleFilterEvidence}
          onClearIsolation={handleClearIsolation}
        />
        {/* Lives in the scrollable top region, not inside `main` — main is
            height-clamped to its min-h floor on tall traces, and the
            sparkline (plus its drop/pause detail block) would otherwise eat
            most of that fixed space, leaving the actual Timeline rows with
            no room to render below their own sticky header. */}
        {activeTab === 'timeline' && (
          <ConfidenceSparkline
            trace={trace}
            selectedStepId={selectedStepId}
            onSelectStep={handleSparklinePointClick}
            isolatedMode={isolatedMode}
          />
        )}
      </div>

      {/* min-h floor so Main can never be fully squeezed out by the region
          above, however tall it grows — the flexbox will still shrink Main
          before it grows the page taller than the viewport, but never past
          this floor. Past that, the page itself scrolls (see note above). */}
      <main ref={mainRef} className="flex min-h-[560px] flex-1">
        {activeTab === 'timeline' ? (
          <>
            <div className="flex min-w-0 flex-1 flex-col gap-4 px-4 pb-4">
              <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-neutral-800">
                <Timeline
                  key={trace.id}
                  ref={timelineRef}
                  trace={trace}
                  selectedStepId={selectedStepId}
                  onSelectStep={handleSelectStep}
                  toolCallByStepId={toolCallByStepId}
                  activeFilter={activeFilter}
                  initialScrollToStepId={initialStepId}
                  annotations={annotations}
                  onAddAnnotation={handleAddAnnotation}
                  flashStepId={flashStepId}
                  isolatedMode={isolatedMode}
                  evidenceFilter={evidenceFilter}
                  onClearIsolation={handleClearIsolation}
                />
              </div>
            </div>
            {selectedStep && (
              <DetailPane step={selectedStep} status={stepStatus(selectedStep, toolCallByStepId)} onClose={() => handleSelectStep(null)} />
            )}
          </>
        ) : activeTab === 'raw' ? (
          <RawTraceView trace={trace} />
        ) : (
          <ResearchMemoryPanel
            trace={trace}
            customModes={customFailureModes}
            onAddMode={handleAddCustomFailureMode}
            onSelectEvidenceStep={handleResearchEvidenceClick}
          />
        )}
      </main>
    </div>
  )
}

export default App
