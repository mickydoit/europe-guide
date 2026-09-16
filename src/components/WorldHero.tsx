import { Link } from 'react-router-dom'
import { cityDot } from '../lib/home'
import { cityCentre } from '../lib/weather'
import type { CityContent, TripRow } from '../lib/types'

/**
 * Where to put a trip's dot when its own content carries no coordinates (every trip but
 * the active one: only the open trip's content is loaded). One capital per country the
 * guide covers; an unknown country simply gets no dot.
 */
const CAPITALS: Record<string, { lat: number; lng: number }> = {
  pt: { lat: 38.72, lng: -9.14 },   // Lisbon
  tr: { lat: 41.01, lng: 28.98 },   // Istanbul
  es: { lat: 40.42, lng: -3.70 },   // Madrid
  eg: { lat: 30.04, lng: 31.24 },   // Cairo
  it: { lat: 41.90, lng: 12.50 },   // Rome
}

function centreFor(trip: TripRow): { lat: number; lng: number } | null {
  return CAPITALS[trip.country_code?.toLowerCase() ?? ''] ?? null
}

export function WorldHero({ trips, trip, content, date }: {
  trips: TripRow[]
  trip: TripRow
  content: CityContent
  date: string
}) {
  const centre = cityCentre(content, date) ?? centreFor(trip)

  const dots = trips
    .map(t => {
      const c = t.slug === trip.slug ? centre : centreFor(t)
      return c ? { slug: t.slug, active: t.slug === trip.slug, ...cityDot(c.lat, c.lng) } : null
    })
    .filter((d): d is { slug: string; active: boolean; x: number; y: number } => d != null)

  return (
    <div className="world-hero">
      <img
        className="world-hero__map"
        data-testid="world-hero-map"
        src={`${import.meta.env.BASE_URL}home/world.png`}
        alt=""
      />
      {dots.map(d => (
        <span
          key={d.slug}
          className={`world-hero__dot${d.active ? ' world-hero__dot--active' : ''}`}
          style={{ left: `${d.x * 100}%`, top: `${d.y * 100}%` }}
        />
      ))}
      <div className="world-hero__overlay">
        <Link to="/map" className="world-hero__open">Open map</Link>
      </div>
    </div>
  )
}
