import { useEffect, useRef, useState } from 'react'
import { useTrip } from '../lib/trip'
import { useBookingState } from '../lib/state'
import { fmtDay, nowInTz, todayInTrip } from '../lib/time'
import { openReminders } from '../lib/home'
import { cycleStatus, effectiveStatus, inferKind, nextTicket, stopsForCards, ticketsForDay } from '../lib/tickets'
import { OWNER_NAME } from '../lib/config'
import { SyncBadge } from '../components/SyncBadge'
import { WorldHero } from '../components/WorldHero'
import { WeatherStrip } from '../components/WeatherStrip'
import { NextUpCard } from '../components/NextUpCard'
import { TicketCard } from '../components/TicketCard'
import { PlaceCard } from '../components/PlaceCard'
import { ReminderChips } from '../components/ReminderChips'
import { warmTripAttachments } from '../lib/attachmentsWarm'

const NOW_TICK_MS = 30_000

export function Home() {
  const { trips, content, loading, error, refresh, setSlug } = useTrip()
  const { state, save } = useBookingState(content?.trip.slug ?? '')
  const [now, setNow] = useState(() => new Date())
  const warmSlug = content?.trip.slug ?? null

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), NOW_TICK_MS)
    return () => clearInterval(id)
  }, [])

  // Home is the screen the owner opens over breakfast, on hotel wifi — the best moment to
  // get the day's tickets onto the phone. Once per trip per session, shared with More.
  useEffect(() => {
    if (!warmSlug) return
    void warmTripAttachments(warmSlug).catch(() => {})
  }, [warmSlug])

  // The owner wakes up in the next city: the ambient trip is still whichever one they last
  // looked at (localStorage), and nothing else on Home would move them across. Once per mount.
  const switchedTrip = useRef(false)
  useEffect(() => {
    if (switchedTrip.current || !content) return
    if (todayInTrip(content.trip, now) !== null) return
    const match = trips.find(t => t.slug !== content.trip.slug && todayInTrip(t, now) !== null)
    if (!match) return
    switchedTrip.current = true
    setSlug(match.slug)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, trips, now])

  if (loading && !content) return <main className="screen"><p className="caption">Loading…</p></main>
  if (error && !content) {
    return (
      <main className="screen">
        <p className="caption">{error}</p>
        <button type="button" className="btn--text" onClick={() => { void refresh() }}>Retry</button>
      </main>
    )
  }
  if (trips.length === 0) return <main className="screen"><p className="caption">No trips yet. Run the import on your laptop.</p></main>
  if (!content) return null

  const trip = content.trip
  const { date: todayISO, minutes, hhmm } = nowInTz(trip.timezone, now)
  const today = todayInTrip(trip, now)
  const date = today ?? content.days[0]?.date ?? todayISO

  const next = nextTicket(content, date, today ? minutes : 0)
  const restToday = ticketsForDay(content.bookings, date).filter(b => b.id !== next?.booking.id)
  const stops = stopsForCards(content, date)
  const reminders = openReminders(content.bookings, state, todayISO).map(r => ({ id: r.booking.id, label: r.label, overdue: r.overdue }))

  const cycle = (id: string) => {
    const b = content.bookings.find(x => x.id === id)!
    void save(id, { status: cycleStatus(effectiveStatus(b, state[id])) }).catch(() => {})
  }

  return (
    <main className="screen home">
      <header className="home-header">
        <div className="home-header__text">
          <h1 className="home-header__title">Hello...{OWNER_NAME ? ` ${OWNER_NAME}` : ''}</h1>
          <p className="home-header__date">{fmtDay(todayISO)} · {hhmm}</p>
          {!today && <p className="caption home-header__caption">Plans for {fmtDay(date)}</p>}
        </div>
        <SyncBadge />
      </header>

      <WeatherStrip trip={trip} content={content} date={date} variant="hero" />

      <WorldHero trips={trips} trip={trip} content={content} date={date} />

      {next && (
        <NextUpCard booking={next.booking} kind={inferKind(next.booking)} date={next.date} to={`/ticket/${trip.slug}/${next.booking.id}?trip=${trip.slug}`} />
      )}

      <section className="home-row">
        <h2 className="h5 home-row__heading">Tickets</h2>
        {restToday.length === 0 ? <p className="caption home-row__empty">No more tickets today</p> : (
          <ul className="card-row card-row--tickets">
            {restToday.map(b => (
              <li key={b.id}>
                <TicketCard booking={b} kind={inferKind(b)} status={effectiveStatus(b, state[b.id])} to={`/ticket/${trip.slug}/${b.id}?trip=${trip.slug}`} onCycleStatus={() => cycle(b.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {stops.length > 0 && (
        <section className="home-row">
          <h2 className="h5 home-row__heading">Tours and events</h2>
          <ul className="card-row">
            {stops.map(s => <li key={s.id}><PlaceCard item={s} to={`/place/${encodeURIComponent(s.id)}?trip=${trip.slug}`} /></li>)}
          </ul>
        </section>
      )}

      <ReminderChips reminders={reminders} />
    </main>
  )
}
