import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { cityDot } from '../lib/home'
import { cityCentre, getCurrent } from '../lib/weather'
import type { Current } from '../lib/weather'
import { conditionEmoji } from './WeatherStrip'
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
  const key = import.meta.env.VITE_GOOGLE_BROWSER_KEY as string | undefined
  const centre = cityCentre(content, date) ?? centreFor(trip)

  const [current, setCurrent] = useState<Current | null>(null)
  const [iconFailed, setIconFailed] = useState(false)

  useEffect(() => {
    if (!key || !centre) return
    let cancelled = false
    void (async () => {
      try {
        const c = await getCurrent(trip, centre.lat, centre.lng, key)
        if (!cancelled) setCurrent(c)
      } catch {
        // No network and nothing cached: the overlay simply stays quiet.
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.slug, centre?.lat, centre?.lng, key])

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
        {current && (
          <div className="world-hero__weather">
            {current.iconUri && !iconFailed ? (
              <img
                className="world-hero__weather-icon"
                src={`${current.iconUri}.svg`}
                alt=""
                width={24}
                height={24}
                onError={() => setIconFailed(true)}
              />
            ) : (
              <span className="world-hero__weather-icon" aria-hidden="true">
                {conditionEmoji(current.condition)}
              </span>
            )}
            <span className="world-hero__temp">{Math.round(current.temp)}°</span>
            <span className="world-hero__condition">{current.condition}</span>
          </div>
        )}
        <Link to="/map" className="world-hero__open">Open map</Link>
      </div>
    </div>
  )
}
