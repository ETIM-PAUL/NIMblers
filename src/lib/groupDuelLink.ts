/**
 * Mirrors duelLink.ts for group duels — kept environment-agnostic (no
 * `window`) so it can be unit-tested directly under Node, same reason
 * duelLink.ts is split out from api.ts.
 */

/** The query param a shared group duel link carries. */
export const GROUP_DUEL_QUERY_PARAM = 'groupDuel'

/**
 * Inverse of `buildGroupDuelDeepLink`, for pasting a group duel link (or
 * just the raw 6-character code) back in. Accepts a full URL with
 * `?groupDuel=...`, a bare query string, or just the code itself.
 */
export function parseGroupDuelCode(pasted: string): string | null {
  const trimmed = pasted.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed).searchParams.get(GROUP_DUEL_QUERY_PARAM)
  }
  catch {
    // Not a full URL — fall through to the other shapes below.
  }
  const withoutLeadingQuestion = trimmed.startsWith('?') ? trimmed.slice(1) : trimmed
  if (withoutLeadingQuestion.includes('=')) {
    return new URLSearchParams(withoutLeadingQuestion).get(GROUP_DUEL_QUERY_PARAM)
  }
  return withoutLeadingQuestion.toUpperCase()
}
