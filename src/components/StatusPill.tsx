import type { Status } from '../lib/tickets'

const LABEL: Record<Exclude<Status, null>, string> = {
  not_booked: 'Not booked', booked: 'Booked', confirmed: 'Confirmed', cancelled: 'Cancelled', undecided: 'Undecided',
  reserved_unpaid: 'Unpaid hold', unconfirmed: 'Unconfirmed', walk_up: 'Walk up', not_needed: 'Not needed',
}

export function StatusPill({ status, onClick }: { status: Status; onClick?: () => void }) {
  const label = status ? LABEL[status] : '—'
  const cls = `status-pill status-pill--${status ?? 'none'}`
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={e => { e.preventDefault(); e.stopPropagation(); onClick() }} aria-label={`Status: ${label}. Tap to change`}>
        {label}
      </button>
    )
  }
  return <span className={cls}>{label}</span>
}
