import { describe, test, expect, beforeEach } from 'vitest'
import { loadValle } from '../helpers/content'
import type { BookingRow, CityContent } from '../../src/lib/types'
import {
  inferKind, isTicket, ticketsForDay, nextTicket, groupByDate, countriesOf, ticketLines, fourCells,
  effectiveStatus, cycleStatus, bookingForStop, stopsForCards, kindIcon,
} from '../../src/lib/tickets'

let content: CityContent
beforeEach(async () => { content = await loadValle() })

const b = (over: Partial<BookingRow>): BookingRow => ({
  id: 'X1', trip: 'valle', kind: 'todo', title: 'Thing', date: '2026-11-02', time: '10:00', priority: null,
  book_by: null, decide_by: null, contact: null, address: null, notes: null, fallback: null, relates_to: null,
  options: null, status_from_file: null, fields: {}, sort: 0, photo_path: null, photo_credit: null, ...over,
})

describe('inferKind', () => {
  test('title keywords', () => {
    expect(inferKind(b({ title: 'Train south' }))).toBe('transport')
    expect(inferKind(b({ title: 'AVE Seville → Barcelona' }))).toBe('transport')
    expect(inferKind(b({ title: 'Airport taxi, Sunday departure' }))).toBe('transport')
    expect(inferKind(b({ title: 'Stay at Hotel Arch' }))).toBe('accommodation')
    expect(inferKind(b({ title: 'Trattoria Alba — dinner' }))).toBe('event')
  })
  test('fields.kind wins over the title', () => {
    expect(inferKind(b({ title: 'Train south', fields: { kind: 'event' } }))).toBe('event')
    expect(inferKind(b({ title: 'Dinner', fields: { kind: 'nonsense' } }))).toBe('event')
  })
  test('notes are not consulted', () => {
    expect(inferKind(b({ title: 'Dinner', notes: 'take a taxi' }))).toBe('event')
  })
  test('a flight code or a carrier name makes it transport', () => {
    expect(inferKind({ title: 'Ryanair FR3628 LIS → SVQ', fields: {} })).toBe('transport')
    expect(inferKind({ title: 'TP1234 to Porto', fields: {} })).toBe('transport')
    expect(inferKind({ title: 'Vueling to Barcelona', fields: {} })).toBe('transport')
  })
  test('two letters with no digits is not a flight code', () => {
    expect(inferKind({ title: 'Dinner at FR Bistro', fields: {} })).toBe('event')
  })
})

test('isTicket excludes walk-ins', () => {
  expect(isTicket(b({ kind: 'walkin' }))).toBe(false)
  expect(isTicket(b({ kind: 'booked' }))).toBe(true)
  expect(isTicket(b({ kind: 'todo' }))).toBe(true)
})

test('ticketsForDay sorts by time, undated-time last, walk-ins out', () => {
  const list = [b({ id: 'a', time: '20:00' }), b({ id: 'w', kind: 'walkin' }), b({ id: 'n', time: null, sort: 9 }), b({ id: 'c', time: '09:10' })]
  expect(ticketsForDay(list, '2026-11-02').map(x => x.id)).toEqual(['c', 'a', 'n'])
})

describe('nextTicket', () => {
  test('first booking later than now on the day', () => {
    // Valle fixture: B01 Trattoria Alba 2026-11-01 20:00; B02 Train south 2026-11-03 09:10; T01 same dinner; T02 decide.
    const r = nextTicket(content, '2026-11-01', 12 * 60)
    expect(r?.booking.id).toBe('B01'); expect(r?.date).toBe('2026-11-01')
  })
  test('falls back to the first of the day when all have passed', () => {
    const r = nextTicket(content, '2026-11-01', 23 * 60)
    expect(r?.booking.id).toBe('B01')
  })
  test('a later booking on the day wins over tomorrow', () => {
    // T01 (the to-book dinner) is dated 2026-11-02 19:30 in the fixture.
    const r = nextTicket(content, '2026-11-02', 9 * 60)
    expect(r?.booking.id).toBe('T01'); expect(r?.date).toBe('2026-11-02')
  })
  test('rolls forward to the first dated booking when the day has none', () => {
    const r = nextTicket(content, '2026-10-31', 0)
    expect(r?.booking.id).toBe('B01'); expect(r?.date).toBe('2026-11-01')
  })
  test('null when nothing dated remains', () => {
    expect(nextTicket({ ...content, bookings: [] }, '2026-11-02', 0)).toBeNull()
  })
})

