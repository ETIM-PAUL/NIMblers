export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Parses a fetch response as JSON, throwing the server's `error` field (or a fallback) if the response wasn't ok. */
export async function readJsonOrThrow(res: Response, fallback: string): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const reason = typeof body.error === 'string' ? body.error : fallback
    throw new Error(reason)
  }
  return body
}

export interface HouseAddressInfo {
  address: string
  stakeLuna: number
}

export async function fetchHouseAddress(): Promise<HouseAddressInfo> {
  const res = await fetch('/api/house-address')
  const body = await readJsonOrThrow(res, 'Could not reach the house wallet')
  return { address: body.address as string, stakeLuna: body.stakeLuna as number }
}

/** "5m ago", "2h ago", "3d ago" — coarse enough that it never needs a live-updating clock. */
export function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatLuna(luna: number): string {
  return `${luna / 100_000} NIM`
}
