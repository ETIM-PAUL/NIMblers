interface Props {
  isReady: boolean
  hasConsensus: boolean | null
}

export function ConnectionBanner({ isReady, hasConsensus }: Props) {
  if (!isReady) return null

  const consensusLabel =
    hasConsensus === null ? 'checking consensus…' : hasConsensus ? 'consensus established' : 'awaiting consensus'
  return <div className="banner banner-ok">Connected to Nimiq Pay — {consensusLabel}</div>
}
