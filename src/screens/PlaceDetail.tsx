import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTrip } from '../lib/trip'
import { useChecks, QUEUED_COPY } from '../lib/state'
import { fmtDay, fmtTime } from '../lib/time'
import { bookingForStop } from '../lib/tickets'
import { routeLink, walkLink } from '../lib/links'
import { nextWalk, routeFor, walkMetric } from '../lib/walks'
import { Icon } from '../components/Icon'
import { Md } from '../components/Md'
import { PlaceHero } from '../components/PlaceHero'

const DURATION_RE = /(\d+(?:[.,]\d+)?)\s*(?:h(?:ours?|rs?)?|min(?:utes?|s)?)\b/i
const TICK_MSG_MS = 4000

export function PlaceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { content, loading } = useTrip()
  const { done, toggle } = useChecks(content?.trip.slug ?? '')
  const [msg, setMsg] = useState<{ text: string; tone: 'error' | 'queued' } | null>(null)
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (msgTimer.current) clearTimeout(msgTimer.current) }, [])

  // Same contract as Day: a tick that could not be written must say so, and a queued one must
  // say it is queued, rather than looking like a save that went through.
  function flash(text: string, tone: 'error' | 'queued') {
    setMsg({ text, tone })
    if (msgTimer.current) clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => setMsg(null), TICK_MSG_MS)
  }

  async function handleToggle(itemId: string) {
    try {
      const result = await toggle(itemId)
      if (result?.queued) flash(QUEUED_COPY, 'queued')
    } catch {
      flash("Couldn't save — you may be offline", 'error')
    }
  }

  if (loading && !content) return <main className="screen"><p className="caption">Loading…</p></main>
  if (!content) return null
  const item = content.items.find(i => i.id === id)
  if (!item) return <main className="screen"><p className="caption">No stop {id}.</p><Link to="/day" className="btn--text">Day</Link></main>

  const name = item.place_name ?? item.plan.replace(/\*\*/g, '')
  const options = content.items.filter(o => o.kind === 'option' && o.parent_item === item.id).sort((a, b) => a.sort - b.sort)
  const walk = walkLink({ lat: item.lat, lng: item.lng, name: item.place_name, address: item.address }, content.trip.name)
  const booking = bookingForStop(content.bookings, item)
  const duration = item.details?.match(DURATION_RE)?.[0] ?? null
  const when = fmtTime(item.time, item.time_text)
  const meta = [when !== '—' ? when : null, duration].filter(Boolean).join(' · ') || null
  const isDone = done.has(item.id)
  const walkNext = nextWalk(content, item)
  const route = routeFor(content, item)

  return (
    <main className="screen">
      <button type="button" className="back" onClick={() => (location.key !== 'default' ? navigate(-1) : navigate(`/day/${item.date}`, { replace: true }))}>‹ Back</button>
      <article className="place-detail" aria-label={name}>
        <PlaceHero photoPath={item.photo_path} credit={item.photo_credit} title={name} description={item.details} meta={meta} />
        <div className="place-detail__facts">
          <span>{fmtDay(item.date)}</span>
          <button type="button" className={`tick${isDone ? ' tick--done' : ''}`} aria-label={isDone ? 'Mark not done' : 'Mark done'} onClick={() => { void handleToggle(item.id) }}>✓</button>
        </div>
        {msg && <p className={`form__msg form__msg--${msg.tone}`}>{msg.text}</p>}
        {item.plan && item.place_name && <p className="place-detail__plan"><Md text={item.plan} /></p>}
        {item.address && <p className="place-detail__address"><Icon set="nav" name="map" size={14} /> {item.address}</p>}
        <div className="place-detail__actions">
          {walk && <a className="btn--text" href={walk} target="_blank" rel="noopener noreferrer">Walk there</a>}
          {booking && <Link className="btn--text" to={`/ticket/${content.trip.slug}/${booking.id}?trip=${content.trip.slug}`}>Open ticket</Link>}
        </div>
        {(walkNext || route) && (
          <section className="place-walks" aria-label="Walking">
            {walkNext && (
              <a className="place-walks__next" href={walkNext.href} target="_blank" rel="noopener noreferrer">
                <span className="place-walks__label">Walk to {walkNext.to}</span>
                {walkMetric(walkNext) && <span className="place-walks__metric">{walkMetric(walkNext)}</span>}
              </a>
            )}
            {route && (
              <p className="place-walks__route">
                Part of <strong>{route.title}</strong>{route.distance_text ? ` · ${route.distance_text}` : ''}
                {' '}<a className="btn--text" href={routeLink(route)} target="_blank" rel="noopener noreferrer">Open route</a>
              </p>
            )}
          </section>
        )}
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
