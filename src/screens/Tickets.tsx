import { useState } from 'react'
import { useTrip } from '../lib/trip'
import { useBookingState } from '../lib/state'
import { fmtDay, nowInTz, todayInTrip } from '../lib/time'
import { countriesOf, cycleStatus, effectiveStatus, groupByDate, inferKind } from '../lib/tickets'
import { TicketCard } from '../components/TicketCard'
import { SyncBadge } from '../components/SyncBadge'
import { Icon } from '../components/Icon'

const COUNTRY_ICON: Record<string, string> = { tr: 'plane', pt: 'car', es: 'hotel', eg: 'event' }

export function Tickets() {
  const { trips, slug, content, loading, error, setSlug, refresh } = useTrip()
  const { state, save } = useBookingState(content?.trip.slug ?? '')
  const [showEarlier, setShowEarlier] = useState(false)

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
  const countries = countriesOf(trips)
  const activeCountry = countries.find(c => c.trips.some(t => t.slug === slug)) ?? countries[0]
  const today = todayInTrip(trip) ?? nowInTz(trip.timezone).date
  const groups = groupByDate(content.bookings)
  const earlier = groups.filter(g => g.date && g.date < today)
  const current = groups.filter(g => !g.date || g.date >= today)

  const cycle = (id: string) => {
    const b = content.bookings.find(x => x.id === id)!
    void save(id, { status: cycleStatus(effectiveStatus(b, state[id])) }).catch(() => {})
  }

  const renderGroup = (g: { date: string | null; bookings: typeof content.bookings }) => (
    <section key={g.date ?? 'undated'} className="tickets-day">
      <h2 className="tickets-day__heading">{g.date ? fmtDay(g.date) : 'Undated'}</h2>
      <ul className="tickets-list">
        {g.bookings.map(b => {
          const past = !!g.date && g.date < today
          return (
            <li key={b.id}>
              <TicketCard booking={b} kind={inferKind(b)} status={effectiveStatus(b, state[b.id])} tone={past ? 'past' : undefined}
                to={`/ticket/${trip.slug}/${b.id}`} onCycleStatus={() => cycle(b.id)} />
            </li>
          )
        })}
      </ul>
    </section>
  )

  return (
    <main className="screen tickets">
      <header className="tickets-header">
        <h1 className="h5">Tickets</h1>
        <SyncBadge />
      </header>

      <div className="seg" role="tablist" aria-label="Country">
        {countries.map(c => (
          <button key={c.country} type="button" role="tab" aria-selected={c === activeCountry}
            className={`seg__tab${c === activeCountry ? ' seg__tab--active' : ''}`}
            onClick={() => { if (c !== activeCountry) setSlug(c.trips[0].slug) }}>
            <Icon set="kind" name={COUNTRY_ICON[c.code?.toLowerCase()] ?? 'event'} size={18} />
            {c.country}
          </button>
        ))}
      </div>

      {activeCountry.trips.length > 1 && (
        <div className="chips" role="tablist" aria-label="City">
          {activeCountry.trips.map(t => (
            <button key={t.slug} type="button" role="tab" aria-selected={t.slug === slug}
              className={`chips__chip${t.slug === slug ? ' chips__chip--active' : ''}`} onClick={() => setSlug(t.slug)}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {earlier.length > 0 && !showEarlier && (
        <button type="button" className="tickets-earlier" onClick={() => setShowEarlier(true)}>
          {earlier.length} earlier {earlier.length === 1 ? 'day' : 'days'}
        </button>
      )}
      {showEarlier && earlier.map(renderGroup)}
      {current.length === 0 && earlier.length === 0 && <p className="caption">No tickets for {trip.name}.</p>}
      {current.map(renderGroup)}
    </main>
  )
}
