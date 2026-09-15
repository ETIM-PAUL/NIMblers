import { useState } from 'react'
import { AddressCard } from './components/AddressCard'
import { ConnectionBanner } from './components/ConnectionBanner'
import { OpenInNimiqPay } from './components/OpenInNimiqPay'
import { TypingEngine } from './components/TypingEngine'
import { useNimiq } from './lib/useNimiq'

// Phase 4 demo text. Phase 6 replaces this with a real paragraph fetched
// through the paragraph service.
const DEMO_PARAGRAPH = 'The quick brown fox jumps over the lazy dog.'

function App() {
  const {
    isConnecting,
    isReady,
    errorMessage,
    hasConsensus,
    address,
    isLoadingAddress,
    addressError,
    connectWallet,
  } = useNimiq()
  const [submitted, setSubmitted] = useState(false)

  if (isConnecting) {
    return (
      <div className="app">
        <div className="banner banner-neutral">Connecting to Nimiq Pay…</div>
      </div>
    )
  }

  if (!isReady) {
    return (
      <div className="app">
        <OpenInNimiqPay errorMessage={errorMessage} />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Typing Duel</h1>
        <p className="app-subtitle">Async 1v1 speed-typing duels for NIM</p>
      </header>

      <ConnectionBanner isReady={isReady} hasConsensus={hasConsensus} />

      <main className="app-main">
        <AddressCard
          address={address}
          isLoading={isLoadingAddress}
          error={addressError}
          onConnect={connectWallet}
        />

        <section className="section">
          <h2 className="section-title">Practice (Phase 4 demo)</h2>
          {submitted
            ? <p className="section-note">Matched! (Nothing is saved yet — that's Phase 6.)</p>
            : <TypingEngine paragraph={DEMO_PARAGRAPH} onSubmit={() => setSubmitted(true)} />}
        </section>
      </main>
    </div>
  )
}

export default App
