import { isTicket, normaliseStatus } from './tickets'
import { minutesOf } from './time'
import type { BookingRow, CityContent } from './types'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtShortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${d} ${MONTHS_SHORT[m - 1]}`
}

// Nothing to chase: already done, called off, superseded, or never needed a booking.
// reserved_unpaid and unconfirmed stay OPEN — a payment date and an untrusted time are both actions.
const CLOSED_STATUSES = new Set<string>(['booked', 'confirmed', 'cancelled', 'not_needed', 'walk_up'])

export function openReminders(
  bookings: BookingRow[], state: Record<string, { status: string | null }>, todayISO: string,
): { booking: BookingRow; label: string; overdue: boolean }[] {
  return bookings
    .filter(b => b.kind === 'todo')
    .filter(b => !CLOSED_STATUSES.has(normaliseStatus(state[b.id]?.status ?? b.status_from_file) ?? ''))
    .sort((a, b) => (a.book_by ?? a.decide_by ?? '9999').localeCompare(b.book_by ?? b.decide_by ?? '9999'))
    .map(booking => {
      const effDate = booking.book_by ?? booking.decide_by
      const verb = booking.book_by ? 'Book' : 'Decide'
      const label = effDate ? `${verb} ${booking.title} by ${fmtShortDate(effDate)}` : `${verb} ${booking.title}`
      const overdue = effDate != null && effDate < todayISO
      return { booking, label, overdue }
    })
}

/**
 * Is the leaving city finished with `date`? True once every timed stop and ticket dated that day
 * is at or before `minutes` — and true outright for a day with nothing timed. On a transfer day
 * this is the moment Home moves across to the arriving city.
 */
export function departureDayDone(content: CityContent, date: string, minutes: number): boolean {
  const times = [
    ...content.items.filter(i => i.kind === 'stop' && i.date === date && i.time).map(i => i.time!),
    ...content.bookings.filter(b => isTicket(b) && b.date === date && b.time).map(b => b.time!),
  ]
  return times.every(t => minutesOf(t) <= minutes)
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
