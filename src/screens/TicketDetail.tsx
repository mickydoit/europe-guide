import { Fragment, useEffect } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTrip } from '../lib/trip'
import { useBookingState } from '../lib/state'
import { fmtDay, fmtTime } from '../lib/time'
import { effectiveStatus, fourCells, inferKind, kindIcon } from '../lib/tickets'
import { walkLink } from '../lib/links'
import { Icon } from '../components/Icon'
import { Md } from '../components/Md'
import { StatusPill } from '../components/StatusPill'
import { BookingForm } from '../components/BookingForm'
import { AttachmentsPanel } from '../components/AttachmentsPanel'
import type { BookingRow } from '../lib/types'

/** "Lisbon → Seville" / "LIS - SVQ" / "Airport to Benfica" → two labels; otherwise the title and the address. */
export function routeEnds(b: BookingRow): { from: string; to: string } {
  if (b.fields.from && b.fields.to) return { from: b.fields.from, to: b.fields.to }
  const m = b.title.match(/^(.*?)\s*(?:→|->|—>|\bto\b| - | – )\s*(.+)$/i)
  if (m && m[1].trim() && m[2].trim()) return { from: m[1].trim().replace(/^(AVE|Flight|Train|Taxi|Bolt)\s+/i, ''), to: m[2].trim() }
  return { from: b.title, to: b.address ?? '' }
}

export function TicketDetail() {
  const { trip: tripParam, id } = useParams<{ trip: string; id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { trips, slug, content, loading, setSlug } = useTrip()
  const { state, save, loading: stateLoading } = useBookingState(content?.trip.slug ?? '')

  // A cold load of /ticket/:trip/:id (a bookmark, a shared link, a hard refresh) resolves the
  // ambient trip from ?trip=/localStorage/today, not from this route — so the path segment has
  // to steer the context or the screen shows the wrong city's "No ticket".
  const wrongTrip = !!tripParam && tripParam !== slug && trips.some(t => t.slug === tripParam)
  useEffect(() => {
    if (wrongTrip && tripParam) setSlug(tripParam)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrongTrip, tripParam])

  const loadingLine = <main className="screen"><p className="caption">Loading…</p></main>
  if (loading && !content) return loadingLine
  if (!content) return null
  // The switch above is in flight: the content still belongs to the previous trip.
  if (tripParam && content.trip.slug !== tripParam && trips.some(t => t.slug === tripParam)) return loadingLine
  const booking = content.bookings.find(b => b.id === id && (!tripParam || b.trip === tripParam))
  if (!booking) return <main className="screen"><p className="caption">No ticket {id} in {content.trip.name}.</p><Link to="/tickets" className="btn--text">All tickets</Link></main>

  const kind = inferKind(booking)
  const status = effectiveStatus(booking, state[booking.id])
  // react-router stamps the first entry of a history stack with key 'default'; anything
  // else means there is a real previous screen to go back to (same pattern as Map.tsx).
  const back = () => (location.key !== 'default' ? navigate(-1) : navigate('/tickets', { replace: true }))

  // BookingForm seeds its fields once, at mount. Mounting it before the saved row arrives
  // leaves them blank and Save then writes nulls over the stored ref/cost/notes — so wait for
  // the read, and remount (via the key) if a newer row lands later.
  const bookingForm = stateLoading ? null : (
    <BookingForm key={booking.id} booking={booking} row={state[booking.id]} save={save} />
  )

  if (kind === 'event') {
    const walk = walkLink({ lat: null, lng: null, name: booking.title, address: booking.address }, content.trip.name)
    return (
      <main className="screen">
        <button type="button" className="back" onClick={back}>‹ Back</button>
        <article className="place-detail" aria-label={booking.title}>
          <div className="place-detail__hero place-detail__hero--event">
            <Icon set="kind" name="event" size={64} className="place-detail__glyph" />
            <h1 className="place-detail__title">{booking.title}</h1>
          </div>
          <div className="place-detail__facts">
            {booking.date && <span>{fmtDay(booking.date)}</span>}
            {booking.time && <span>{fmtTime(booking.time, null)}</span>}
            {booking.fields.cost && <span>{booking.fields.cost}</span>}
            <StatusPill status={status} />
          </div>
          {booking.notes && <p className="place-detail__text"><Md text={booking.notes} /></p>}
          {booking.address && <p className="place-detail__address"><Icon set="nav" name="map" size={14} /> {booking.address}</p>}
          <div className="place-detail__actions">
            {walk && <a className="btn--text" href={walk} target="_blank" rel="noopener noreferrer">Walk there</a>}
            {booking.contact && /^[+\d]/.test(booking.contact) && <a className="btn--text" href={`tel:${booking.contact.replace(/(?!^\+)[^\d]/g, '')}`}>Call</a>}
          </div>
          {bookingForm}
          <AttachmentsPanel tripSlug={content.trip.slug} bookingId={booking.id} />
        </article>
      </main>
    )
  }

  const ends = routeEnds(booking)
  const cells = fourCells(booking)
  return (
    <main className="screen">
      <button type="button" className="back" onClick={back}>‹ Back</button>
      <article className={`pass pass--${kind}`} aria-label={booking.title}>
        <section className="pass__route">
          <div className="pass__end"><span className="pass__date">{booking.date ? fmtDay(booking.date) : '—'}</span><span className="pass__time">{fmtTime(booking.time, null)}</span><span className="pass__place">{ends.from}</span></div>
          <div className="pass__mid"><Icon set="kind" name={kindIcon(kind, booking.title)} size={26} className="pass__glyph" /><span className="pass__dots" /></div>
          <div className="pass__end pass__end--to"><span className="pass__date">{kind === 'accommodation' ? 'Check-out' : booking.fields.arrives ? 'Arrives' : ''}</span><span className="pass__time">{kind === 'accommodation' && booking.fields.nights ? `${booking.fields.nights} nights` : booking.fields.arrives ?? ''}</span><span className="pass__place">{ends.to}</span></div>
        </section>
        <section className="pass__body">
          <div className="pass__head">
            <div><span className="pass__label">Booking</span><h1 className="pass__name">{booking.title}</h1></div>
            <div className="pass__right"><span className="pass__label">Ref</span><span className="pass__ref">{state[booking.id]?.confirmation_ref ?? booking.fields.ref ?? booking.id}</span></div>
          </div>
          {cells.length > 0 && (
            <dl className="pass__cells">
              {cells.map(c => <Fragment key={c.key}><div className="pass__cell"><dt>{c.key}</dt><dd>{c.value}</dd></div></Fragment>)}
            </dl>
          )}
          {booking.priority && <p className="caption">Priority: {booking.priority}</p>}
        </section>
        <section className="pass__stub">
          <div className="pass__status"><StatusPill status={status} />{booking.notes && <p className="pass__notes"><Md text={booking.notes} /></p>}{booking.fallback && <p className="pass__notes"><strong>Fallback:</strong> {booking.fallback}</p>}</div>
          {bookingForm}
          <AttachmentsPanel tripSlug={content.trip.slug} bookingId={booking.id} />
        </section>
      </article>
    </main>
  )
}
