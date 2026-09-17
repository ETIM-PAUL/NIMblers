export type Difficulty = 'easy' | 'medium' | 'hard'

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']
export const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

export type Visibility = 'PUBLIC' | 'PRIVATE'

/** The query param a shared duel link carries. */
export const DUEL_QUERY_PARAM = 'duel'

/**
 * A plain https link to this mini app with the duel preset — not a
 * `nimiqpay://` custom scheme. Chat apps only auto-linkify recognized
 * schemes, so a custom one just shows up as dead text; a normal URL is
 * tappable everywhere and still opens straight to this duel, since the app
 * reads `?duel=` itself on load (see App.tsx's `presetEntryId`).
 */
export function buildDuelDeepLink(entryId: string): string {
  const miniAppUrl = new URL(window.location.origin + window.location.pathname)
  miniAppUrl.searchParams.set(DUEL_QUERY_PARAM, entryId)
  return miniAppUrl.toString()
}

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
  stakes: Record<Difficulty, number>
}

export async function fetchHouseAddress(): Promise<HouseAddressInfo> {
  const res = await fetch('/api/house-address')
  const body = await readJsonOrThrow(res, 'Could not reach the house wallet')
  return { address: body.address as string, stakes: body.stakes as Record<Difficulty, number> }
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

/** "NQ07 ABCD…WXYZ" — short enough for a header chip, still recognizable at a glance. */
export function formatAddressShort(address: string): string {
  const groups = address.split(' ').filter(Boolean)
  if (groups.length <= 3) return address
  return `${groups[0]} ${groups[1]}…${groups[groups.length - 1]}`
}
