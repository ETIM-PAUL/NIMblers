import { DUEL_QUERY_PARAM } from './duelLink.ts'

export type Difficulty = 'easy' | 'medium' | 'hard'

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']
export const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

export type Language = 'en' | 'fr' | 'es'

export const LANGUAGES: Language[] = ['en', 'fr', 'es']
export const LANGUAGE_LABELS: Record<Language, string> = { en: 'English', fr: 'French', es: 'Spanish' }

/**
 * Maps the browser/device's own language setting to one of the three this
 * app supports, so the language picker starts on whatever the player
 * already reads instead of always defaulting to English. Falls back to
 * English for anything else (German, Japanese, an unrecognized locale
 * string, or `navigator.language` being unavailable at all).
 */
export function detectDeviceLanguage(): Language {
  const tag = typeof navigator !== 'undefined' ? navigator.language : undefined
  const primary = tag?.slice(0, 2).toLowerCase()
  return primary === 'fr' || primary === 'es' ? primary : 'en'
}

export type Visibility = 'PUBLIC' | 'PRIVATE'

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

/**
 * Extracts a human-readable message from anything a `catch` block might see.
 * Not every rejection here is a real `Error` — the Nimiq Pay provider bridge
 * (`@nimiq/mini-app-sdk`) can reject a request with a plain object instead
 * (e.g. a transport-level timeout when there's no real Nimiq Pay parent to
 * answer, which is exactly what happens testing this in a plain browser).
 * Falling back to bare `String(error)` for those turns into the literal
 * text "[object Object]", which tells the player nothing — so a plain
 * object is inspected for a `.message` (or nested `.error.message`, the
 * provider's own `ErrorResponse` shape) first, and only stringified as JSON
 * as a last resort.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) {
    const value = error as Record<string, unknown>
    if (typeof value.message === 'string') return value.message
    const nested = value.error
    if (typeof nested === 'object' && nested !== null && typeof (nested as Record<string, unknown>).message === 'string') {
      return (nested as Record<string, unknown>).message as string
    }
    try {
      return JSON.stringify(error)
    }
    catch {
      // Falls through to String() below — e.g. a circular structure.
    }
  }
  return String(error)
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

export type EntryStatus = 'OPEN' | 'LOCKED' | 'SETTLED' | 'EXPIRED'

export interface MyEntry {
  entryId: string
  stakeLuna: number
  difficulty: Difficulty
  language: Language
  status: EntryStatus
  visibility: Visibility
  createdAt: string
  expiresAt: string
  challengerAddress: string | null
  outcome: 'creator' | 'challenger' | 'tie' | null
}

/** Every duel this address created — any status or visibility, independent of local browser state. */
export async function fetchMyEntries(nimAddress: string): Promise<MyEntry[]> {
  const res = await fetch(`/api/entries/mine?nimAddress=${encodeURIComponent(nimAddress)}`)
  const body = await readJsonOrThrow(res, 'Could not load your duels')
  return body.entries as MyEntry[]
}

export interface DuelHistoryEntry {
  entryId: string
  difficulty: Difficulty
  language: Language
  stakeLuna: number
  settledAt: string
  opponentAddress: string
  outcome: 'won' | 'lost' | 'tied'
  myDurationMs: number
  opponentDurationMs: number
  deltaMs: number
  flawless: boolean
}

export interface EarnedBadge {
  id: 'flawless' | 'speed-demon' | 'win-streak-5'
  label: string
  description: string
}

export interface DuelHistoryResult {
  history: DuelHistoryEntry[]
  badges: EarnedBadge[]
}

/** Every duel this address has actually finished, as creator or challenger, newest-decided first — plus any achievement badges earned across that history. */
export async function fetchDuelHistory(nimAddress: string): Promise<DuelHistoryResult> {
  const res = await fetch(`/api/duels/history?nimAddress=${encodeURIComponent(nimAddress)}`)
  const body = await readJsonOrThrow(res, 'Could not load your duel history')
  return { history: body.history as DuelHistoryEntry[], badges: body.badges as EarnedBadge[] }
}

export interface WeakKeyStat {
  key: string
  mistakes: number
  occurrences: number
  mistakeRate: number
}

/** The characters this address most often types wrong and then corrects, ranked by mistake rate — see server/runs/weakKeys.ts. */
export async function fetchWeakKeys(nimAddress: string): Promise<WeakKeyStat[]> {
  const res = await fetch(`/api/runs/weak-keys?nimAddress=${encodeURIComponent(nimAddress)}`)
  const body = await readJsonOrThrow(res, 'Could not load your weak keys')
  return body.weakKeys as WeakKeyStat[]
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`
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
