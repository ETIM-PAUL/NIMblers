import { useState } from 'react'
import { AddressCard } from './components/AddressCard'
import { ChallengeBrowser } from './components/ChallengeBrowser'
import { ConnectionBanner } from './components/ConnectionBanner'
import { DuelHistory } from './components/DuelHistory'
import { DuelPanel } from './components/DuelPanel'
import { Leaderboard } from './components/Leaderboard'
import { AppLogo, BoardIcon, DuelIcon, HistoryIcon, OpenIcon, PracticeIcon } from './components/NavIcons'
import { OpenInNimiqPay } from './components/OpenInNimiqPay'
import { PracticePanel } from './components/PracticePanel'
import { DUEL_QUERY_PARAM } from './lib/duelLink'
import { useNimiq } from './lib/useNimiq'

const TABS = ['duel', 'open', 'history', 'practice', 'leaderboard'] as const
type Tab = typeof TABS[number]

const TAB_ICONS: Record<Tab, React.ReactNode> = {
  duel: <DuelIcon />,
  open: <OpenIcon />,
  history: <HistoryIcon />,
  practice: <PracticeIcon />,
  leaderboard: <BoardIcon />,
}

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
  const [activeTab, setActiveTab] = useState<Tab>(presetEntryId ? 'open' : 'duel')
  const tabLabels: Record<Tab, string> = {
    duel: 'Duel',
    open: presetEntryId ? 'Invite' : 'Open',
    history: 'History',
    practice: 'Practice',
    leaderboard: 'Board',
  }

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
      <header className="app-bar">
        <div className="app-bar-brand">
          <AppLogo />
          <h1 className="app-bar-title">NIMblers</h1>
        </div>
        <AddressCard
          address={address}
          isLoading={isLoadingAddress}
          error={addressError}
          onConnect={connectWallet}
        />
      </header>

      <ConnectionBanner isReady={isReady} hasConsensus={hasConsensus} />

      <main className="app-main">
        <section className="section" hidden={activeTab !== 'duel'}>
          {address
            ? <DuelPanel address={address} sendPayment={sendPayment} />
            : <p className="section-note">Connect your wallet to start a duel.</p>}
        </section>

        <section className="section" hidden={activeTab !== 'open'}>
          {address
            ? <ChallengeBrowser address={address} sendPayment={sendPayment} presetEntryId={presetEntryId} />
            : <p className="section-note">Connect your wallet to {presetEntryId ? 'see this duel' : 'browse duels'}.</p>}
        </section>

        <section className="section" hidden={activeTab !== 'history'}>
          {address
            ? <DuelHistory address={address} />
            : <p className="section-note">Connect your wallet to see your duel history.</p>}
        </section>

        <section className="section" hidden={activeTab !== 'practice'}>
          <PracticePanel />
        </section>

        <section className="section" hidden={activeTab !== 'leaderboard'}>
          <Leaderboard />
        </section>
      </main>

      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`nav-item ${activeTab === tab ? 'nav-item-active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              <span className="nav-icon">{TAB_ICONS[tab]}</span>
              {tabLabels[tab]}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}

export default App
