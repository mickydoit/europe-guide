import { Link } from 'react-router-dom'
import { StatusPill } from './StatusPill'
import { Badges } from './Badges'
import { ticketLines } from '../lib/tickets'
import { usePhoto } from '../lib/photos'
import type { Status, TicketKind } from '../lib/tickets'
import type { BookingRow } from '../lib/types'

export type CardTone = 'transport' | 'accommodation' | 'event' | 'highlight' | 'past'

/** The Figma 1:208 card: Poppins title, one label+value line, one light sub line, kind + status badges top-right. */
export function TicketCard({ booking, kind, status, tone, to, onCycleStatus, photoPath }: {
  booking: BookingRow
  kind: TicketKind
  status: Status
  tone?: CardTone
  to: string
  onCycleStatus?: () => void
  photoPath?: string | null
}) {
  const t = tone ?? kind
  const lines = ticketLines(booking, kind)
  // The art slot is drawn from the resolved photo, not the path: a path whose bytes are not
  // on the phone yet must leave the card exactly as it was before photos existed.
  const src = usePhoto(photoPath ?? booking.photo_path)
  return (
    <article className={`ticket-card ticket-card--${t}${src ? ' ticket-card--photo' : ''}`}>
      <Link to={to} className="ticket-card__link">
        <span className="ticket-card__body">
          <span className="ticket-card__title">{booking.title}</span>
          <span className="ticket-card__line"><span className="ticket-card__label">{lines.label}</span> <span className="ticket-card__value">{lines.value}</span></span>
          {lines.sub && <span className="ticket-card__sub">{lines.sub}</span>}
        </span>
        {src && <span className="ticket-card__art"><img className="ticket-card__photo" src={src} alt="" loading="lazy" /></span>}
      </Link>
      <span className="ticket-card__badges"><Badges kind={kind} title={booking.title} status={status} /></span>
      <span className="ticket-card__status"><StatusPill status={status} onClick={onCycleStatus} /></span>
    </article>
  )
}
