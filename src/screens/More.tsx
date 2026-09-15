import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BUILD_ID, checkForUpdate } from '../lib/updates'
import { useTrip } from '../lib/trip'
import { useAuth } from '../lib/auth'
import { fmtDay } from '../lib/time'
import { walkLink } from '../lib/links'
import { Md } from '../components/Md'
import { TripPicker } from '../components/TripPicker'
import { OfflineMapCard } from '../components/OfflineMapCard'
import { SyncBadge } from '../components/SyncBadge'
import { useSync, useOutboxOps, flushOutbox } from '../lib/sync'
import type { OutboxOp } from '../lib/outbox'
import { buildIcs, downloadIcs } from '../lib/ics'
import { warmTripAttachments, type WarmResult } from '../lib/attachmentsWarm'

const NOTE_SECTIONS: Array<{ key: 'standing' | 'walkin' | 'routes'; heading: string }> = [
  { key: 'standing', heading: 'Standing notes' },
  { key: 'walkin', heading: 'Walk-in' },
  { key: 'routes', heading: 'Route notes' },
]

// Plain words for what is waiting, in the order the owner is most likely to care about.
const KIND_LABEL: Array<{ kind: OutboxOp['kind']; one: string; many: string }> = [
  { kind: 'check_set', one: 'check', many: 'checks' },
  { kind: 'booking_state', one: 'booking update', many: 'booking updates' },
  { kind: 'day_notes', one: 'note', many: 'notes' },
  { kind: 'attachment_upload', one: 'upload', many: 'uploads' },
]

function summarise(ops: Array<{ kind: string }>): string {
  return KIND_LABEL
    .map(({ kind, one, many }) => ({ n: ops.filter(o => o.kind === kind).length, one, many }))
    .filter(c => c.n > 0)
    .map(c => `${c.n} ${c.n === 1 ? c.one : c.many}`)
    .join(' · ')
}

export function More() {
  const { trips, slug, content, loading, offline, error, setSlug, refresh } = useTrip()
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const { session, signOut } = useAuth()
  const { pending, failed, lastError, retryFailed } = useSync()
  const ops = useOutboxOps()
  const [tickets, setTickets] = useState<WarmResult | null>(null)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const warmSlug = content?.trip.slug ?? null

  // "Offline — will sync when connected" is only true until it isn't: drop it the moment
  // the phone says it has signal, rather than leaving a stale excuse on screen.
  useEffect(() => {
    const clear = () => setSyncMsg(null)
    window.addEventListener('online', clear)
    return () => { window.removeEventListener('online', clear) }
  }, [])

  // Put every ticket in the trip on the phone, not just the ones whose booking sheet has
  // been opened. Once per trip per session; nothing on screen waits for it.
  useEffect(() => {
    if (!warmSlug) return
    let alive = true
    void warmTripAttachments(warmSlug)
      .then(r => { if (alive && r.total > 0) setTickets(r) })
      .catch(() => {})
    return () => { alive = false }
  }, [warmSlug])

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
      <div className="more-header">
        <h1 className="h5">More</h1>
        <SyncBadge />
      </div>
      {error && <p className="form__msg form__msg--error">{error}</p>}

      {pending + failed > 0 && (
        <section className="more-section">
          <h2 className="h5 more-section__heading">Pending changes</h2>
          <p className="caption">{summarise(ops) || `${pending + failed} waiting`}</p>
          {failed > 0 && (
            <p className="caption">
              {failed} could not be sent{lastError ? ` — ${lastError}` : ''}
            </p>
          )}
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              // Saying "syncing…" at a phone with no bars is a lie the owner can see through.
              if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                setSyncMsg('Offline — will sync when connected')
                return
              }
              setSyncMsg(null)
              // An unhandled rejection here would take the screen down over a failed flush.
              void flushOutbox().catch(() => setSyncMsg('Could not sync — try again in a moment'))
            }}
          >
            Sync now
          </button>
          {syncMsg && <p className="caption">{syncMsg}</p>}
          {failed > 0 && (
            <button type="button" className="btn btn--secondary" onClick={() => { void retryFailed() }}>
              Retry failed
            </button>
          )}
        </section>
      )}

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
        <button type="button" className="btn btn--secondary" disabled={loading} onClick={() => { void refresh() }}>
          {loading ? 'Refreshing…' : 'Refresh data'}
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
        {tickets && <p className="caption">Tickets saved for offline: {tickets.cached} of {tickets.total}</p>}
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
        <p className="caption more-version">Version {BUILD_ID}</p>
        <button type="button" className="btn btn--text" onClick={() => {
          setUpdateMsg('Checking…')
          void checkForUpdate().then(r => setUpdateMsg(r === 'updated' ? 'Update found — reloading…' : r === 'current' ? 'You have the latest version' : 'Updates unavailable in this browser'))
            .catch(() => setUpdateMsg('Could not check — are you online?'))
        }}>Check for updates</button>
        {updateMsg && <p className="caption">{updateMsg}</p>}
      </section>
    </main>
  )
}
