import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { kindIcon } from '../lib/tickets'
import type { TicketKind } from '../lib/tickets'
import { fmtDay } from '../lib/time'
import type { BookingRow } from '../lib/types'

const KIND_LABEL: Record<TicketKind, string> = { transport: 'Transport', accommodation: 'Stay', event: 'Next up' }

function phoneHref(contact: string | null): string | null {
  if (!contact || !/^[+\d]/.test(contact.trim())) return null
  return `tel:${contact.replace(/(?!^\+)[^\d]/g, '')}`
}

/** The Figma 1:129 "Airport Cab" card: kind label, big green name, address line, icon and call button.
 *  The name leads so the owner knows what the thing is; the reference lives on the detail screen. */
export function NextUpCard({ booking, kind, date, to }: { booking: BookingRow; kind: TicketKind; date: string; to: string }) {
  const tel = phoneHref(booking.contact)
  return (
    <section className="nextup" aria-label="Next up">
      <Link to={to} className="nextup__link">
        <span className="nextup__kind">{KIND_LABEL[kind]} · {fmtDay(date)}{booking.time ? ` · ${booking.time}` : ''}</span>
        <span className="nextup__name">{booking.title}</span>
        {(booking.address || booking.contact) && (
          <span className="nextup__address"><Icon set="nav" name="map" size={14} /> {booking.address ?? booking.contact}</span>
        )}
        <span className="nextup__foot">
          <Icon set="kind" name={kindIcon(kind, booking.title)} size={40} className="nextup__icon" />
        </span>
      </Link>
      {tel && <a className="nextup__call" href={tel} aria-label={`Call ${booking.title}`}>Call</a>}
    </section>
  )
}
