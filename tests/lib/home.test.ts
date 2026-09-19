import { describe, it, expect } from 'vitest'
import { loadValle } from '../helpers/content'
import { openReminders, cityDot } from '../../src/lib/home'
import type { BookingRow } from '../../src/lib/types'

describe('openReminders', () => {
  it('lists todo bookings not booked/confirmed/cancelled, sorted by book_by, labelled and flagged overdue', async () => {
    const content = await loadValle()
    const r = openReminders(content.bookings, {}, '2026-10-25')
    expect(r.map(x => x.booking.id)).toEqual(['T01', 'T02'])
    expect(r[0]).toEqual({
      booking: content.bookings.find(b => b.id === 'T01'),
      label: 'Book Trattoria Alba — dinner by 20 Oct',
      overdue: true,
    })
    expect(r[1]).toEqual({
      booking: content.bookings.find(b => b.id === 'T02'),
      label: 'Book Saturday dinner — decide, then book by 27 Oct',
      overdue: false,
    })
  })

  it('excludes a booking whose live state marks it booked/confirmed/cancelled', async () => {
    const content = await loadValle()
    const r = openReminders(content.bookings, { T01: { status: 'booked' } }, '2026-10-25')
    expect(r.map(x => x.booking.id)).toEqual(['T02'])
  })

  it('labels Decide when only decide_by is set, and excludes non-todo bookings', () => {
    const decideOnly = blankBooking('Z1', 'todo', 'Pick a place', null, null)
    decideOnly.decide_by = '2026-10-10'
    const bookings: BookingRow[] = [decideOnly, blankBooking('Z2', 'booked', 'Not a todo', null, null)]
    const r = openReminders(bookings, {}, '2026-10-01')
    expect(r).toEqual([{ booking: decideOnly, label: 'Decide Pick a place by 10 Oct', overdue: false }])
  })

  it('closes reminders for statuses that carry no action, whatever spelling the file used', () => {
    // A superseded row exists so nobody re-books it, and a walk-up needs no booking at all —
    // neither should ever appear as something to chase.
    const mk = (id: string, status: string) => {
      const b = blankBooking(id, 'todo', `Thing ${id}`, null, null)
      b.book_by = '2026-10-10'; b.status_from_file = status
      return b
    }
    const bookings: BookingRow[] = [
      mk('C1', 'not_needed'), mk('C2', 'walk_up'), mk('C3', 'walk in'), mk('C4', 'pay_on_day'),
      mk('O1', 'reserved_unpaid'), mk('O2', 'unconfirmed'), mk('O3', 'not booked'),
    ]
    const open = openReminders(bookings, {}, '2026-10-01').map(x => x.booking.id)
    // reserved_unpaid has a payment date and unconfirmed has an untrusted time: both are actions.
    expect(open).toEqual(['O1', 'O2', 'O3'])
  })
})

describe('cityDot', () => {
  it('places Lisbon (west, mid-latitude) correctly', () => {
    const d = cityDot(38.72, -9.14)
    expect(d.x).toBeCloseTo(0.444, 2)
    expect(d.y).toBeGreaterThan(0.4)
    expect(d.y).toBeLessThan(0.6)
  })

  it('places Istanbul east of and slightly above Lisbon', () => {
    const lisbon = cityDot(38.72, -9.14)
    const istanbul = cityDot(41.0, 28.98)
    expect(istanbul.x).toBeGreaterThan(lisbon.x)
    expect(istanbul.y).toBeLessThan(lisbon.y)
  })

  it('places Cairo below Istanbul', () => {
    const istanbul = cityDot(41.0, 28.98)
    const cairo = cityDot(30.0, 31.2)
    expect(cairo.y).toBeGreaterThan(istanbul.y)
  })

  it('places Sydney in the wrapped-around far right of the image', () => {
    const sydney = cityDot(-33.9, 151.2)
    expect(sydney.x).toBeGreaterThan(0.85)
    expect(sydney.y).toBeGreaterThan(0.8)
  })
})

function blankBooking(
  id: string, kind: BookingRow['kind'], title: string, date: string | null, time: string | null,
): BookingRow {
  return {
    id, trip: 'valle', kind, title, date, time, priority: null, book_by: null, decide_by: null,
    contact: null, address: null, notes: null, fallback: null, relates_to: null, options: null,
    status_from_file: null, fields: {}, sort: 0, photo_path: null, photo_credit: null,
  }
}
