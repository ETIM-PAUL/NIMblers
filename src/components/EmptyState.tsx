interface Props {
  icon: React.ReactNode
  title: string
  subtitle?: string
}

/** A designed empty state (icon + title + subtitle) instead of a single line of gray text — used wherever a list can legitimately be empty. */
export function EmptyState({ icon, title, subtitle }: Props) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">{icon}</span>
      <p className="empty-state-title">{title}</p>
      {subtitle && <p className="empty-state-subtitle">{subtitle}</p>}
    </div>
  )
}
