import { Icon } from './Icon'
import type { Status, TicketKind } from '../lib/tickets'

const KIND_WORD: Record<TicketKind, string> = { transport: 'Transport', accommodation: 'Stay', event: 'Event', meal: 'Table' }
const STATUS_WORD: Record<Exclude<Status, null>, string> = { booked: 'booked', confirmed: 'confirmed', not_booked: 'to book', undecided: 'undecided', cancelled: 'cancelled',
  reserved_unpaid: 'reserved but unpaid', unconfirmed: 'unconfirmed', walk_up: 'walk up, no booking needed', not_needed: 'not needed' }

function statusTone(status: Status): 'booked' | 'todo' | 'muted' {
  if (status === 'booked' || status === 'confirmed') return 'booked'
  // walk_up and not_needed carry no action, so they must not wear the alert glyph.
  if (status === 'undecided' || status === 'cancelled' || status === 'walk_up' || status === 'not_needed') return 'muted'
  return 'todo'
}

/**
 * One small round badge saying where the booking stands (green check = booked, yellow alert =
 * still to book, grey = undecided or cancelled). The kind is already the big glyph on the card,
 * so it isn't repeated here — it only survives in the spoken label. The pill stays the tap target.
 */
export function Badges({ kind, status }: { kind: TicketKind; status: Status }) {
  const tone = statusTone(status)
  return (
    <span className="badges" role="img" aria-label={`${KIND_WORD[kind]}, ${status ? STATUS_WORD[status] : 'to book'}`}>
      <span className={`badge badge--status badge--${tone}`}><Icon set="badge" name={tone === 'booked' ? 'check' : 'alert'} size={14} /></span>
    </span>
  )
}
