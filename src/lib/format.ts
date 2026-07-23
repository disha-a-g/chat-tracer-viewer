export function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
    `.${d.getMilliseconds().toString().padStart(3, '0')}`
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) return '—'
  if (ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`
  // Round to the nearest whole second first, then split into minutes/seconds
  // — rounding each part independently (floor(ms/60000) minutes, round of the
  // remainder for seconds) lets the seconds side round up to 60 on its own
  // (e.g. 119999ms -> "1m 60s" instead of "2m 0s") since the carry into
  // minutes never happens.
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}

export function oneLine(text: string, max = 140): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed
}

export function formatTokenCount(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n < 1000) return String(n)
  // 999_500 (not 1_000_000): (n / 1000).toFixed(0) rounds up to "1000" for
  // anything from here up to 1_000_000, which used to print "1000k" instead
  // of crossing over to "1.0M" — the bucket was chosen from the raw value,
  // not from what it actually rounds to.
  if (n < 999_500) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function formatJson(value: unknown): string | null {
  if (value === undefined) return null
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
