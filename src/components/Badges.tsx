import { Icon } from './Icon'
import { kindIcon } from '../lib/tickets'
import type { Status, TicketKind } from '../lib/tickets'

const KIND_WORD: Record<TicketKind, string> = { transport: 'Transport', accommodation: 'Stay', event: 'Event' }
const STATUS_WORD: Record<Exclude<Status, null>, string> = { booked: 'booked', confirmed: 'confirmed', not_booked: 'to book', undecided: 'undecided', cancelled: 'cancelled',
  reserved_unpaid: 'reserved but unpaid', unconfirmed: 'unconfirmed', walk_up: 'walk up, no booking needed', not_needed: 'not needed' }

function statusTone(status: Status): 'booked' | 'todo' | 'muted' {
  if (status === 'booked' || status === 'confirmed') return 'booked'
  // walk_up and not_needed carry no action, so they must not wear the alert glyph.
  if (status === 'undecided' || status === 'cancelled' || status === 'walk_up' || status === 'not_needed') return 'muted'
  return 'todo'
}

/**
 * Two small round badges: what kind of thing this is (plane / car / hotel / ticket stub, from the
 * Figma tab set) and where it stands (green check = booked, yellow alert = still to book, grey =
 * undecided or cancelled). The fast read on every card and row; the pill stays the tap target.
 */
export function Badges({ kind, title, status }: { kind: TicketKind; title: string; status: Status }) {
  const tone = statusTone(status)
  return (
    <span className="badges" role="img" aria-label={`${KIND_WORD[kind]}, ${status ? STATUS_WORD[status] : 'to book'}`}>
      <span className="badge badge--kind"><Icon set="badge" name={kindIcon(kind, title)} size={14} /></span>
      <span className={`badge badge--status badge--${tone}`}><Icon set="badge" name={tone === 'booked' ? 'check' : 'alert'} size={14} /></span>
    </span>
  )
}
