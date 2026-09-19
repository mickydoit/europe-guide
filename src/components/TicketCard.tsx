import { Link } from 'react-router-dom'
import { StatusPill } from './StatusPill'
import { Badges } from './Badges'
import { Icon } from './Icon'
import { kindIcon, ticketLines } from '../lib/tickets'
import type { Status, TicketKind } from '../lib/tickets'
import type { BookingRow } from '../lib/types'

export type CardTone = 'transport' | 'accommodation' | 'event' | 'highlight' | 'past'

/**
 * The Figma 1:208 card: Poppins title, one label+value line, one light sub line, the big faded
 * kind glyph right, status badge top-right. No photo here — photos belong to the detail
 * hero; the card reads at a glance by colour and glyph.
 */
export function TicketCard({ booking, kind, status, tone, to, onCycleStatus }: {
  booking: BookingRow
  kind: TicketKind
  status: Status
  tone?: CardTone
  to: string
  onCycleStatus?: () => void
}) {
  const t = tone ?? kind
  const lines = ticketLines(booking, kind)
  return (
    <article className={`ticket-card ticket-card--${t}`}>
      <Link to={to} className="ticket-card__link">
        <span className="ticket-card__body">
          <span className="ticket-card__title">{booking.title}</span>
          <span className="ticket-card__line"><span className="ticket-card__label">{lines.label}</span> <span className="ticket-card__value">{lines.value}</span></span>
          {lines.sub && <span className="ticket-card__sub">{lines.sub}</span>}
        </span>
        <span className="ticket-card__art"><Icon set="kind" name={kindIcon(kind, booking.title)} size={90} className="ticket-card__icon" /></span>
      </Link>
      <span className="ticket-card__badges"><Badges kind={kind} status={status} /></span>
      <span className="ticket-card__status"><StatusPill status={status} onClick={onCycleStatus} /></span>
    </article>
  )
}