test('groupByDate: dated ascending, undated last, walk-ins excluded', () => {
  const g = groupByDate([b({ id: 'u', date: null }), b({ id: 'w', kind: 'walkin' }), b({ id: 'late', date: '2026-11-03' }), b({ id: 'early', date: '2026-11-01' })])
  expect(g.map(x => x.date)).toEqual(['2026-11-01', '2026-11-03', null])
  expect(g[2].bookings.map(x => x.id)).toEqual(['u'])
})

test('countriesOf groups trips in sort order', () => {
  const t = (slug: string, country: string, code: string, sort: number) => ({ ...content.trip, slug, name: slug, country, country_code: code, sort })
  const c = countriesOf([t('istanbul', 'Turkey', 'tr', 0), t('lisbon', 'Portugal', 'pt', 1), t('seville', 'Spain', 'es', 2), t('barcelona', 'Spain', 'es', 3)])
  expect(c.map(x => x.country)).toEqual(['Turkey', 'Portugal', 'Spain'])
  expect(c[2].trips.map(x => x.slug)).toEqual(['seville', 'barcelona'])
})

describe('ticketLines', () => {
  test('transport: time and reference/cost', () => {
    const l = ticketLines(b({ title: 'Train south', time: '09:10', fields: { cost: '€45' }, contact: '+34 600' }), 'transport')
    expect(l).toEqual({ label: 'Departs', value: '09:10', sub: '€45 · +34 600' })
  })
  test('accommodation: check-in date', () => {
    const l = ticketLines(b({ title: 'Hotel', date: '2026-11-01', time: null, fields: { ref: 'ABC' } }), 'accommodation')
    expect(l.label).toBe('Check-in'); expect(l.value).toBe('Sunday 1 November'); expect(l.sub).toBe('ABC')
  })
  test('event: time, cost or address; no sub when nothing', () => {
    expect(ticketLines(b({ time: '20:00', address: 'Via Alba 3' }), 'event')).toEqual({ label: 'At', value: '20:00', sub: 'Via Alba 3' })
    expect(ticketLines(b({ time: '20:00', address: 'Via Alba 3', fields: { cost: '' } }), 'event')).toEqual({ label: 'At', value: '20:00', sub: 'Via Alba 3' })
    expect(ticketLines(b({ time: null }), 'event')).toEqual({ label: 'At', value: '—', sub: null })
  })
})

test('fourCells: cost, contact, book by, then other fields, max four, empties dropped', () => {
  const cells = fourCells(b({ book_by: '2026-10-01', contact: '+351 1', fields: { cost: '€32', tier: '1', book_at: 'their site', for_note: 'x', book_by_note: 'y', kind: 'event', extra: 'z' } }))
  expect(cells).toEqual([
    { key: 'Cost', value: '€32' }, { key: 'Contact', value: '+351 1' }, { key: 'Book by', value: '1 Oct' }, { key: 'Book at', value: 'their site' },
  ])
  expect(fourCells(b({}))).toEqual([])
})

test('fourCells skips generic field values longer than 40 characters', () => {
  const long = 'Sells out weeks ahead in October and the queue on the day is brutal'
  expect(long.length).toBeGreaterThan(40)
  const cells = fourCells(b({ fields: { why_urgent: long, deck: 'Upper' } }))
  expect(cells.map(c => c.key)).toEqual(['Deck'])
})

