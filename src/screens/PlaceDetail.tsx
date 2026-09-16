import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTrip } from '../lib/trip'
import { useChecks } from '../lib/state'
import { fmtDay, fmtTime } from '../lib/time'
import { bookingForStop } from '../lib/tickets'
import { walkLink } from '../lib/links'
import { Icon } from '../components/Icon'
import { Md } from '../components/Md'

const DURATION_RE = /(\d+(?:[.,]\d+)?)\s*(?:h(?:ours?|rs?)?|min(?:utes?|s)?)\b/i

export function PlaceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { content, loading } = useTrip()
  const { done, toggle } = useChecks(content?.trip.slug ?? '')

  if (loading && !content) return <main className="screen"><p className="caption">Loading…</p></main>
  if (!content) return null
  const item = content.items.find(i => i.id === id)
  if (!item) return <main className="screen"><p className="caption">No stop {id}.</p><Link to="/day" className="btn--text">Day</Link></main>

  const name = item.place_name ?? item.plan.replace(/\*\*/g, '')
  const options = content.items.filter(o => o.kind === 'option' && o.parent_item === item.id).sort((a, b) => a.sort - b.sort)
  const walk = walkLink({ lat: item.lat, lng: item.lng, name: item.place_name, address: item.address }, content.trip.name)
  const booking = bookingForStop(content.bookings, item)
  const duration = item.details?.match(DURATION_RE)?.[0] ?? null
  const isDone = done.has(item.id)

  return (
    <main className="screen">
      <button type="button" className="back" onClick={() => (history.length > 1 ? navigate(-1) : navigate(`/day/${item.date}`))}>‹ Back</button>
      <article className="place-detail" aria-label={name}>
        <div className="place-detail__hero">
          <Icon set="kind" name="event" size={64} className="place-detail__glyph" />
          <h1 className="place-detail__title">{name}</h1>
        </div>
        <div className="place-detail__facts">
          <span>{fmtDay(item.date)}</span>
          <span>{fmtTime(item.time, item.time_text)}</span>
          {duration && <span>{duration}</span>}
          <button type="button" className={`tick${isDone ? ' tick--done' : ''}`} aria-label={isDone ? 'Mark not done' : 'Mark done'} onClick={() => { void toggle(item.id).catch(() => {}) }}>✓</button>
        </div>
        {item.plan && item.place_name && <p className="place-detail__plan"><Md text={item.plan} /></p>}
        {item.details && <p className="place-detail__text"><Md text={item.details} /></p>}
        {item.address && <p className="place-detail__address"><Icon set="nav" name="map" size={14} /> {item.address}</p>}
        <div className="place-detail__actions">
          {walk && <a className="btn--text" href={walk} target="_blank" rel="noopener noreferrer">Walk there</a>}
          {booking && <Link className="btn--text" to={`/ticket/${content.trip.slug}/${booking.id}`}>Open ticket</Link>}
        </div>
        {options.length > 0 && (
          <section className="place-detail__options">
            <h2 className="h5">Pick one</h2>
            <ul className="option-list">
              {options.map(o => {
                const ow = walkLink({ lat: o.lat, lng: o.lng, name: o.place_name, address: o.address }, content.trip.name)
                return (
                  <li key={o.id} className="option-card">
                    <p className="option-card__name"><Md text={o.place_name ?? o.plan} /></p>
                    {o.details && <p className="option-card__details"><Md text={o.details} /></p>}
                    {ow && <a className="btn--text" href={ow} target="_blank" rel="noopener noreferrer">Walk there</a>}
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </article>
    </main>
  )
}
