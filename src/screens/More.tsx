import { Link } from 'react-router-dom'
import { useTrip } from '../lib/trip'
import { useAuth } from '../lib/auth'
import { fmtDay } from '../lib/time'
import { walkLink } from '../lib/links'
import { Md } from '../components/Md'
import { TripPicker } from '../components/TripPicker'
import { OfflineMapCard } from '../components/OfflineMapCard'
import { buildIcs, downloadIcs } from '../lib/ics'

const NOTE_SECTIONS: Array<{ key: 'standing' | 'walkin' | 'routes'; heading: string }> = [
  { key: 'standing', heading: 'Standing notes' },
  { key: 'walkin', heading: 'Walk-in' },
  { key: 'routes', heading: 'Route notes' },
]

export function More() {
  const { trips, slug, content, loading, offline, error, setSlug, refresh } = useTrip()
  const { session, signOut } = useAuth()

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

  return (
    <main className="screen more">
      <h1 className="h5">More</h1>
      {error && <p className="form__msg form__msg--error">{error}</p>}

      <section className="more-section">
        <h2 className="h5 more-section__heading">Trip</h2>
        <p className="more-trip__name">{trip.name}</p>
        <p className="caption">{fmtDay(trip.start_date)} → {fmtDay(trip.end_date)}</p>
        {trip.base && <p className="caption">{trip.base}</p>}
        {trip.intro && <p className="more-trip__intro"><Md text={trip.intro} /></p>}
        {trips.length > 1 && <TripPicker trips={trips} active={slug} onSelect={setSlug} />}
      </section>

      {content.parked.length > 0 && (
        <section className="more-section">
          <h2 className="h5 more-section__heading">Parked venues</h2>
          {content.parked.map(p => {
            const link = walkLink({ lat: p.lat, lng: p.lng, name: p.name, address: p.address }, trip.name)
            return (
              <div key={p.seq} className="parked-card">
                <p className="parked-card__name">{p.name}</p>
                {p.what && <p className="parked-card__what">{p.what}</p>}
                {p.why && <p className="parked-card__why">{p.why}</p>}
                {link && (
                  <a className="parked-card__link" href={link} target="_blank" rel="noopener noreferrer">
                    Walk there
                  </a>
                )}
              </div>
            )
          })}
        </section>
      )}

      {NOTE_SECTIONS.map(({ key, heading }) => {
        const notes = content.notes.filter(n => n.section === key)
        if (notes.length === 0) return null
        return (
          <section key={key} className="more-section">
            <h2 className="h5 more-section__heading">{heading}</h2>
            {notes.map(n => (
              <p key={n.seq} className="more-note"><Md text={n.text} /></p>
            ))}
          </section>
        )
      })}

      <section className="more-section">
        <h2 className="h5 more-section__heading">Tools</h2>
        <Link className="btn--text more-tools__link" to="/routes">All walking routes</Link>
        <button type="button" className="btn btn--secondary" onClick={() => { void refresh() }}>
          Refresh data
        </button>
        {offline && <p className="caption">Offline — showing saved data</p>}
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => downloadIcs(`europe-2026-${trip.slug}.ics`, buildIcs(trip, content.alerts))}
        >
          Export {trip.name} calendar (.ics)
        </button>
        <p className="caption">{"Opens in Calendar on iPhone. Add all events to a new 'Europe 2026' calendar so you can hide it later."}</p>
        {content.areas.length > 0
          ? <OfflineMapCard trip={content.trip.slug} areas={content.areas} />
          : <p className="caption">No offline map for this city yet</p>}
      </section>

      <section className="more-section">
        <h2 className="h5 more-section__heading">Account</h2>
        <p className="caption">{session?.user.email}</p>
        <button type="button" className="btn btn--secondary" onClick={() => { void signOut() }}>
          Sign out
        </button>
      </section>
    </main>
  )
}