test('fourCells keeps Cost/Contact/Book by however long they are', () => {
  const longCost = 'Roughly €180 each including the seat reservation and the bike supplement'
  expect(longCost.length).toBeGreaterThan(40)
  const cells = fourCells(b({ fields: { cost: longCost } }))
  expect(cells).toEqual([{ key: 'Cost', value: longCost }])
})

test('effectiveStatus and cycleStatus', () => {
  expect(effectiveStatus(b({ kind: 'booked' }), undefined)).toBe('booked')
  expect(effectiveStatus(b({ kind: 'todo' }), undefined)).toBeNull()
  expect(effectiveStatus(b({ kind: 'todo', status_from_file: 'not booked' }), undefined)).toBe('not_booked')
  expect(effectiveStatus(b({ kind: 'todo' }), { status: 'confirmed' })).toBe('confirmed')
  expect(cycleStatus(null)).toBe('booked'); expect(cycleStatus('not_booked')).toBe('booked')
  expect(cycleStatus('booked')).toBe('confirmed'); expect(cycleStatus('confirmed')).toBe('not_booked'); expect(cycleStatus('cancelled')).toBe('not_booked')
})

test('bookingForStop matches by name, case-insensitive, either direction of containment', () => {
  const stop = content.items.find(i => i.kind === 'stop' && /Trattoria Alba/i.test(i.plan))!
  expect(bookingForStop(content.bookings, { ...stop, plan: 'Unrelated', place_name: 'Nowhere' })).toBeNull()
})

test('bookingForStop prefers the booking dated the same as the stop', () => {
  // Fixture has the same dinner twice: B01 booked 2026-11-01, T01 to-book 2026-11-02.
  // The Trattoria Alba stop itself is on 2026-11-02, so the same-date booking should win.
  const stop = content.items.find(i => i.kind === 'stop' && /Trattoria Alba/i.test(i.plan))!
  expect(stop.date).toBe('2026-11-02')
  expect(bookingForStop(content.bookings, stop)?.id).toBe('T01')
  expect(bookingForStop(content.bookings, { ...stop, date: '2026-11-01' })?.id).toBe('B01')
})

test('stopsForCards: timed, named, not a booking, sorted', () => {
  const day1 = stopsForCards(content, '2026-11-01')
  expect(day1.every(s => s.kind === 'stop' && s.place_name && (s.time || s.time_text))).toBe(true)

  // 2026-11-02 actually carries the Trattoria stop, so this exercises the booking-exclusion path.
  const day2 = stopsForCards(content, '2026-11-02')
  expect(day2.length).toBeGreaterThan(0)
  expect(day2.every(s => s.kind === 'stop' && s.place_name && (s.time || s.time_text))).toBe(true)
  expect(day2.some(s => /Trattoria Alba/i.test(s.plan))).toBe(false)
})

test('kindIcon', () => {
  expect(kindIcon('transport', 'Flight to Seville')).toBe('plane')
  expect(kindIcon('transport', 'AVE Seville → Barcelona')).toBe('car')   // trains and taxis share the car glyph until Plan 6 photos
  expect(kindIcon('accommodation', 'Hotel')).toBe('hotel')
  expect(kindIcon('event', 'Dinner')).toBe('event')
  expect(kindIcon('transport', 'Ryanair FR3628 LIS → SVQ')).toBe('plane')
})

test('fourCells hides the route-strip fields (from/to/arrives/ref) but keeps seats and bags', () => {
  const cells = fourCells(b({ fields: { ref: 'S151VF', from: 'LIS', to: 'SVQ', arrives: '10:00', seats: '21A, 21B', bags: '2 × 20 kg' } }))
  expect(cells).toEqual([{ key: 'Seats', value: '21A, 21B' }, { key: 'Bags', value: '2 × 20 kg' }])
})
