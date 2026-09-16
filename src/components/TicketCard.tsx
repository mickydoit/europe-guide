import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'
import { kindIcon, ticketLines } from '../lib/tickets'
import type { Status, TicketKind } from '../lib/tickets'
import type { BookingRow } from '../lib/types'

export type CardTone = 'transport' | 'accommodation' | 'event' | 'highlight' | 'past'

/** The Figma 1:208 card: Poppins title, one label+value line, one light sub line, faded kind icon right. */
export function TicketCard({ booking, kind, status, tone, to, onCycleStatus, photoSrc }: {
  booking: BookingRow
  kind: TicketKind
  status: Status
  tone?: CardTone
  to: string
  onCycleStatus?: () => void
  photoSrc?: string | null
}) {
  const t = tone ?? kind
  const lines = ticketLines(booking, kind)
  return (
    <Link to={to} className={`ticket-card ticket-card--${t}`} aria-label={booking.title}>
      <span className="ticket-card__body">
        <span className="ticket-card__title">{booking.title}</span>
        <span className="ticket-card__line"><span className="ticket-card__label">{lines.label}</span> <span className="ticket-card__value">{lines.value}</span></span>
        {lines.sub && <span className="ticket-card__sub">{lines.sub}</span>}
        <span className="ticket-card__status"><StatusPill status={status} onClick={onCycleStatus} /></span>
      </span>
      <span className="ticket-card__art">
        {photoSrc ? <img className="ticket-card__photo" src={photoSrc} alt="" /> : <Icon set="kind" name={kindIcon(kind, booking.title)} size={72} className="ticket-card__icon" />}
      </span>
    </Link>
  )
}
