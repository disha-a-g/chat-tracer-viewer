import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { NormalizedTrace } from '../types'
import { computeSparklinePoints, computeYDomain, MIN_POINTS_FOR_SPARKLINE } from '../lib/sparkline'
import type { YDomain } from '../lib/sparkline'
import { computeLargestConfidenceDrop, computeLongestPause } from '../lib/temporalSignals'
import type { ConfidenceDropSignal, LongPauseSignal } from '../lib/temporalSignals'
import { formatDuration } from '../lib/format'
import type { FailureDetection } from '../lib/failureTaxonomy'
import { Section } from './Section'

interface ConfidenceSparklineProps {
  trace: NormalizedTrace
  selectedStepId: string | null
  onSelectStep: (stepId: string) => void
  /** Set when viewing one failure mode's evidence in isolation — plotted
   *  points whose step is part of that evidence get a distinct highlight.
   *  Most evidence (tool calls, results) isn't on this curve at all — only
   *  assistant/thinking steps carry a confidence value — so a mode built
   *  entirely from tool evidence may highlight nothing here, which is
   *  correct: there's nothing to point to on this particular chart. */
  isolatedMode: FailureDetection | null
}

const VIEW_SIZE = 100
const PADDING_Y = 8

function toX(index: number, lastIndex: number): number {
  return lastIndex === 0 ? VIEW_SIZE / 2 : (index / lastIndex) * VIEW_SIZE
}

function toY(value: number, domain: YDomain): number {
  const usable = VIEW_SIZE - PADDING_Y * 2
  const fraction = domain.max === domain.min ? 0.5 : (value - domain.min) / (domain.max - domain.min)
  return PADDING_Y + (1 - fraction) * usable
}

// Collapsed row + expand-on-click, consistent with the other panels'
// collapsible convention (StatsBar, PotentialFailureModesPanel).
function TemporalSignalBlock({
  title,
  collapsedSummary,
  onSelectStep,
  stepId,
  children,
}: {
  title: string
  collapsedSummary: string
  onSelectStep: (stepId: string) => void
  stepId: string
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-900/60"
      >
        <span className="text-neutral-600">{expanded ? '▼' : '▶'}</span>
        <span className="font-medium">{title}</span>
        <span className="text-neutral-500">{collapsedSummary}</span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 px-3 pb-3 pl-8 text-xs">
          {children}
          <button
            type="button"
            onClick={() => onSelectStep(stepId)}
            className="self-start rounded-md border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800"
          >
            View →
          </button>
        </div>
      )}
    </div>
  )
}

function ConfidenceDropBlock({ drop, stepNumber, onSelectStep }: { drop: ConfidenceDropSignal; stepNumber: number; onSelectStep: (stepId: string) => void }) {
  return (
    <TemporalSignalBlock
      title="Largest Confidence Drop"
      collapsedSummary={`step ${stepNumber + 1} · ${drop.before.toFixed(2)} → ${drop.after.toFixed(2)}`}
      onSelectStep={onSelectStep}
      stepId={drop.stepId}
    >
      <div>
        <span className="text-neutral-500">Step</span> <span className="text-neutral-300">{stepNumber + 1}</span>
      </div>
      <div>
        <span className="text-neutral-500">Confidence</span>{' '}
        <span className="font-mono text-neutral-300">
          {drop.before.toFixed(2)} → {drop.after.toFixed(2)}
        </span>
      </div>
      {drop.cause && (
        <div>
          <span className="text-neutral-500">Cause</span> <span className="text-neutral-300">{drop.cause}</span>
        </div>
      )}
    </TemporalSignalBlock>
  )
}

function LongPauseBlock({ pause, stepNumber, onSelectStep }: { pause: LongPauseSignal; stepNumber: number; onSelectStep: (stepId: string) => void }) {
  return (
    <TemporalSignalBlock
      title="Longest Pause"
      collapsedSummary={`step ${stepNumber + 1} · ${formatDuration(pause.ms)}`}
      onSelectStep={onSelectStep}
      stepId={pause.stepId}
    >
      <div>
        <span className="text-neutral-500">Step</span> <span className="text-neutral-300">{stepNumber + 1}</span>
      </div>
      <div>
        <span className="text-neutral-500">Duration</span> <span className="font-mono text-neutral-300">{formatDuration(pause.ms)}</span>
      </div>
      <div>
        <span className="text-neutral-500">Occurred before</span> <span className="text-neutral-300">{pause.followingDescription}</span>
      </div>
    </TemporalSignalBlock>
  )
}

