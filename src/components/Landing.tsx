import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { EXAMPLE_TRACES } from '../fixtures/examples'
import type { RecentTraceEntry } from '../lib/recentTraces'

interface LandingProps {
  onLoad: (raw: string, sourceLabel?: string) => void
  recentTraces: RecentTraceEntry[]
  onOpenRecent: (traceId: string) => void
  onClearRecent: () => void
  onForgetRecent: (traceId: string) => void
  /** Set when the last paste/upload/URL fetch didn't produce a readable
   *  trace. Shown right below the intro so it's visible without scrolling
   *  past the "Load an example" grid, regardless of which of the three
   *  entry points the user tried. */
  loadError: string | null
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export function Landing({ onLoad, recentTraces, onOpenRecent, onClearRecent, onForgetRecent, loadError }: LandingProps) {
  const [pasted, setPasted] = useState('')
  const [url, setUrl] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [loadingExampleId, setLoadingExampleId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handlePasteSubmit() {
    if (!pasted.trim()) return
    onLoad(pasted, 'pasted trace')
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileError(null)
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      if (!text.trim()) {
        setFileError('That file appears to be empty.')
        return
      }
      onLoad(text, file.name)
    }
    reader.onerror = () => setFileError(`Could not read "${file.name}": ${reader.error?.message ?? 'unknown error'}`)
    reader.readAsText(file)
    e.target.value = ''
  }

  async function handleUrlSubmit() {
    const trimmed = url.trim()
    if (!trimmed) return
    setUrlLoading(true)
    setUrlError(null)
    try {
      const res = await fetch(trimmed)
      if (!res.ok) {
        setUrlError(`Request failed: ${res.status} ${res.statusText}`)
        return
      }
      const text = await res.text()
      if (!text.trim()) {
        setUrlError('That URL returned an empty response.')
        return
      }
      onLoad(text, trimmed)
    } catch (err) {
      setUrlError(
        `Could not fetch that URL — ${err instanceof Error ? err.message : 'unknown error'}. ` +
          'This runs entirely in your browser, so the server must allow cross-origin requests (CORS).',
      )
    } finally {
      setUrlLoading(false)
    }
  }

  async function handleExampleClick(example: (typeof EXAMPLE_TRACES)[number]) {
    setLoadingExampleId(example.id)
    try {
      const raw = await example.load()
      onLoad(raw, example.label)
    } finally {
      setLoadingExampleId(null)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-100">Chat Trace Viewer</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Load an agent trace — Claude Code JSONL, OpenAI chat completions, or any JSON with an array of
          step-like objects. Format is detected automatically.
        </p>
      </div>

      {recentTraces.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-200">Recent traces</h2>
            <button type="button" onClick={onClearRecent} className="text-xs text-neutral-500 hover:text-neutral-300">
              Clear
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {recentTraces.map((entry) => (
              <div
                key={entry.id}
                className="group relative flex items-center rounded-md border border-neutral-800 hover:border-neutral-600 hover:bg-neutral-900"
              >
                <button
                  type="button"
                  onClick={() => onOpenRecent(entry.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">{entry.title}</span>
                  <span className="shrink-0 text-xs text-neutral-500">
                    {entry.format} · {entry.stepCount} steps · {relativeTime(entry.loadedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onForgetRecent(entry.id)
                  }}
                  title="Remove from recent traces"
                  aria-label={`Remove ${entry.title} from recent traces`}
                  className="mr-2 shrink-0 rounded p-1 text-red-400 opacity-0 hover:bg-red-500/10 hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {loadError && <p className="rounded-md border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-300">{loadError}</p>}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-neutral-200">Paste trace text</h2>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="Paste JSON or JSONL here…"
          rows={8}
          className="w-full resize-y rounded-md border border-neutral-800 bg-neutral-900 p-3 font-mono text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={handlePasteSubmit}
          disabled={!pasted.trim()}
          className="self-start rounded-md bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Load pasted trace
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-neutral-200">Upload a file</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border border-neutral-700 px-4 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900"
          >
            Choose .json or .jsonl file
          </button>
          <input ref={fileInputRef} type="file" accept=".json,.jsonl,application/json" className="hidden" onChange={handleFileChange} />
        </div>
        {fileError && <p className="text-xs text-red-400">{fileError}</p>}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-neutral-200">Load from a URL</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
            placeholder="https://example.com/trace.json"
            className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleUrlSubmit}
            disabled={!url.trim() || urlLoading}
            className="rounded-md border border-neutral-700 px-4 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {urlLoading ? 'Fetching…' : 'Fetch'}
          </button>
        </div>
        {urlError && <p className="text-xs text-red-400">{urlError}</p>}
      </section>

      <section className="flex flex-col gap-3 border-t border-neutral-800 pt-8">
        <h2 className="text-sm font-medium text-neutral-200">Load an example</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {EXAMPLE_TRACES.map((example) => (
            <button
              key={example.id}
              type="button"
              onClick={() => handleExampleClick(example)}
              disabled={loadingExampleId !== null}
              className="flex flex-col gap-1 rounded-md border border-neutral-800 p-3 text-left hover:border-neutral-600 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-sm font-medium text-neutral-200">
                {example.label}
                {loadingExampleId === example.id && <span className="ml-2 text-xs text-neutral-500">Loading…</span>}
              </span>
              <span className="text-xs text-neutral-500">{example.description}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
