import type { CityContent } from './types'
import { legLink, walkLink } from './links'

export interface StartOfDay {
  /** Google Maps walking directions. */
  href: string
  /** Where the first walk ends. */
  to: string
  /** Walking minutes when the route leg carries a duration; null for the stop fallback. */
  minutes: number | null
  /** The day's first stop — once it is ticked the owner has set off and the button retires. */
  firstStopId: string | null
}

/**
 * The morning's first walk. Prefer the first leg of the day's first walking route (real
 * turn-by-turn between two known points); otherwise directions from wherever the phone is to
 * the first stop that can be found on a map. Null when the day has nowhere to walk to.
 */
export function startOfDay(content: CityContent, date: string): StartOfDay | null {
  const stops = content.items.filter(i => i.kind === 'stop' && i.date === date).sort((a, b) => a.sort - b.sort)
  const firstStopId = stops[0]?.id ?? null

  const routes = content.routes.filter(r => r.date === date && r.mode === 'walking').sort((a, b) => a.sort - b.sort)
  for (const route of routes) {
    const leg = content.legs.filter(l => l.route_id === route.id).sort((a, b) => a.seq - b.seq)[0]
    if (!leg) continue
    return { href: legLink(leg), to: leg.to_name, minutes: leg.duration_s != null ? Math.round(leg.duration_s / 60) : null, firstStopId }
  }

  for (const stop of stops) {
    const href = walkLink({ lat: stop.lat, lng: stop.lng, name: stop.place_name, address: stop.address }, content.trip.name)
    if (href) return { href, to: stop.place_name ?? stop.plan.replace(/\*\*/g, ''), minutes: null, firstStopId }
  }
  return null
}
