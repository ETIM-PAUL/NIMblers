/** Minimal hand-drawn stroke icons for the bottom nav — no icon library, just four small paths. */

function IconBase({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

export function DuelIcon() {
  return (
    <IconBase>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </IconBase>
  )
}

export function OpenIcon() {
  return (
    <IconBase>
      <path d="M4 7h16M4 12h16M4 17h10" />
    </IconBase>
  )
}

export function PracticeIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </IconBase>
  )
}

export function BoardIcon() {
  return (
    <IconBase>
      <path d="M8 4h8v4a4 4 0 0 1-8 0V4Z" />
      <path d="M8 5H5a1 1 0 0 0-1 1 4 4 0 0 0 4 4M16 5h3a1 1 0 0 1 1 1 4 4 0 0 1-4 4" />
      <path d="M12 13v3M9 20h6M10 17h4v3h-4z" />
    </IconBase>
  )
}

/** The app-bar's logo mark — a filled version of DuelIcon's bolt, in a gradient badge. */
export function AppLogo() {
  return (
    <span className="app-logo">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
      </svg>
    </span>
  )
}

/** One leaf — the easy tier: calm, low-stakes. */
export function EasyIcon() {
  return (
    <IconBase>
      <path d="M12 21c-4-1-7-4.5-7-9 0-3 2-6 7-10 5 4 7 7 7 10 0 4.5-3 8-7 9Z" />
    </IconBase>
  )
}

/** Two crossed swords — the medium tier: a real contest. */
export function MediumIcon() {
  return (
    <IconBase>
      <path d="M5 5 19 19M19 5 5 19" />
      <path d="M5 5 3 3M19 5l2-2M5 19l-2 2M19 19l2 2" />
    </IconBase>
  )
}

/** A flame — the hard tier: high stakes, high burn. */
export function HardIcon() {
  return (
    <IconBase>
      <path d="M12 2c1 3-2 4-2 7a2 2 0 0 0 4 0c1 1 2 3 2 5a6 6 0 0 1-12 0c0-3 2-5 3-7 0 2 1 3 2 3 1-1 2-4 3-8Z" />
    </IconBase>
  )
}
