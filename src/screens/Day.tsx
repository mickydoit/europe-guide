import { Fragment, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Navigate, Link } from 'react-router-dom'
import { useTrip } from '../lib/trip'
import { useChecks, useDayNotes } from '../lib/state'
import { currentAndNext, currentBlock, dayIndex, fmtDay, nowInTz, todayInTrip } from '../lib/time'
import { TripPicker } from '../components/TripPicker'
import { NowNext } from '../components/NowNext'
import { RouteStrip } from '../components/RouteStrip'
import { StopCard } from '../components/StopCard'
import { WeatherStrip } from '../components/WeatherStrip'
import { Md } from '../components/Md'
import { walkLink } from '../lib/links'
import type { Block, ItemRow } from '../lib/types'

const BLOCK_KEYS: Block[] = ['morning', 'midday', 'evening', null]
const BLOCK_LABEL: Record<string, string> = { morning: 'Morning', midday: 'Midday', evening: 'Evening' }
const NOW_TICK_MS = 30_000
const TICK_ERROR_MS = 4_000

export function Day() {
  const { date: dateParam } = useParams<{ date?: string }>()
  const navigate = useNavigate()
  const { trips, slug, content, loading, error, setSlug, refresh } = useTrip()
  const { done, toggle } = useChecks(content?.trip.slug ?? '')
  // Hooks run before this screen knows which day it is showing, so pass the raw param:
  // useDayNotes skips the query until both halves of the key are real.
  const { savedPlaces, removePlace } = useDayNotes(content?.trip.slug ?? '', dateParam ?? '')
  const [now, setNow] = useState(() => new Date())
  const [tickError, setTickError] = useState<string | null>(null)
  const tickErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), NOW_TICK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => () => { if (tickErrorTimer.current) clearTimeout(tickErrorTimer.current) }, [])

  async function handleToggle(itemId: string) {
    try {
      await toggle(itemId)
    } catch {
      setTickError("Couldn't save — you may be offline")
      if (tickErrorTimer.current) clearTimeout(tickErrorTimer.current)
      tickErrorTimer.current = setTimeout(() => setTickError(null), TICK_ERROR_MS)
    }
  }

  if (loading && !content) {
    return <main className="screen"><p className="caption">Loading…</p></main>
  }
  if (error && !content) {
    return (
      <main className="screen">
        <p className="caption">{error}</p>
        <button type="button" className="btn--text" onClick={() => { void refresh() }}>Retry</button>
      </main>
    )
  }
  if (trips.length === 0) {
    return <main className="screen"><p className="caption">No trips yet. Run the import on your laptop.</p></main>
  }
  if (!content) return null

  const trip = content.trip
  const days = content.days
  const today = todayInTrip(trip, now)
  const resolvedDate = dateParam ?? today ?? days[0]?.date ?? null

  if (!dateParam && resolvedDate) {
    return <Navigate to={`/day/${resolvedDate}`} replace />
  }
  if (!resolvedDate) {
    return <main className="screen"><p className="caption">No days yet.</p></main>
  }

  const date = resolvedDate
  const idx = dayIndex(days, date)
  if (idx < 0 && days.length > 0) {
    const fallback = today ?? days[0].date
    return <Navigate to={`/day/${fallback}`} replace />
  }
  const day = idx >= 0 ? days[idx] : null
  const prevDay = idx > 0 ? days[idx - 1] : null
  const nextDay = idx >= 0 && idx < days.length - 1 ? days[idx + 1] : null

  const dayItems = content.items.filter(i => i.date === date)
  const optionsByParent = new Map<string, ItemRow[]>()
  for (const i of dayItems) {
    if (i.kind === 'option' && i.parent_item) {
      const arr = optionsByParent.get(i.parent_item) ?? []
      arr.push(i)
      optionsByParent.set(i.parent_item, arr)
    }
  }
  const mainItems = dayItems.filter(i => i.kind !== 'option').sort((a, b) => a.sort - b.sort)
  // Groups are ordered by the minimum `sort` of their items (not a fixed block order):
  // mainItems is already sort-ascending, so each group's first item is its minimum.
  const blocks = BLOCK_KEYS
    .map(block => ({ block, items: mainItems.filter(i => i.block === block) }))
    .filter(g => g.items.length > 0)
    .sort((a, b) => a.items[0].sort - b.items[0].sort)

  const dayRoutes = content.routes.filter(r => r.date === date)

  const isToday = date === today
  const nowMinutes = nowInTz(trip.timezone, now).minutes
  const activeBlock = isToday ? currentBlock(nowMinutes) : null
  const { current, next, minutesToNext } = isToday
    ? currentAndNext(content.alerts, date, nowMinutes)
    : { current: null, next: null, minutesToNext: null }

  function goTrip(newSlug: string) {
    setSlug(newSlug)
    navigate('/day')
  }

  return (
    <main className="screen day">
      <TripPicker trips={trips} active={slug} onSelect={goTrip} />

      <div className="day-header">
        <button
          type="button"
          className="day-nav__arrow"
          aria-label="Previous day"
          disabled={!prevDay}
          onClick={() => prevDay && navigate(`/day/${prevDay.date}`)}
        >
          ‹
        </button>
        <div className="day-title-row">
          <h1 className="day-title">
            {fmtDay(date)}
            {day?.title ? ` — ${day.title}` : ''}
          </h1>
          {day?.status === 'locked' && <span className="status-pill status-pill--locked">LOCKED</span>}
          {day?.status === 'locked_except_dinner' && (
            <span className="status-pill status-pill--dinner">LOCKED except dinner</span>
          )}
        </div>
        <button
          type="button"
          className="day-nav__arrow"
          aria-label="Next day"
          disabled={!nextDay}
          onClick={() => nextDay && navigate(`/day/${nextDay.date}`)}
        >
          ›
        </button>
        <Link to={`/map/${date}`} className="btn--text day-header__map">Map</Link>
        {today && !isToday && (
          <button type="button" className="btn--text day-nav__today" onClick={() => navigate(`/day/${today}`)}>
            Today
          </button>
        )}
      </div>

      <WeatherStrip trip={trip} content={content} date={date} />

      {savedPlaces.length > 0 && (
        <section className="saved-places" aria-label="Saved nearby">
          <h2 className="h5 saved-places__heading">Saved nearby</h2>
          <ul className="saved-places__row">
            {savedPlaces.map(p => {
              const href = walkLink({ lat: p.lat, lng: p.lng, name: p.name }, trip.name)
              return (
                <li key={p.id} className="saved-places__chip">
                  <span className="saved-places__name">{p.name}</span>
                  {href && (
                    <a className="btn--text" href={href} target="_blank" rel="noopener noreferrer">Walk there</a>
                  )}
                  <button
                    type="button"
                    className="saved-places__remove"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => { void removePlace(p.id).catch(() => {}) }}
                  >
                    ×
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {isToday && <NowNext current={current} next={next} minutesToNext={minutesToNext} />}

      {tickError && <p className="form__msg form__msg--error">{tickError}</p>}

      {blocks.map((g, gi) => (
        <Fragment key={g.block ?? 'none'}>
          {gi === 0 && <RouteStrip routes={dayRoutes} />}
          <section className={`day-block${isToday && g.block === activeBlock ? ' day-block--current' : ''}`}>
            {g.block && <h2 className="h5 day-block__heading">{BLOCK_LABEL[g.block]}</h2>}
            {g.items.map(item => {
              if (item.kind === 'stop') {
                return (
                  <StopCard
                    key={item.id}
                    item={item}
                    options={optionsByParent.get(item.id) ?? []}
                    tripName={trip.name}
                    done={done.has(item.id)}
                    onToggle={() => { void handleToggle(item.id) }}
                  />
                )
              }
              if (item.kind === 'note') {
                return <p key={item.id} className="note"><Md text={item.plan} /></p>
              }
              if (item.kind === 'route_link') {
                return (
                  <p key={item.id} className="route-link">
                    <a href={item.url ?? undefined} target="_blank" rel="noopener noreferrer">{item.plan}</a>
                    {item.details ? ` — ${item.details}` : ''}
                  </p>
                )
              }
              return null
            })}
          </section>
        </Fragment>
      ))}
    </main>
  )
}
