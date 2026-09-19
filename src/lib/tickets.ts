import type { BookingRow, CityContent, ItemRow, TripRow } from './types'
import { fmtDay, minutesOf } from './time'

export type TicketKind = 'transport' | 'accommodation' | 'event'
export type Status = 'not_booked' | 'booked' | 'confirmed' | 'cancelled' | 'undecided'
  | 'reserved_unpaid' | 'unconfirmed' | 'walk_up' | 'not_needed' | null

const KINDS = new Set<string>(['transport', 'accommodation', 'event'])
// Title only: notes mention taxis and hotels in passing ("10 min by taxi") and would misfire.
const TRANSPORT_RE = /\b(flight|fly|plane|train|ave|iryo|alvia|renfe|rail|taxi|bolt|uber|cab|airport|transfer|shuttle|ferry|bus|metro|tram|drive|car hire)\b/i
// "airport" is deliberately absent: an airport taxi or transfer is ground transport, not a flight.
const PLANE_RE = /\b(flight|fly|plane)\b/i
// Real imported flights are titled "Ryanair FR3628 LIS → SVQ": no keyword above matches.
// The code is matched case-sensitively and must carry digits, so "Dinner at FR Bistro" is safe.
const FLIGHT_CODE_RE = /\b[A-Z]{2}\s?\d{3,4}\b/
const CARRIER_RE = /\b(ryanair|easyjet|vueling|iberia|tap|lufthansa|british airways|klm|air france|turkish)\b/i
function isFlight(title: string): boolean { return FLIGHT_CODE_RE.test(title) || CARRIER_RE.test(title) }
const STAY_RE = /\b(hotel|hostel|stay|flat|apartment|airbnb|check-?in|check-?out|nights?|riad|guesthouse)\b/i
// Rail keywords beat the flight-code heuristic below: "AVE 03971 Madrid → Sevilla" is a train.
const TRAIN_RE = /\b(train|rail|renfe|ave|iryo|alvia|cercan[ií]as|intercity|metro|tram|subway|underground|funicular)\b/i
// Cabs, rideshares and transfers beat the plane check: "Airport taxi" is a car ride.
const CAR_RE = /\b(taxi|cab|uber|bolt|transfer|shuttle|drive|car hire)\b/i
const MEAL_RE = /\b(dinner|lunch|breakfast|brunch|restaurant|tapas|meal|dining|bistro|trattoria)\b/i

export function inferKind(b: Pick<BookingRow, 'title' | 'fields'>): TicketKind {
  const explicit = b.fields?.kind?.trim().toLowerCase()
  if (explicit && KINDS.has(explicit)) return explicit as TicketKind
  if (TRANSPORT_RE.test(b.title) || isFlight(b.title)) return 'transport'
  if (STAY_RE.test(b.title)) return 'accommodation'
  return 'event'
}

export type KindIcon = 'plane' | 'car' | 'train' | 'hotel' | 'event' | 'meal'

export function kindIcon(kind: TicketKind, title: string): KindIcon {
  if (kind === 'accommodation') return 'hotel'
  if (kind === 'transport') {
    if (TRAIN_RE.test(title)) return 'train'
    if (CAR_RE.test(title)) return 'car'
    return PLANE_RE.test(title) || isFlight(title) ? 'plane' : 'car'
  }
  return MEAL_RE.test(title) ? 'meal' : 'event'
}

export function isTicket(b: BookingRow): boolean { return b.kind !== 'walkin' }

function byTimeThenSort(a: BookingRow, b: BookingRow): number {
  if (a.time && b.time) return minutesOf(a.time) - minutesOf(b.time) || a.sort - b.sort
  if (a.time) return -1
  if (b.time) return 1
  return a.sort - b.sort
}

export function ticketsForDay(bookings: BookingRow[], date: string): BookingRow[] {
  return bookings.filter(b => isTicket(b) && b.date === date).sort(byTimeThenSort)
}

export function nextTicket(content: CityContent, date: string, minutes: number): { booking: BookingRow; date: string } | null {
  const today = ticketsForDay(content.bookings, date)
  const later = today.find(b => b.time && minutesOf(b.time) >= minutes)
  if (later) return { booking: later, date }
  if (today[0]) return { booking: today[0], date }
  const futureDates = Array.from(new Set(content.bookings.filter(b => isTicket(b) && b.date && b.date > date).map(b => b.date!))).sort()
  for (const d of futureDates) {
    const list = ticketsForDay(content.bookings, d)
    if (list[0]) return { booking: list[0], date: d }
  }
  return null
}

export function groupByDate(bookings: BookingRow[]): { date: string | null; bookings: BookingRow[] }[] {
  const tickets = bookings.filter(isTicket)
  const dates = Array.from(new Set(tickets.filter(b => b.date).map(b => b.date!))).sort()
  const groups = dates.map(date => ({ date: date as string | null, bookings: ticketsForDay(tickets, date) }))
  const undated = tickets.filter(b => !b.date).sort((a, b) => a.sort - b.sort)
  if (undated.length) groups.push({ date: null, bookings: undated })
  return groups
}

