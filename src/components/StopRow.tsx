import { Link } from 'react-router-dom'
import { Md } from './Md'
import { Badges } from './Badges'
import { effectiveStatus, inferKind } from '../lib/tickets'
import { fmtTime } from '../lib/time'
import type { BookingRow, ItemRow } from '../lib/types'

function firstLine(text: string | null): string | null { if (!text) return null; const i = text.indexOf('\n'); return i === -1 ? text : text.slice(0, i) }

/** One compact timeline row: time in green, name, first details line, tick. Tap opens the place; a matching booking adds a ticket link. */
export function StopRow({ item, tripSlug, booking, done, onToggle }: {
  item: ItemRow
  tripSlug: string
  booking: BookingRow | null
  done: boolean
  onToggle: () => void
}) {
  const details = firstLine(item.details)
  return (
    <div className={`stop-row${done ? ' is-done' : ''}`}>
      <span className="stop-row__time">{fmtTime(item.time, item.time_text)}</span>
      <Link to={`/place/${encodeURIComponent(item.id)}?trip=${tripSlug}`} className="stop-row__main">
        <span className="stop-row__plan"><Md text={item.plan} noLinks /></span>
        {details && <span className="stop-row__details"><Md text={details} noLinks /></span>}
        {booking && <span className="stop-row__ticket"><Badges kind={inferKind(booking)} title={booking.title} status={effectiveStatus(booking, undefined)} /></span>}
      </Link>
      {booking && <Link to={`/ticket/${tripSlug}/${booking.id}?trip=${tripSlug}`} className="stop-row__ticket-link" aria-label={`Open ticket ${booking.title}`}>Open ticket</Link>}
      <button type="button" className={`tick${done ? ' tick--done' : ''}`} aria-label={done ? 'Mark not done' : 'Mark done'} onClick={onToggle}>✓</button>
    </div>
  )
}
