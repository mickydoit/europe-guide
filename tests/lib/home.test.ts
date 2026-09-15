import { describe, it, expect } from 'vitest'
import { loadValle } from '../helpers/content'
import {
  currentBlockOptions, toursToday, tripCountdowns, legsToday, openReminders, cityDot,
} from '../../src/lib/home'
import type { BookingRow, CityContent, LegRow, RouteRow, TripRow } from '../../src/lib/types'

const trip: TripRow = {
  slug: 'valle', name: 'Valle', country: 'Italy', country_code: 'it',
  start_date: '2026-11-01', end_date: '2026-11-03', base: 'Old Town', timezone: 'Europe/Rome', intro: null, sort: 0,
}

describe('currentBlockOptions', () => {
  it('finds the option group in the current block, heading derived from the parent stop', async () => {
    const content = await loadValle()
    // 19:00 on Monday -> evening block; Castello Alto (no options) then Aperitivo (has options)
    const r = currentBlockOptions(content, '2026-11-02', 19 * 60)
    expect(r.heading).toBe('Aperitivo options')
    expect(r.parent?.plan).toBe('Aperitivo — **pick one below**')
    expect(r.options.map(o => o.place_name)).toEqual(['Bar Sole', 'Enoteca Piccola'])
  })

  it('falls through to the next block when the current block has no options', async () => {
    const content = await loadValle()
    // 08:20 -> morning block, no options there or in midday; evening has the Aperitivo group
    const r = currentBlockOptions(content, '2026-11-02', 8 * 60 + 20)
    expect(r.heading).toBe('Aperitivo options')
    expect(r.parent?.id).toBe('valle/2026-11-02/1930/aperitivo-pick-one-below')
  })

  it('falls back to Options/null/[] when no stop in any block has options', async () => {
    const content = await loadValle()
    const r = currentBlockOptions(content, '2026-11-01', 19 * 60)
    expect(r).toEqual({ heading: 'Options', parent: null, options: [] })
  })

  it('derives a heading, dropping trailing conjunctions, for a hypothetical multi-word plan', () => {
    const content: CityContent = {
      trip, days: [], routes: [], legs: [], alerts: [], parked: [], notes: [], areas: [],
      items: [
        {
          id: 's1', trip: 'valle', date: '2026-11-02', block: 'morning', time: '08:00', time_text: '08:00',
          approx: false, kind: 'stop', parent_item: null, plan: '**Snack and a drink** — pick one below',
          details: null, sort: 0, place_name: null, address: null, lat: null, lng: null, url: null, route_id: null,
        },
        {
          id: 'o1', trip: 'valle', date: '2026-11-02', block: 'morning', time: null, time_text: null,
          approx: false, kind: 'option', parent_item: 's1', plan: 'Croissant', details: null, sort: 1,
          place_name: 'Croissant', address: null, lat: null, lng: null, url: null, route_id: null,
        },
      ],
      bookings: [],
    }
    const r = currentBlockOptions(content, '2026-11-02', 8 * 60)
    expect(r.heading).toBe('Snack options')
  })
})

describe('toursToday', () => {
  it('marks a single booking live mid-way through its assumed 3h window', async () => {
    const content = await loadValle()
    // B01 = 20:00 dinner on 2026-11-01, no other booked item that day -> 180 min duration
    const r = toursToday(content, '2026-11-01', 20 * 60 + 30)
    expect(r).toHaveLength(1)
    expect(r[0].booking.id).toBe('B01')
    expect(r[0].start).toBe(20 * 60)
    expect(r[0].status).toBe('live')
    expect(r[0].progress).toBeCloseTo(30 / 180, 5)
  })

  it('is upcoming before start and done after the window, with duration bounded by the next booking', () => {
    const content: CityContent = {
      trip, days: [], items: [], routes: [], legs: [], alerts: [], parked: [], notes: [], areas: [],
      bookings: [
        blankBooking('X1', 'booked', 'Museum', '2026-11-02', '10:00'),
        blankBooking('X2', 'booked', 'Lunch', '2026-11-02', '10:40'),
      ],
    }
    // X1 duration = 40 min (until X2 starts)
    const before = toursToday(content, '2026-11-02', 9 * 60 + 50)
    expect(before[0].status).toBe('upcoming')
    expect(before[0].progress).toBe(0)

    const mid = toursToday(content, '2026-11-02', 10 * 60 + 20)
    expect(mid[0].status).toBe('live')
    expect(mid[0].progress).toBeCloseTo(0.5, 5)

    const after = toursToday(content, '2026-11-02', 10 * 60 + 41)
    expect(after[0].status).toBe('done')
    expect(after[0].progress).toBe(1)
    // X2 is last of the day -> 180 min duration, and it's live right at its own start
    expect(after[1].status).toBe('live')
    expect(after[1].progress).toBeCloseTo(1 / 180, 5)
  })

  it('floors the duration at 15 min so two bookings at the same time stay sane', () => {
    const content: CityContent = {
      trip, days: [], items: [], routes: [], legs: [], alerts: [], parked: [], notes: [], areas: [],
      bookings: [
        blankBooking('Z1', 'booked', 'Tour', '2026-11-02', '10:00'),
        blankBooking('Z2', 'booked', 'Tour again', '2026-11-02', '10:00'),
      ],
    }
    // Same start time: the gap is zero, which without a floor divides by zero — Infinity
    // progress, and a tour that has not begun reported as done.
    const r = toursToday(content, '2026-11-02', 10 * 60 + 5)
    expect(r[0].status).toBe('live')
    expect(r[0].progress).toBeCloseTo(5 / 15, 5)
    expect(Number.isFinite(r[0].progress)).toBe(true)

    const atStart = toursToday(content, '2026-11-02', 10 * 60)
    expect(atStart[0].status).toBe('live')
    expect(atStart[0].progress).toBe(0)
  })

  it('excludes bookings without a time or of a different kind/date', () => {
    const content: CityContent = {
      trip, days: [], items: [], routes: [], legs: [], alerts: [], parked: [], notes: [], areas: [],
      bookings: [
        blankBooking('Y1', 'booked', 'No time', '2026-11-02', null),
        blankBooking('Y2', 'todo', 'Todo item', '2026-11-02', '10:00'),
        blankBooking('Y3', 'booked', 'Wrong day', '2026-11-03', '10:00'),
      ],
    }
    expect(toursToday(content, '2026-11-02', 10 * 60)).toEqual([])
  })
})