export function countriesOf(trips: TripRow[]): { country: string; code: string; trips: TripRow[] }[] {
  const out: { country: string; code: string; trips: TripRow[] }[] = []
  for (const t of [...trips].sort((a, b) => a.sort - b.sort || a.start_date.localeCompare(b.start_date))) {
    const g = out.find(x => x.country === t.country)
    if (g) g.trips.push(t); else out.push({ country: t.country, code: t.country_code, trips: [t] })
  }
  return out
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function shortDate(iso: string): string { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS_SHORT[m - 1]}` }
function joinParts(parts: Array<string | null | undefined>): string | null { const p = parts.filter((x): x is string => !!x && x.trim() !== ''); return p.length ? p.join(' · ') : null }

export function ticketLines(b: BookingRow, kind: TicketKind): { label: string; value: string; sub: string | null } {
  const time = b.time ?? '—'
  if (kind === 'transport') return { label: 'Departs', value: time, sub: joinParts([b.fields.cost, b.contact]) }
  if (kind === 'accommodation') return { label: 'Check-in', value: b.date ? fmtDay(b.date) : '—', sub: joinParts([b.fields.ref, b.contact]) }
  return { label: 'At', value: time, sub: joinParts([b.fields.cost || b.address]) }
}

// Route-strip fields (from/to/arrives/departs) and the ref are drawn on the pass itself, never as cells.
const HIDDEN_FIELDS = new Set(['for_note', 'book_by_note', 'decide_by_note', 'tier', 'kind', 'cost', 'ref', 'from', 'to', 'arrives', 'departs'])
function humanize(key: string): string { const w = key.replace(/_/g, ' '); return w.charAt(0).toUpperCase() + w.slice(1) }

export function fourCells(b: BookingRow): { key: string; value: string }[] {
  const cells: { key: string; value: string }[] = []
  if (b.fields.cost) cells.push({ key: 'Cost', value: b.fields.cost })
  if (b.contact) cells.push({ key: 'Contact', value: b.contact })
  if (b.book_by) cells.push({ key: 'Book by', value: shortDate(b.book_by) })
  else if (b.decide_by) cells.push({ key: 'Decide by', value: shortDate(b.decide_by) })
  for (const [k, v] of Object.entries(b.fields)) {
    if (cells.length >= 4) break
    // Some imported fields are a sentence ("why_urgent"); the four-cell strip is a
    // label/value grid and long prose blows its layout out. Cost/Contact/Book by above
    // are short by nature and stay unconditional.
    if (HIDDEN_FIELDS.has(k) || !v || v.length > 40) continue
    cells.push({ key: humanize(k), value: v })
  }
  return cells.slice(0, 4)
}

const STATUSES = new Set<string>(['not_booked', 'booked', 'confirmed', 'cancelled', 'undecided',
  'reserved_unpaid', 'unconfirmed', 'walk_up', 'not_needed'])

// The trip export (schema 1.1) carries a richer vocabulary than the app's own. Anything that means
// "turn up, there is nothing to book" collapses to walk_up; a booking whose time is not trusted is
// unconfirmed, not booked, because the handoff says to treat it as an action rather than settled.
const STATUS_ALIAS: Record<string, Exclude<Status, null>> = {
  walk_in: 'walk_up', pay_on_day: 'walk_up',
  booked_time_unverified: 'unconfirmed',
}

/** One place that turns any written-down status into one the app knows. */
export function normaliseStatus(raw: string | null | undefined): Status {
  if (!raw) return null
  const s = raw.toLowerCase().trim().replace(/\s+/g, '_')
  if (STATUSES.has(s)) return s as Exclude<Status, null>
  if (STATUS_ALIAS[s]) return STATUS_ALIAS[s]
  if (s.startsWith('booked')) return 'booked'
  return 'not_booked'
}

export function effectiveStatus(b: BookingRow, row: { status: string | null } | undefined): Status {
  return normaliseStatus(row?.status ?? b.status_from_file ?? (b.kind === 'booked' ? 'booked' : null))
}

// Only the three values booking_state's check constraint allows: the wider schema-1.1 statuses
// arrive from the file, they are never something the owner can tap their way into.
export function cycleStatus(s: Status): 'not_booked' | 'booked' | 'confirmed' {
  if (s === 'booked') return 'confirmed'
  if (s === 'confirmed') return 'not_booked'
  if (s === 'cancelled') return 'not_booked'
  return 'booked' // null, not_booked, undecided
}

function norm(s: string): string { return s.replace(/\*\*/g, '').toLowerCase().replace(/[^a-z0-9à-ÿ ]+/g, ' ').replace(/\s+/g, ' ').trim() }

export function bookingForStop(bookings: BookingRow[], item: ItemRow): BookingRow | null {
  const names = [item.place_name, item.plan].filter((x): x is string => !!x).map(norm).filter(n => n.length >= 4)
  const matches: BookingRow[] = []
  for (const b of bookings) {
    if (!isTicket(b)) continue
    const t = norm(b.title.split(/ — | - /)[0])
    if (t.length < 4) continue
    if (names.some(n => n.includes(t) || t.includes(n))) matches.push(b)
  }
  if (!matches.length) return null
  return matches.find(b => b.date === item.date) ?? matches[0]
}

/**
 * `bookingForStop` reversed: the itinerary stop (or option) a booking names, or null.
 * Same normalised substring rule, same "prefer the one on the booking's own date" tie-break —
 * the import uses it to give a booking the photo its stop already has instead of searching twice.
 */
export function stopForBooking(items: ItemRow[], b: BookingRow): ItemRow | null {
  const t = norm(b.title.split(/ — | - /)[0])
  if (t.length < 4) return null
  const matches = items.filter(item => {
    const names = [item.place_name, item.plan].filter((x): x is string => !!x).map(norm).filter(n => n.length >= 4)
    return names.some(n => n.includes(t) || t.includes(n))
  })
  if (!matches.length) return null
  return matches.find(i => i.date === b.date) ?? matches[0]
}

export function stopsForCards(content: CityContent, date: string): ItemRow[] {
  return content.items
    .filter(i => i.kind === 'stop' && i.date === date && i.place_name && (i.time || i.time_text))
    .filter(i => !bookingForStop(content.bookings, i))
    .sort((a, b) => a.sort - b.sort)
}