export function ConfidenceSparkline({ trace, selectedStepId, onSelectStep, isolatedMode }: ConfidenceSparklineProps) {
  const points = useMemo(() => computeSparklinePoints(trace.steps), [trace.steps])
  const drop = useMemo(() => computeLargestConfidenceDrop(trace.steps), [trace.steps])
  const pause = useMemo(() => computeLongestPause(trace.steps), [trace.steps])
  const highlightStepIds = useMemo(
    () => (isolatedMode ? new Set(isolatedMode.evidence.flatMap((e) => e.stepIds)) : null),
    [isolatedMode],
  )

  if (points.length < MIN_POINTS_FOR_SPARKLINE) return null

  const lastIndex = Math.max(trace.steps.length - 1, 1)
  const yDomain = computeYDomain(points.map((p) => p.value))
  const coords = points.map((p) => ({ ...p, x: toX(p.index, lastIndex), y: toY(p.value, yDomain) }))
  const dropCount = points.filter((p) => p.isDrop).length

  // Full-height click bands per point (voronoi-style: each point owns the
  // midpoint-to-midpoint x range around it) rather than a small hit-circle.
  // A hit-circle's radius scales non-uniformly under this SVG's
  // preserveAspectRatio="none" + independent x/y stretch, collapsing into a
  // thin ellipse that's easy to miss vertically; a full-height band can't
  // be missed that way — any click near a point's time index selects it.
  const bands = coords.map((p, i) => {
    const left = i === 0 ? 0 : (coords[i - 1].x + p.x) / 2
    const right = i === coords.length - 1 ? VIEW_SIZE : (p.x + coords[i + 1].x) / 2
    return { ...p, bandLeft: left, bandRight: right }
  })

  // A step's currently-open status is worth showing on the curve, but most
  // selected steps (tool calls, errors, results) don't carry a confidence
  // value of their own — only assistant/thinking turns do. Rather than
  // fabricate a plausible-looking y position for them, draw a vertical
  // guideline at their x position and only add an on-curve ring when the
  // selected step really is one of the plotted points. A guessed dot on the
  // line would look like a real reading; it isn't one.
  const selectedOnCurve = selectedStepId ? coords.find((p) => p.stepId === selectedStepId) : undefined
  const selectedIndex = trace.steps.findIndex((s) => s.id === selectedStepId)
  const selectedX = !selectedOnCurve && selectedIndex !== -1 ? toX(selectedIndex, lastIndex) : null

  const areaPath =
    coords.length > 0
      ? `M ${coords[0].x} ${VIEW_SIZE} L ${coords.map((p) => `${p.x} ${p.y}`).join(' L ')} L ${coords[coords.length - 1].x} ${VIEW_SIZE} Z`
      : ''
  const gradientId = `confidence-fill-${trace.id}`
  const lineOpacity = trace.has_explicit_confidence ? 1 : 0.8

  return (
    <Section
      className="shrink-0"
      title="Reasoning Confidence"
      headerExtra={
        <>
          <span className={`text-xs ${trace.has_explicit_confidence ? 'text-neutral-300' : 'text-neutral-500'}`}>
            {trace.has_explicit_confidence ? 'reported' : 'heuristic'}
          </span>
          {dropCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400" />
              {dropCount} sharp drop{dropCount === 1 ? '' : 's'}
            </span>
          )}
        </>
      }
    >
      <div className="relative">
        {/* Plain HTML labels, not SVG <text> — this chart's viewBox is
            stretched non-uniformly (preserveAspectRatio="none"), which
            would squash/stretch real text into an unreadable shape. */}
        <span className="pointer-events-none absolute left-0 top-0 font-mono text-[10px] text-neutral-600">{yDomain.max.toFixed(2)}</span>
        <span className="pointer-events-none absolute bottom-0 left-0 font-mono text-[10px] text-neutral-600">{yDomain.min.toFixed(2)}</span>
        <svg viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} preserveAspectRatio="none" className="h-20 w-full overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(56 189 248)" stopOpacity={lineOpacity * 0.35} />
            <stop offset="100%" stopColor="rgb(56 189 248)" stopOpacity={0} />
          </linearGradient>
        </defs>

        {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />}

        {selectedX !== null && (
          <line
            x1={selectedX}
            y1={0}
            x2={selectedX}
            y2={VIEW_SIZE}
            stroke="rgb(226 232 240)"
            strokeOpacity={0.4}
            strokeWidth={1}
            strokeDasharray="2.5 2"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {coords.slice(1).map((p, i) => {
          const prev = coords[i]
          return (
            <line
              key={`seg-${p.stepId}`}
              x1={prev.x}
              y1={prev.y}
              x2={p.x}
              y2={p.y}
              vectorEffect="non-scaling-stroke"
              strokeWidth={1.5}
              stroke={p.isDrop ? 'rgb(248 113 113)' : 'rgb(56 189 248)'}
              strokeOpacity={p.isDrop ? 1 : lineOpacity}
              strokeLinecap="round"
            />
          )
        })}

        {bands.map((p) => {
          const isHighlighted = highlightStepIds?.has(p.stepId) ?? false
          return (
            <g key={p.stepId} className="cursor-pointer" onClick={() => onSelectStep(p.stepId)}>
              <title>
                {`step ${p.index}: confidence ${p.value.toFixed(2)}`}
                {p.isDrop ? ` — sharp drop${p.causeDetail ? `: ${p.causeDetail}` : ''}` : ''}
                {isHighlighted ? ' — evidence for the isolated failure mode' : ''}
              </title>
              <rect x={p.bandLeft} y={0} width={Math.max(p.bandRight - p.bandLeft, 0.001)} height={VIEW_SIZE} fill="transparent" />
              {isHighlighted && (
                <circle cx={p.x} cy={p.y} r={3} fill="none" stroke="rgb(251 191 36)" strokeOpacity={0.7} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={isHighlighted ? 2.2 : p.isDrop ? 1.7 : 1}
                vectorEffect="non-scaling-stroke"
                fill={isHighlighted ? 'rgb(251 191 36)' : p.isDrop ? 'rgb(248 113 113)' : 'rgb(56 189 248)'}
              />
            </g>
          )
        })}

        {selectedOnCurve && (
          <circle
            cx={selectedOnCurve.x}
            cy={selectedOnCurve.y}
            r={3}
            fill="none"
            stroke="rgb(226 232 240)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
        </svg>
      </div>

      {drop && <ConfidenceDropBlock drop={drop} stepNumber={trace.steps.findIndex((s) => s.id === drop.stepId)} onSelectStep={onSelectStep} />}
      {pause && <LongPauseBlock pause={pause} stepNumber={trace.steps.findIndex((s) => s.id === pause.stepId)} onSelectStep={onSelectStep} />}
    </Section>
  )
}
