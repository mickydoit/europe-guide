import type { BookingRow, CityContent, ItemRow, LegRow, RouteRow, TripRow } from './types'
import { currentBlock, minutesOf } from './time'
import { distanceLabel } from './geo'

const BLOCKS = ['morning', 'midday', 'evening'] as const

const CONJUNCTIONS = new Set(['and', 'a', 'an', 'the', 'or'])

function stripMarkdown(s: string): string {
  return s.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').replace(/_/g, '').trim()
}

/** "**Snack and a drink** — pick one below" -> "Snack options" */
function deriveOptionsHeading(plan: string): string {
  const stripped = stripMarkdown(plan)
  const cut = stripped.match(/ — |:|,/)
  const prefix = cut ? stripped.slice(0, cut.index) : stripped
  const words = prefix.trim().split(/\s+/).filter(Boolean).slice(0, 3)
  while (words.length > 1 && CONJUNCTIONS.has(words[words.length - 1].toLowerCase())) words.pop()
  const phrase = words.join(' ')
  return phrase.toLowerCase().includes('option') ? phrase : `${phrase} options`
}

export function currentBlockOptions(
  content: CityContent, date: string, minutes: number,
): { heading: string; parent: ItemRow | null; options: ItemRow[] } {
  const cur = currentBlock(minutes)
  const startIdx = BLOCKS.indexOf(cur)
  const stopsOnDate = content.items.filter(i => i.kind === 'stop' && i.date === date)
  for (let idx = startIdx; idx < BLOCKS.length; idx++) {
    const stops = stopsOnDate.filter(s => s.block === BLOCKS[idx]).sort((a, b) => a.sort - b.sort)
    for (const stop of stops) {
      const options = content.items
        .filter(i => i.kind === 'option' && i.parent_item === stop.id)
        .sort((a, b) => a.sort - b.sort)
      if (options.length > 0) return { heading: deriveOptionsHeading(stop.plan), parent: stop, options }
    }
  }
  return { heading: 'Options', parent: null, options: [] }
}

export function toursToday(
  content: CityContent, date: string, minutes: number,
): { booking: BookingRow; start: number; progress: number; status: 'upcoming' | 'live' | 'done' }[] {
  const bookings = content.bookings
    .filter(b => b.kind === 'booked' && b.date === date && b.time)
    .sort((a, b) => minutesOf(a.time!) - minutesOf(b.time!))
  return bookings.map((booking, idx) => {
    const start = minutesOf(booking.time!)
    const next = bookings[idx + 1]
    // Two tours booked at the same time (or out of order in the file) would otherwise give
    // a zero or negative duration — and a division by zero puts the progress bar at Infinity
    // and calls a tour that has not started "done". A quarter hour is the shortest tour worth
    // drawing a bar for.
    const duration = Math.max(15, next ? minutesOf(next.time!) - start : 180)
    const progress = Math.min(1, Math.max(0, (minutes - start) / duration))
    const status: 'upcoming' | 'live' | 'done' = minutes < start ? 'upcoming' : minutes >= start + duration ? 'done' : 'live'
    return { booking, start, progress, status }
  })
}

function daysBetween(fromISO: string, toISO: string): number {
  const [fy, fm, fd] = fromISO.split('-').map(Number)
  const [ty, tm, td] = toISO.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

export function tripCountdowns(
  trips: TripRow[], todayISO: string,
): { slug: string; name: string; label: string; state: 'now' | 'future' | 'past' }[] {
  return trips.map(trip => {
    if (todayISO >= trip.start_date && todayISO <= trip.end_date) {
      return { slug: trip.slug, name: trip.name, label: 'Now', state: 'now' as const }
    }
    if (todayISO > trip.end_date) {
      return { slug: trip.slug, name: trip.name, label: 'Done', state: 'past' as const }
    }
    const days = daysBetween(todayISO, trip.start_date)
    const label = days === 1 ? 'Tomorrow' : `In ${days} days`
    return { slug: trip.slug, name: trip.name, label, state: 'future' as const }
  })
}

export function legsToday(
  content: CityContent, date: string,
): { leg: LegRow; routeTitle: string; metric: string | null }[] {
  const routesById = new Map<string, RouteRow>(content.routes.map(r => [r.id, r]))
  return content.legs
    .filter(l => routesById.get(l.route_id)?.date === date)
    .sort((a, b) => {
      const ra = routesById.get(a.route_id)!, rb = routesById.get(b.route_id)!
      return ra.sort - rb.sort || a.seq - b.seq
    })
    .map(leg => {
      const route = routesById.get(leg.route_id)!
      const parts: string[] = []
      if (leg.distance_m != null) parts.push(distanceLabel(leg.distance_m))
      if (leg.duration_s != null) parts.push(`${Math.round(leg.duration_s / 60)} min`)
      return { leg, routeTitle: route.title, metric: parts.length ? parts.join(' · ') : null }
    })
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtShortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${d} ${MONTHS_SHORT[m - 1]}`
}

const CLOSED_STATUSES = new Set(['booked', 'confirmed', 'cancelled'])

export function openReminders(
  bookings: BookingRow[], state: Record<string, { status: string | null }>, todayISO: string,
): { booking: BookingRow; label: string; overdue: boolean }[] {
  return bookings
    .filter(b => b.kind === 'todo')
    .filter(b => !CLOSED_STATUSES.has(state[b.id]?.status ?? b.status_from_file ?? ''))
    .sort((a, b) => (a.book_by ?? a.decide_by ?? '9999').localeCompare(b.book_by ?? b.decide_by ?? '9999'))
    .map(booking => {
      const effDate = booking.book_by ?? booking.decide_by
      const verb = booking.book_by ? 'Book' : 'Decide'
      const label = effDate ? `${verb} ${booking.title} by ${fmtShortDate(effDate)}` : `${verb} ${booking.title}`
      const overdue = effDate != null && effDate < todayISO
      return { booking, label, overdue }
    })
}

// Calibration for public/home/world.png: 1292x853 Mercator, longitudes wrap past 180 to
// show NZ/Fiji on the right edge. Tweak after a visual check against the rendered hero.
export const LON0 = -169
export const LON1 = 191
export const LAT_TOP = 83.7
export const LAT_BOTTOM = -56.5

function mercY(phiDeg: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (phiDeg * Math.PI) / 360))
}

export function cityDot(lat: number, lng: number): { x: number; y: number } {
  let l = lng
  while (l < LON0) l += 360
  while (l >= LON1) l -= 360
  const x = (l - LON0) / (LON1 - LON0)
  const y = (mercY(LAT_TOP) - mercY(lat)) / (mercY(LAT_TOP) - mercY(LAT_BOTTOM))
  return { x, y }
}
