import type { CityContent, ItemRow, LegRow, RouteRow } from './types'
import { legLink, walkLink } from './links'

export interface NextWalk {
  to: string
  href: string
  distanceM: number | null
  durationS: number | null
  /** True when a route leg supplied it (turn-by-turn between two known points), false for a plain directions link. */
  fromRoute: boolean
}

function norm(s: string): string { return s.replace(/\*\*/g, '').toLowerCase().replace(/[^a-z0-9à-ÿ ]+/g, ' ').replace(/\s+/g, ' ').trim() }
function stopNames(item: ItemRow): string[] { return [item.place_name, item.plan].filter((x): x is string => !!x).map(norm).filter(n => n.length >= 3) }
function nameMatches(legName: string, item: ItemRow): boolean { const l = norm(legName); return l.length >= 3 && stopNames(item).some(n => n.includes(l) || l.includes(n)) }
function stopLabel(item: ItemRow): string { return item.place_name ?? item.plan.replace(/\*\*/g, '') }

function walkingRoutes(content: CityContent, date: string): RouteRow[] {
  return content.routes.filter(r => r.date === date && r.mode === 'walking').sort((a, b) => a.sort - b.sort)
}
function legsOf(content: CityContent, route: RouteRow): LegRow[] {
  return content.legs.filter(l => l.route_id === route.id).sort((a, b) => a.seq - b.seq)
}

/** The walk that starts at this stop: the route leg leaving it, else directions to the next stop of the day that can be found on a map. */
export function nextWalk(content: CityContent, item: ItemRow): NextWalk | null {
  for (const route of walkingRoutes(content, item.date)) {
    const leg = legsOf(content, route).find(l => nameMatches(l.from_name, item))
    if (leg) return { to: leg.to_name, href: legLink(leg), distanceM: leg.distance_m, durationS: leg.duration_s, fromRoute: true }
  }
  const later = content.items.filter(i => i.kind === 'stop' && i.date === item.date && i.sort > item.sort).sort((a, b) => a.sort - b.sort)
  for (const next of later) {
    const href = walkLink({ lat: next.lat, lng: next.lng, name: next.place_name, address: next.address }, content.trip.name)
    if (href) return { to: stopLabel(next), href, distanceM: null, durationS: null, fromRoute: false }
  }
  return null
}

/** The walking route whose legs start or end at this stop, if any. */
export function routeFor(content: CityContent, item: ItemRow): RouteRow | null {
  for (const route of walkingRoutes(content, item.date)) {
    if (legsOf(content, route).some(l => nameMatches(l.from_name, item) || nameMatches(l.to_name, item))) return route
  }
  return null
}

export function walkMetric(w: NextWalk): string | null {
  const parts: string[] = []
  if (w.distanceM != null) parts.push(w.distanceM >= 1000 ? `${(w.distanceM / 1000).toFixed(1)} km` : `${Math.round(w.distanceM / 10) * 10} m`)
  if (w.durationS != null) parts.push(`${Math.max(1, Math.round(w.durationS / 60))} min`)
  return parts.length ? parts.join(' · ') : null
}