describe('tripCountdowns', () => {
  const trips: TripRow[] = [
    { ...trip, slug: 'valle', name: 'Valle', start_date: '2026-11-01', end_date: '2026-11-03' },
    { ...trip, slug: 'roma', name: 'Roma', start_date: '2026-11-03', end_date: '2026-11-04' },
    { ...trip, slug: 'siena', name: 'Siena', start_date: '2026-11-08', end_date: '2026-11-09' },
    { ...trip, slug: 'past', name: 'Past Trip', start_date: '2026-10-01', end_date: '2026-10-05' },
  ]

  it('labels Now, Tomorrow, In N days, and Done', () => {
    const r = tripCountdowns(trips, '2026-11-02')
    expect(r).toEqual([
      { slug: 'valle', name: 'Valle', label: 'Now', state: 'now' },
      { slug: 'roma', name: 'Roma', label: 'Tomorrow', state: 'future' },
      { slug: 'siena', name: 'Siena', label: 'In 6 days', state: 'future' },
      { slug: 'past', name: 'Past Trip', label: 'Done', state: 'past' },
    ])
  })

  it('treats the first and last day of a trip as Now', () => {
    const r = tripCountdowns(trips, '2026-11-01')
    expect(r[0]).toEqual({ slug: 'valle', name: 'Valle', label: 'Now', state: 'now' })
    const r2 = tripCountdowns(trips, '2026-11-03')
    expect(r2[0].label).toBe('Now')
  })
})

describe('legsToday', () => {
  it('orders legs by route sort then leg seq, metric null when distance/duration are unset', async () => {
    const content = await loadValle()
    const r = legsToday(content, '2026-11-02')
    expect(r.map(x => [x.leg.route_id, x.leg.seq, x.routeTitle, x.metric])).toEqual([
      ['V1', 0, 'Piazza to the belvedere', null],
      ['V1', 1, 'Piazza to the belvedere', null],
      ['V2', 0, 'Station to dinner', null],
    ])
  })

  it('excludes legs whose route is on a different date', async () => {
    const content = await loadValle()
    expect(legsToday(content, '2026-11-01')).toEqual([])
  })

  it('builds a metric label from distance and duration when present', () => {
    const route: RouteRow = {
      id: 'R1', trip: 'valle', date: '2026-11-02', title: 'Walk', distance_text: null,
      mode: 'walking', covers: [], note: null, google_url: '', sort: 0,
    }
    const leg: LegRow = {
      trip: 'valle', route_id: 'R1', seq: 0, from_name: 'A', to_name: 'B',
      from_lat: null, from_lng: null, to_lat: null, to_lng: null, google_url: '',
      polyline: null, distance_m: 1450, duration_s: 900,
    }
    const content: CityContent = {
      trip, days: [], items: [], bookings: [], alerts: [], parked: [], notes: [], areas: [],
      routes: [route], legs: [leg],
    }
    const r = legsToday(content, '2026-11-02')
    expect(r).toEqual([{ leg, routeTitle: 'Walk', metric: '1.4 km · 15 min' }])
  })
})

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
    status_from_file: null, fields: {}, sort: 0,
  }
}
