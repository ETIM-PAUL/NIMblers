/**
 * Kept separate from api.ts (rather than living there with
 * `buildDuelDeepLink`) because it's environment-agnostic — no `window` —
 * so it can be unit-tested directly under Node, unlike the rest of api.ts.
 */

/** The query param a shared duel link carries. */
export const DUEL_QUERY_PARAM = 'duel'

/**
 * Inverse of `buildDuelDeepLink`, for pasting a duel link (or just the raw
 * code) back in — link-clickability depends on the recipient's app, so
 * pasting is the reliable fallback. Accepts a full URL with `?duel=...`,
 * a bare query string, or just the code itself.
 */
export function parseDuelEntryId(pasted: string): string | null {
  const trimmed = pasted.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed).searchParams.get(DUEL_QUERY_PARAM)
  }
  catch {
    // Not a full URL — fall through to the other shapes below.
  }
  const withoutLeadingQuestion = trimmed.startsWith('?') ? trimmed.slice(1) : trimmed
  if (withoutLeadingQuestion.includes('=')) {
    return new URLSearchParams(withoutLeadingQuestion).get(DUEL_QUERY_PARAM)
  }
  return withoutLeadingQuestion
}
