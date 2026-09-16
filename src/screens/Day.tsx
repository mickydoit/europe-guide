import { Fragment, useEffect, useRef, useState } from 'react'
import { useParams, Navigate, Link } from 'react-router-dom'
import { useTrip } from '../lib/trip'
import { useChecks, useDayNotes, QUEUED_COPY } from '../lib/state'
import { currentAndNext, currentBlock, dayIndex, fmtDay, nowInTz, todayInTrip } from '../lib/time'
import { DayStrip } from '../components/DayStrip'
import { NowNext } from '../components/NowNext'
import { StopRow } from '../components/StopRow'
import { Md } from '../components/Md'
import { SyncBadge } from '../components/SyncBadge'
import { walkLink } from '../lib/links'
import { bookingForStop } from '../lib/tickets'
import type { Block } from '../lib/types'

const BLOCK_KEYS: Block[] = ['morning', 'midday', 'evening', null]
const BLOCK_LABEL: Record<string, string> = { morning: 'Morning', midday: 'Midday', evening: 'Evening' }
const NOW_TICK_MS = 30_000
const TICK_MSG_MS = 4_000

export function Day() {
  const { date: dateParam } = useParams<{ date?: string }>()
  const { trips, content, loading, error, refresh } = useTrip()
  const { done, toggle } = useChecks(content?.trip.slug ?? '')
  // Hooks run before this screen knows which day it is showing, so pass the raw param:
  // useDayNotes skips the query until both halves of the key are real.
  const { savedPlaces, loading: notesLoading, removePlace } = useDayNotes(content?.trip.slug ?? '', dateParam ?? '')
  const [now, setNow] = useState(() => new Date())
  const [tickMsg, setTickMsg] = useState<{ text: string; tone: 'error' | 'queued' } | null>(null)
  const tickMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), NOW_TICK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => () => { if (tickMsgTimer.current) clearTimeout(tickMsgTimer.current) }, [])

  function flashTick(text: string, tone: 'error' | 'queued') {
    setTickMsg({ text, tone })
    if (tickMsgTimer.current) clearTimeout(tickMsgTimer.current)
    tickMsgTimer.current = setTimeout(() => setTickMsg(null), TICK_MSG_MS)
  }

  async function handleRemovePlace(id: string) {
    try {
      const result = await removePlace(id)
      if (result?.queued) flashTick(QUEUED_COPY, 'queued')
    } catch {
      flashTick("Couldn't save — you may be offline", 'error')
    }
  }

  async function handleToggle(itemId: string) {
    try {
      // Queued is not a failure: the tick is already on screen and the outbox owns the rest.
      const result = await toggle(itemId)
      if (result?.queued) flashTick(QUEUED_COPY, 'queued')
    } catch {
      flashTick("Couldn't save — you may be offline", 'error')
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

  const dayItems = content.items.filter(i => i.date === date)
  const mainItems = dayItems.filter(i => i.kind !== 'option').sort((a, b) => a.sort - b.sort)
  // Groups are ordered by the minimum `sort` of their items (not a fixed block order):
  // mainItems is already sort-ascending, so each group's first item is its minimum.
  const blocks = BLOCK_KEYS
    .map(block => ({ block, items: mainItems.filter(i => i.block === block) }))
    .filter(g => g.items.length > 0)
    .sort((a, b) => a.items[0].sort - b.items[0].sort)

  const isToday = date === today
  const nowMinutes = nowInTz(trip.timezone, now).minutes
  const activeBlock = isToday ? currentBlock(nowMinutes) : null
  const { current, next, minutesToNext } = isToday
    ? currentAndNext(content.alerts, date, nowMinutes)
    : { current: null, next: null, minutesToNext: null }

  return (
    <main className="screen day">
      <DayStrip days={days} selected={date} today={today} />

      <div className="day-header">
        <div className="day-title-row">
          <h1 className="day-title">
            <span className="day-title__date">{fmtDay(date)}</span>
            {day?.title && <span className="day-title__name">{day.title}</span>}
          </h1>
          {day?.status === 'locked' && <span className="status-pill status-pill--locked">LOCKED</span>}
          {day?.status === 'locked_except_dinner' && (
            <span className="status-pill status-pill--dinner">LOCKED except dinner</span>
          )}
        </div>
        <SyncBadge />
        <Link to={`/map/${date}`} className="btn--text day-header__map">Map</Link>
      </div>

      {!notesLoading && savedPlaces.length > 0 && (
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
                    onClick={() => { void handleRemovePlace(p.id) }}
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

      {tickMsg && <p className={`form__msg form__msg--${tickMsg.tone}`}>{tickMsg.text}</p>}

      {blocks.map(g => (
        <Fragment key={g.block ?? 'none'}>
          <section className={`day-block${isToday && g.block === activeBlock ? ' day-block--current' : ''}`}>
            {g.block && <h2 className="h5 day-block__heading">{BLOCK_LABEL[g.block]}</h2>}
            {g.items.map(item => {
              if (item.kind === 'stop') {
                return (
                  <StopRow key={item.id} item={item} tripSlug={trip.slug} booking={bookingForStop(content.bookings, item)} done={done.has(item.id)} onToggle={() => { void handleToggle(item.id) }} />
                )
              }
              if (item.kind === 'note') {
                return <p key={item.id} className="note"><Md text={item.plan} /></p>
              }
              // route_link items are not shown here: the walk lives on each stop's own screen.
              return null
            })}
          </section>
        </Fragment>
      ))}
    </main>
  )
}
