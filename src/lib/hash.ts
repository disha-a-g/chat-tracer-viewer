// Deterministic, dependency-free string hash (FNV-1a, 32-bit). Used to derive
// stable trace ids from raw trace content for localStorage/URL persistence.
export function hashString(str: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function generateTraceId(raw: string): string {
  return `trc_${hashString(raw)}`
}
