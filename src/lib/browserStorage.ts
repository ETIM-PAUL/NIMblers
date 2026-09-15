import type { StorageLike } from './personalBest'

/** window.localStorage, or null if it's unavailable (private browsing, disabled, restricted webview). */
export function getBrowserLocalStorage(): StorageLike | null {
  try {
    return window.localStorage
  }
  catch {
    return null
  }
}
