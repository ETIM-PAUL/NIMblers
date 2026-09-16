import { useEffect, useState } from 'react'
import Identicons from '@nimiq/identicons'
import identiconsSvgUrl from '@nimiq/identicons/dist/identicons.min.svg?url'

Identicons.svgPath = identiconsSvgUrl

interface Props {
  address: string
  size?: number
  className?: string
}

/**
 * The same deterministic avatar Nimiq Pay and the Nimiq wallet already show
 * for this exact address — `@nimiq/identicons` hashes the address string
 * itself, so there's no separate "our app's opinion of this avatar" to look
 * inconsistent with what the user sees everywhere else in the ecosystem.
 * Starts from a neutral placeholder (the library's own, generated
 * synchronously) so a list of these never flashes empty while the real
 * ones resolve.
 */
export function Identicon({ address, size = 40, className }: Props) {
  const [src, setSrc] = useState(() => Identicons.placeholderToDataUrl())

  useEffect(() => {
    let cancelled = false
    Identicons.toDataUrl(address).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [address])

  return (
    <img
      className={`identicon${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      src={src}
      alt=""
    />
  )
}
