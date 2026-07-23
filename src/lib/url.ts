// Pure helpers for the shareable-URL scheme: ?trace=<id>&step=<step_id>&notes=<encoded>.
// Kept free of `window` so they're unit-testable without a DOM.

export interface UrlState {
  traceId: string | null
  stepId: string | null
  notes: string | null
}

export function parseUrlParams(search: string): UrlState {
  const params = new URLSearchParams(search)
  return { traceId: params.get('trace'), stepId: params.get('step'), notes: params.get('notes') }
}

export function buildUrlSearch(currentSearch: string, traceId: string | null, stepId: string | null, notes: string | null): string {
  const params = new URLSearchParams(currentSearch)

  if (traceId) params.set('trace', traceId)
  else params.delete('trace')

  if (stepId) params.set('step', stepId)
  else params.delete('step')

  if (notes) params.set('notes', notes)
  else params.delete('notes')

  const query = params.toString()
  return query ? `?${query}` : ''
}
