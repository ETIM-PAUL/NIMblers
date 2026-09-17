/**
 * `navigator.clipboard` needs a secure context (https, or localhost) — it's
 * simply unavailable when testing over a plain-http LAN address. Falls
 * back to selecting `fallbackInput` and the older `execCommand` API, which
 * works in more contexts. Returns whether the copy actually succeeded.
 */
export async function copyText(text: string, fallbackInput?: HTMLInputElement | null): Promise<boolean> {
  try {
    if (!navigator.clipboard) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(text)
    return true
  }
  catch {
    // fall through to the execCommand fallback below
  }
  try {
    if (!fallbackInput) return false
    fallbackInput.focus()
    fallbackInput.select()
    return document.execCommand('copy')
  }
  catch {
    return false
  }
}
