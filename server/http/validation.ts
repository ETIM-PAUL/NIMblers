export interface RawEvent {
  key: string
  tRelativeMs: number
  resultingLength: number
}

function isRawEvent(value: unknown): value is RawEvent {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.key === 'string' && typeof v.tRelativeMs === 'number' && typeof v.resultingLength === 'number'
}

/** Parses the client-submitted keystroke event array shape (not its validity — that's validateRun's job). */
export function parseEvents(value: unknown): RawEvent[] | null {
  if (!Array.isArray(value)) return null
  return value.every(isRawEvent) ? value : null
}

export function parseStakeBody(body: unknown): { nimAddress: string, stakeTxHash: string } | null {
  if (typeof body !== 'object' || body === null) return null
  const v = body as Record<string, unknown>
  if (typeof v.nimAddress !== 'string' || typeof v.stakeTxHash !== 'string') return null
  return { nimAddress: v.nimAddress, stakeTxHash: v.stakeTxHash }
}
