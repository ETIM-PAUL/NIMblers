import { AddressCard } from './components/AddressCard'
import { ConnectionBanner } from './components/ConnectionBanner'
import { OpenInNimiqPay } from './components/OpenInNimiqPay'
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
  } = useNimiq()

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
      </main>
    </div>
  )
}

export default App
