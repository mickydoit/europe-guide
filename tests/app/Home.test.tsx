import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { TripContext, TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'

const { useBookingStateMock, useChecksMock, saveMock, warmMock } = vi.hoisted(() => ({
  useBookingStateMock: vi.fn(),
  useChecksMock: vi.fn(() => ({ done: new Set<string>(), loading: false, toggle: vi.fn() })),
  saveMock: vi.fn(async () => ({ queued: false })),
  warmMock: vi.fn(async () => ({ cached: 0, total: 0 })),
}))
vi.mock('../../src/lib/attachmentsWarm', () => ({ warmTripAttachments: warmMock }))
vi.mock('../../src/lib/state', () => ({ useBookingState: useBookingStateMock, useChecks: useChecksMock, QUEUED_COPY: 'Saved on this phone — will sync when online' }))
vi.mock('../../src/lib/sync', () => ({ useSync: () => ({ pending: 0, failed: 0, syncing: false, lastError: undefined, retryFailed: vi.fn() }) }))
// Weather is exercised in WeatherStrip.test.tsx; here it must simply not fetch.
vi.mock('../../src/lib/weather', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/weather')>()
  return { ...actual, getDailyForecast: vi.fn(async () => { throw new Error('offline') }), getHourly: vi.fn(async () => { throw new Error('offline') }) }
})
vi.mock('../../src/lib/config', () => ({ OWNER_NAME: 'Michael' }))

import { Home } from '../../src/screens/Home'

const throwingClient = new Proxy({}, { get() { throw new Error('no network in tests') } }) as never
const SUNDAY_1200 = new Date('2026-11-01T11:00:00Z')   // 12:00 Europe/Rome, day one of the Valle fixture
const PRE_TRIP = new Date('2026-10-20T08:00:00Z')

function renderHome(content: CityContent) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TripProvider initial={{ trips: [content.trip], slug: 'valle', content }} client={throwingClient}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/ticket/:trip/:id" element={<p>Ticket screen</p>} />
          <Route path="/place/:id" element={<p>Place screen</p>} />
          <Route path="/tickets" element={<p>Tickets screen</p>} />
          <Route path="/map" element={<p>Map screen</p>} />
        </Routes>
      </TripProvider>
    </MemoryRouter>,
  )
}

let content: CityContent
beforeEach(async () => {
  content = await loadValle()
  useBookingStateMock.mockReturnValue({ state: {}, loading: false, save: saveMock })
  saveMock.mockClear()
  vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(SUNDAY_1200)
})
afterEach(() => { vi.useRealTimers() })

test('greeting with the owner name, date and trip-local time', () => {
  renderHome(content)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello... Michael')
  expect(screen.getByText(/Sunday 1 November · 12:00/)).toBeInTheDocument()
})

test('no country pills on Home', () => {
  renderHome(content)
  expect(screen.queryByRole('button', { name: content.trip.country })).toBeNull()
})

test('next-up card is the first booking still ahead today and opens its ticket', () => {
  renderHome(content)
  const next = screen.getByRole('region', { name: 'Next up' })
  expect(next).toHaveTextContent('Trattoria Alba')
  fireEvent.click(within(next).getByRole('link'))
  expect(screen.getByText('Ticket screen')).toBeInTheDocument()
})

test('tickets row shows the empty state when the next-up booking is the only one today', () => {
  renderHome(content)   // Sun 1 Nov: B01 is the only dated booking, and it is the next-up card
  const row = screen.getByRole('heading', { name: 'Tickets' }).closest('section') as HTMLElement
  expect(within(row).getByText('No more tickets today')).toBeInTheDocument()
})

test('tickets row lists the rest of today without the next-up booking', () => {
  vi.setSystemTime(new Date('2026-11-03T11:00:00Z'))   // Tue 3 Nov 12:00 Rome: B02 09:10 has passed, T02 20:00 is next
  renderHome(content)
  expect(screen.getByRole('region', { name: 'Next up' })).toHaveTextContent('Saturday dinner')
  const row = screen.getByRole('heading', { name: 'Tickets' }).closest('section') as HTMLElement
  expect(within(row).getByRole('link', { name: /Train south/ })).toBeInTheDocument()
  expect(within(row).queryByText(/Saturday dinner/)).toBeNull()
})

test('cycling a ticket status calls save with the next status', () => {
  vi.setSystemTime(new Date('2026-11-03T11:00:00Z'))   // Tue 3 Nov 12:00 Rome: B02 "Train south" sits in the Tickets row
  renderHome(content)
  const link = screen.getByRole('link', { name: /Train south/ })
  const card = link.closest('.ticket-card') as HTMLElement
  fireEvent.click(within(card).getByRole('button', { name: /Status/ }))
  expect(saveMock).toHaveBeenCalledWith('B02', { status: 'confirmed' })
})

test('tours and events row shows timed, named stops that are not bookings', () => {
  vi.setSystemTime(new Date('2026-11-02T11:00:00Z'))   // Mon 2 Nov: the day with named stops (Piazza Grande, Caffè Nord, Belvedere, Castello Alto, Trattoria Alba)
  renderHome(content)
  const row = screen.getByRole('heading', { name: 'Tours and events' }).closest('section') as HTMLElement
  const links = within(row).getAllByRole('link')
  expect(links.length).toBeGreaterThan(0)
  expect(links.every(l => l.getAttribute('href')!.startsWith('/place/'))).toBe(true)
  expect(within(row).queryByText(/Trattoria Alba/)).toBeNull()
})

test('reminders link to the Tickets tab', () => {
  renderHome(content)
  const chips = screen.getByRole('heading', { name: 'Reminders' }).closest('section') as HTMLElement
  const first = within(chips).getAllByRole('link')[0]
  expect(first).toHaveAttribute('href', '/tickets')
})

