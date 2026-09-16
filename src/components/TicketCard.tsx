import { Link } from 'react-router-dom'
import { StatusPill } from './StatusPill'
import { Badges } from './Badges'
import { PhotoImg } from './PhotoImg'
import { ticketLines } from '../lib/tickets'
import type { Status, TicketKind } from '../lib/tickets'
import type { BookingRow } from '../lib/types'

export type CardTone = 'transport' | 'accommodation' | 'event' | 'highlight' | 'past'

/** The Figma 1:208 card: Poppins title, one label+value line, one light sub line, kind + status badges top-right. */
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
  const path = photoSrc ?? booking.photo_path
  return (
    <article className={`ticket-card ticket-card--${t}${path ? ' ticket-card--photo' : ''}`}>
      <Link to={to} className="ticket-card__link">
        <span className="ticket-card__body">
          <span className="ticket-card__title">{booking.title}</span>
          <span className="ticket-card__line"><span className="ticket-card__label">{lines.label}</span> <span className="ticket-card__value">{lines.value}</span></span>
          {lines.sub && <span className="ticket-card__sub">{lines.sub}</span>}
        </span>
        {path && <span className="ticket-card__art"><PhotoImg path={path} className="ticket-card__photo" /></span>}
      </Link>
      <span className="ticket-card__badges"><Badges kind={kind} title={booking.title} status={status} /></span>
      <span className="ticket-card__status"><StatusPill status={status} onClick={onCycleStatus} /></span>
    </article>
  )
}
