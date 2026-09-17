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
