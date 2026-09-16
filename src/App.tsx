import { useState } from 'react'
import { AddressCard } from './components/AddressCard'
import { ChallengeBrowser } from './components/ChallengeBrowser'
import { ConnectionBanner } from './components/ConnectionBanner'
import { DuelPanel } from './components/DuelPanel'
import { Leaderboard } from './components/Leaderboard'
import { OpenInNimiqPay } from './components/OpenInNimiqPay'
import { PracticePanel } from './components/PracticePanel'
import { DUEL_QUERY_PARAM } from './lib/api'
import { useNimiq } from './lib/useNimiq'

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
    sendPayment,
  } = useNimiq()

  // A private duel's shared link opens straight to that entry (see
  // src/lib/api.ts's buildDuelDeepLink) instead of the public browse list.
  // Read once — the param that opened this session doesn't change later.
  const [presetEntryId] = useState(() => new URLSearchParams(window.location.search).get(DUEL_QUERY_PARAM) ?? undefined)

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
          <h2 className="section-title">Duel</h2>
          {address
            ? <DuelPanel address={address} sendPayment={sendPayment} />
            : <p className="section-note">Show your address above to stake and start a duel.</p>}
        </section>

        <section className="section">
          <h2 className="section-title">{presetEntryId ? 'Duel invite' : 'Open duels'}</h2>
          {address
            ? <ChallengeBrowser address={address} sendPayment={sendPayment} presetEntryId={presetEntryId} />
            : <p className="section-note">Show your address above to {presetEntryId ? 'see this duel' : 'browse and take a bet'}.</p>}
        </section>

        <section className="section">
          <h2 className="section-title">Practice</h2>
          <PracticePanel />
        </section>

        <section className="section">
          <h2 className="section-title">Leaderboard</h2>
          <Leaderboard />
        </section>
      </main>
    </div>
  )
}

export default App