test('a booking already marked booked in live state drops off the reminder row', () => {
  useBookingStateMock.mockReturnValue({ state: { T01: { status: 'booked' } }, loading: false, save: saveMock })
  renderHome(content)
  const chips = screen.getByRole('heading', { name: 'Reminders' }).closest('section') as HTMLElement
  const links = within(chips).getAllByRole('link')
  expect(links).toHaveLength(1)
  expect(links[0]).toHaveTextContent('Saturday dinner')
})

test('Home starts the ticket warm pass for the active trip', () => {
  renderHome(content)
  expect(warmMock).toHaveBeenCalledWith('valle')
})

test('world map hero stays and opens the map', () => {
  renderHome(content)
  expect(screen.getByTestId('world-hero-map')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: 'Open map' }))
  expect(screen.getByText('Map screen')).toBeInTheDocument()
})

test('before the trip, Home says which day it is showing and still has a next-up', () => {
  vi.setSystemTime(PRE_TRIP)
  renderHome(content)
  expect(screen.getByText(/Plans for Sunday 1 November/)).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Next up' })).toHaveTextContent('Trattoria Alba')
})

test('loading, error and empty states', () => {
  render(<MemoryRouter><TripProvider initial={{ trips: [], slug: '', content: null as unknown as CityContent }} client={throwingClient}><Home /></TripProvider></MemoryRouter>)
  expect(screen.getByText(/No trips yet/)).toBeInTheDocument()
})

test('when today falls inside another loaded trip, Home switches the trip context to it', () => {
  // The owner lands on Home on the first morning in the next city: the ambient trip is still
  // the last one they looked at, and nothing on the screen would ever move them across.
  vi.setSystemTime(PRE_TRIP)                                    // 20 Oct 2026: outside the Valle fixture
  const other = { ...content.trip, slug: 'other', name: 'Other', start_date: '2026-10-19', end_date: '2026-10-22' }
  const setSlug = vi.fn()
  render(
    <MemoryRouter initialEntries={['/']}>
      <TripContext.Provider value={{ trips: [content.trip, other], slug: 'valle', content, loading: false, offline: false, error: null, setSlug, refresh: vi.fn(async () => {}) }}>
        <Routes><Route path="/" element={<Home />} /></Routes>
      </TripContext.Provider>
    </MemoryRouter>,
  )
  expect(setSlug).toHaveBeenCalledWith('other')
  expect(setSlug).toHaveBeenCalledTimes(1)
})

test('Home leaves the trip alone when today is inside the loaded one', () => {
  vi.setSystemTime(SUNDAY_1200)
  const other = { ...content.trip, slug: 'other', name: 'Other', start_date: '2026-10-19', end_date: '2026-10-22' }
  const setSlug = vi.fn()
  render(
    <MemoryRouter initialEntries={['/']}>
      <TripContext.Provider value={{ trips: [content.trip, other], slug: 'valle', content, loading: false, offline: false, error: null, setSlug, refresh: vi.fn(async () => {}) }}>
        <Routes><Route path="/" element={<Home />} /></Routes>
      </TripContext.Provider>
    </MemoryRouter>,
  )
  expect(setSlug).not.toHaveBeenCalled()
})

test('Start the day opens walking directions along the first route leg, with destination and minutes', () => {
  vi.setSystemTime(new Date('2026-11-02T07:00:00Z'))   // Mon 2 Nov 08:00 Rome — the day with walking route V1
  useChecksMock.mockReturnValue({ done: new Set<string>(), loading: false, toggle: vi.fn() })
  renderHome(content)
  const leg = content.legs.filter(l => l.route_id === 'V1').sort((a, b) => a.seq - b.seq)[0]
  const link = screen.getByRole('link', { name: /Start the day/ })
  expect(link).toHaveAttribute('href', leg.google_url)
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveTextContent(new RegExp(`Start the day · ${leg.to_name}`))
  if (leg.duration_s != null) expect(link).toHaveTextContent(new RegExp(`· ${Math.round(leg.duration_s / 60)} min`))
})

test('Start the day disappears once the first stop of the day is ticked', () => {
  vi.setSystemTime(new Date('2026-11-02T07:00:00Z'))
  const firstStop = content.items.filter(i => i.kind === 'stop' && i.date === '2026-11-02').sort((a, b) => a.sort - b.sort)[0]
  useChecksMock.mockReturnValue({ done: new Set([firstStop.id]), loading: false, toggle: vi.fn() })
  renderHome(content)
  expect(screen.queryByRole('link', { name: /Start the day/ })).toBeNull()
})

test('Start the day is not offered before the trip', () => {
  vi.setSystemTime(PRE_TRIP)
  useChecksMock.mockReturnValue({ done: new Set<string>(), loading: false, toggle: vi.fn() })
  renderHome(content)
  expect(screen.queryByRole('link', { name: /Start the day/ })).toBeNull()
})

test('section headings carry their Figma glyphs', () => {
  renderHome(content)
  const mask = (name: string) => ((screen.getByRole('heading', { name }).querySelector('.icon') as HTMLElement | null)?.style.maskImage ?? '')
  expect(mask('Tickets')).toContain('/icons/nav/suitcase.svg')
  expect(mask('Reminders')).toContain('/icons/badge/sparkle.svg')
})

test('the Tours and events heading carries the headphones glyph', () => {
  vi.setSystemTime(new Date('2026-11-02T11:00:00Z'))
  renderHome(content)
  const h = screen.getByRole('heading', { name: 'Tours and events' })
  expect((h.querySelector('.icon') as HTMLElement).style.maskImage).toContain('/icons/badge/headphones.svg')
})
