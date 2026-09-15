import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrip } from '../lib/trip'
import { useBookingState } from '../lib/state'
import { fmtDay, fmtTime, nowInTz, todayInTrip } from '../lib/time'
import { currentBlockOptions, legsToday, openReminders, toursToday, tripCountdowns } from '../lib/home'
import { legLink } from '../lib/links'
import { TripPicker } from '../components/TripPicker'
import { SyncBadge } from '../components/SyncBadge'
import { WorldHero } from '../components/WorldHero'
import { OptionsCard } from '../components/OptionsCard'
import { TileRow } from '../components/TileRow'
import type { Tile, TileTone } from '../components/TileRow'
import { ReminderChips } from '../components/ReminderChips'

const NOW_TICK_MS = 30_000
const TOUR_TONES: TileTone[] = ['granny', 'golden']
const TRIP_TONES: TileTone[] = ['salmon', 'columbia', 'banana']
const WALK_TONES: TileTone[] = ['columbia', 'coral', 'golden']
const STATUS_WORD: Record<string, string> = { upcoming: 'Upcoming', live: 'On now', done: 'Done' }

/** The first line of a booking's notes, falling back to its address — one caption's worth. */
function tourSub(notes: string | null, address: string | null): string | null {
  const first = notes?.split('\n').map(s => s.trim()).find(Boolean)
  return first ?? address ?? null
}

export function Home() {
  const navigate = useNavigate()
  const { trips, slug, content, loading, error, setSlug, refresh } = useTrip()
  const { state } = useBookingState(content?.trip.slug ?? '')
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), NOW_TICK_MS)
    return () => clearInterval(id)
  }, [])

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
  const { date: todayISO, minutes, hhmm } = nowInTz(trip.timezone, now)
  const today = todayInTrip(trip, now)
  // Outside the trip window there is no "today" to show: fall back to its opening day so
  // the rows still have something real in them, and say so under the header.
  const date = today ?? content.days[0]?.date ?? todayISO

  const { heading, options } = currentBlockOptions(content, date, minutes)

  const tourTiles: Tile[] = toursToday(content, date, minutes).map((t, i) => ({
    id: t.booking.id,
    title: t.booking.title,
    tone: TOUR_TONES[i % TOUR_TONES.length],
    fill: 'solid',
    progress: t.progress,
    meta: `${fmtTime(t.booking.time, null)} · ${STATUS_WORD[t.status]}`,
    sub: tourSub(t.booking.notes, t.booking.address),
  }))

  const tripTiles: Tile[] = tripCountdowns(trips, todayISO).map((c, i) => ({
    id: c.slug,
    title: c.name,
    tone: c.slug === slug ? 'accent' : TRIP_TONES[i % TRIP_TONES.length],
    fill: 'dark',
    meta: c.label,
    onSelect: () => { setSlug(c.slug); navigate('/day') },
  }))

  const walkTiles: Tile[] = legsToday(content, date).map((l, i) => ({
    id: `${l.leg.route_id}-${l.leg.seq}`,
    title: l.routeTitle,
    tone: WALK_TONES[i % WALK_TONES.length],
    fill: 'solid',
    meta: l.metric,
    sub: `${l.leg.from_name} → ${l.leg.to_name}`,
    href: legLink(l.leg),
  }))

  const reminders = openReminders(content.bookings, state, todayISO)
    .map(r => ({ id: r.booking.id, label: r.label, overdue: r.overdue }))

  return (
    <main className="screen home">
      <header className="home-header">
        <h1 className="home-header__title">{fmtDay(todayISO)} · {hhmm}</h1>
        <SyncBadge />
      </header>
      {!today && <p className="caption home-header__caption">Plans for {fmtDay(date)}</p>}

      <div className="home-trips">
        <TripPicker trips={trips} active={slug} onSelect={setSlug} labelFor={t => t.country || t.name} />
      </div>

      <WorldHero trips={trips} trip={trip} content={content} date={date} />

      <OptionsCard heading={heading} options={options} date={date} tripName={trip.name} />

      <TileRow heading="Tours" variant="wide" tiles={tourTiles} empty="No tours today" />
      <TileRow heading="Itineraries" variant="square" tiles={tripTiles} empty="No trips yet" />
      <TileRow heading="Walking routes" variant="square" tiles={walkTiles} empty="No walks planned today" />
      <ReminderChips reminders={reminders} />
    </main>
  )
}
