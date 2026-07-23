// Normalized internal trace schema for the Chat Trace Viewer.
// This is the contract between adapters/* and everything downstream
// (timeline, stats, search, sparkline, annotations, deep links). No viewer
// code should branch on source format — only on these types.

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

export type StepType =
  | 'user' // human turn / initial goal
  | 'assistant' // model-authored natural language
  | 'tool_use' // model requested a tool call
  | 'tool_result' // the environment answered a tool call
  | 'thinking' // extended reasoning / scratchpad content
  | 'error' // an explicit failure: API error, tool exception, refusal, abort

/** Where a value came from. Anything not `source` is a viewer inference and is
 *  rendered with reduced emphasis (dimmed / dotted) so it is never mistaken for
 *  ground truth from the trace file. */
export type Provenance = 'source' | 'inferred' | 'unknown'

export type TraceFormat = 'claude-code-jsonl' | 'openai-chat-completions' | 'generic-json'

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/** A reasoning-confidence proxy attached to a step. Directional, not a claim about
 *  the model's internal state (see ideas.md, Trade-offs). `value` is normalized to
 *  [0, 1] regardless of the source scale. */
export interface ConfidenceSignal {
  value: number // 0 = no confidence, 1 = full confidence
  provenance: Provenance // 'source' when the trace carried it explicitly
  /** Which heuristics contributed, and by how much. Powers the sparkline tooltip:
   *  "confidence dropped here because hedging spiked and tool calls stopped". */
  components?: ConfidenceComponent[]
  /** Original value before normalization, for the raw view (e.g. logprob, 1-5 scale). */
  raw?: number | string
}

export interface ConfidenceComponent {
  name: ConfidenceHeuristic
  /** Signed contribution to `value`, already weighted. Sums (with the baseline) to `value`. */
  contribution: number
  detail?: string // human-readable, e.g. "3 hedging tokens in 41 words"
}

export type ConfidenceHeuristic =
  | 'explicit'
  | 'hedging_density'
  | 'length_shock'
  | 'tool_silence'
  | 'hypothesis_churn'
  | 'retry_pressure'
  | 'error_proximity'

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

/** A tool_use step and its matching tool_result step, joined into one object.
 *  Steps remain the source of truth for the timeline; ToolCall is the joined view
 *  used by the stats panel, tool-name search, and the failed-call affordances.
 *  Built by the adapter, not by the viewer. */
export interface ToolCall {
  id: string // == the tool_use Step.id
  step_id: string // the tool_use step
  result_step_id?: string // the tool_result step; absent = call never answered
  tool_name: string
  tool_input?: unknown // parsed; string only if the source was unparseable
  tool_output?: unknown
  status: 'ok' | 'error' | 'pending'
  error?: TraceError
  duration_ms?: number // result.timestamp - use.timestamp when both exist
  duration_provenance: Provenance
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface TraceError {
  message: string // always present; the one line shown in the timeline
  kind?: 'tool_error' | 'api_error' | 'refusal' | 'timeout' | 'abort' | 'parse_error' | 'unknown'
  code?: string | number
  stack?: string
  /** Set when the viewer inferred an error the source did not label as one
   *  (e.g. is_error: true, or a non-zero exit code in tool output). */
  provenance: Provenance
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

export interface Step {
  id: string // stable within a trace; used in deep links (#step=<id>)
  /** Causal parent: which step caused this one. tool_result -> its tool_use;
   *  assistant -> the user turn or tool_result it responds to. `null` = trace root.
   *  Falls back to previous-step-in-sequence when the format has no lineage;
   *  `parent_provenance` records which happened. */
  parent_id: string | null
  parent_provenance: Provenance
  type: StepType

  /** ISO-8601 with timezone. Absent when the format carries no time at all. */
  timestamp?: string
  /** Wall-clock cost of this step. For tool_use, the time until its result. */
  duration_ms?: number
  duration_provenance: Provenance

  /** Display text, flattened to a string. Multi-block messages are joined with
   *  "\n\n"; non-text blocks (images, documents) become a placeholder and survive
   *  intact in `raw`. Empty string for pure tool_use steps carrying no prose. */
  content: string

  // --- tool fields: present iff type is 'tool_use' or 'tool_result' -----------
  tool_name?: string
  tool_input?: unknown // 'tool_use' only
  tool_output?: unknown // 'tool_result' only
  tool_call_id?: string // links tool_use <-> tool_result across formats

  // --- failure ---------------------------------------------------------------
  /** Set on type: 'error', and also on a 'tool_result' that reports failure —
   *  a failed tool result stays a tool_result so the call/result pairing survives. */
  error?: TraceError

  // --- epistemic -------------------------------------------------------------
  confidence?: ConfidenceSignal // absent for steps confidence is not defined on

  // --- optional detail -------------------------------------------------------
  model?: string
  tokens?: TokenUsage
  /** Other step ids this step depends on beyond `parent_id` (e.g. an assistant turn
   *  citing three earlier tool_results). Unused in Layer 1; the hook for evidence
   *  lineage and counterfactual importance in Layer 3. */
  refs?: string[]
  /** Format-specific fields with no normalized home. Never read by the viewer's
   *  logic — surfaced only in the raw view. */
  meta?: Record<string, unknown>
  /** The verbatim source object for this step. Powers the per-step raw JSON toggle
   *  and guarantees normalization is never lossy from the user's point of view. */
  raw?: unknown
}

export interface TokenUsage {
  input?: number
  output?: number
  cache_read?: number
  cache_creation?: number
  total?: number
}

// ---------------------------------------------------------------------------
// Trace
// ---------------------------------------------------------------------------

export interface Trace {
  id: string // stable id for URL/localStorage persistence
  format: TraceFormat // which adapter produced this; shown in the raw view
  schema_version: 1

  steps: Step[] // chronological where time exists, else source order
  tool_calls: ToolCall[] // joined view over `steps`; derived, never authoritative

  stats: TraceStats
  /** Non-fatal problems found while normalizing. The viewer shows these as a banner
   *  rather than failing the load — a partially-readable trace beats an error page. */
  issues: TraceIssue[]

  title?: string // first user message, truncated; else the filename
  started_at?: string
  ended_at?: string
  model?: string // dominant model across steps
  /** True when at least one step carried an explicit confidence signal. Drives the
   *  sparkline's "heuristic" vs "reported" label. */
  has_explicit_confidence: boolean
  meta?: Record<string, unknown>
  /** The whole source document. Backs the whole-trace raw view. Dropped from
   *  localStorage above a size threshold; the viewer degrades to steps[].raw. */
  raw?: unknown
}

export interface TraceStats {
  step_count: number
  duration_ms?: number // ended_at - started_at
  duration_provenance: Provenance
  tool_call_count: number
  error_count: number // steps with an error, incl. failed tool_results
  model_call_count: number // assistant + thinking steps
  tokens?: TokenUsage // summed where available; absent if no step reports usage
}

export interface TraceIssue {
  severity: 'warning' | 'error'
  message: string // e.g. "4 tool_use steps have no matching tool_result"
  step_id?: string
}

/** Alias used by adapters: the return type of every `parse()` function is a
 *  fully normalized Trace conforming to this schema. */
export type NormalizedTrace = Trace
