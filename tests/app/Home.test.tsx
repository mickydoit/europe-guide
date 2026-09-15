import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'

const { useBookingStateMock, useChecksMock, getCurrentMock, warmMock } = vi.hoisted(() => ({
  useBookingStateMock: vi.fn(),
  useChecksMock: vi.fn(),
  getCurrentMock: vi.fn(),
  warmMock: vi.fn(async () => ({ cached: 0, total: 0 })),
}))
vi.mock('../../src/lib/attachmentsWarm', () => ({ warmTripAttachments: warmMock }))

vi.mock('../../src/lib/state', () => ({
  useBookingState: useBookingStateMock,
  useChecks: useChecksMock,
  QUEUED_COPY: 'Saved on this phone — will sync when online',
}))
// Home carries a SyncBadge; keep the outbox (and its IndexedDB reads) out of these tests.
vi.mock('../../src/lib/sync', () => ({
  useSync: () => ({ pending: 0, failed: 0, syncing: false, lastError: undefined, retryFailed: vi.fn() }),
}))
vi.mock('../../src/lib/weather', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/weather')>()
  return { ...actual, getCurrent: getCurrentMock }
})

import { Home } from '../../src/screens/Home'

const throwingClient = new Proxy({}, { get() { throw new Error('no network in tests') } }) as never

// 09:00 Europe/Rome on Monday 2 November, the middle day of the Valle fixture trip.
const MONDAY_0900 = new Date('2026-11-02T08:00:00Z')
// Well before the trip starts, so `todayInTrip` is null and Home falls back to day one.
const PRE_TRIP = new Date('2026-10-20T08:00:00Z')

function renderHome(content: CityContent) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TripProvider initial={{ trips: [content.trip], slug: 'valle', content }} client={throwingClient}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/day" element={<p>Day screen</p>} />
          <Route path="/day/:date" element={<p>Day screen</p>} />
          <Route path="/bookings" element={<p>Bookings screen</p>} />
          <Route path="/map" element={<p>Map screen</p>} />
        </Routes>
      </TripProvider>
    </MemoryRouter>,
  )
}

function section(name: string): HTMLElement {
  return screen.getByRole('heading', { name }).closest('section') as HTMLElement
}

let content: CityContent

beforeEach(async () => {
  content = await loadValle()
  vi.setSystemTime(MONDAY_0900)
  useBookingStateMock.mockReturnValue({ state: {}, loading: false, save: vi.fn() })
  useChecksMock.mockReturnValue({ done: new Set<string>(), loading: false, toggle: vi.fn() })
  getCurrentMock.mockReset()
  getCurrentMock.mockRejectedValue(new Error('no weather in tests'))
  warmMock.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

test('the header carries the trip-local date and clock next to the sync badge', async () => {
  renderHome(content)
  expect(await screen.findByRole('heading', { name: /Monday 2 November/ })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /09:00/ })).toBeInTheDocument()
})

test('the trip pills show the country name and the active trip is marked', async () => {
  renderHome(content)
  const pill = await screen.findByRole('button', { name: 'Italy' })
  expect(pill).toHaveClass('trip-picker__pill--active')
})

test('the hero renders the world map image and an Open map link', async () => {
  renderHome(content)
  const img = await screen.findByTestId('world-hero-map')
  expect(img).toHaveAttribute('alt', '')
  expect(img.tagName).toBe('IMG')
  expect(screen.getByRole('link', { name: 'Open map' })).toHaveAttribute('href', '/map')
})

test('the hero shows the current temperature and condition when the weather call resolves', async () => {
  vi.stubEnv('VITE_GOOGLE_BROWSER_KEY', 'k')
  getCurrentMock.mockResolvedValue({
    fetchedAt: '2026-11-02T08:00:00Z', temp: 24.2, feelsLike: 23, condition: 'Sunny',
    iconUri: 'https://example.com/icon', humidity: 40, windKph: 6, stale: false,
  })

  renderHome(content)

  expect(await screen.findByText('24°')).toBeInTheDocument()
  expect(screen.getByText('Sunny')).toBeInTheDocument()
})

test('the options card takes its heading and two circles from the "pick one below" stop', async () => {
  renderHome(content)
  const card = (await screen.findByRole('heading', { name: 'Aperitivo options' })).closest('section') as HTMLElement
  expect(within(card).getByRole('link', { name: 'View day' })).toHaveAttribute('href', '/day/2026-11-02')
  const circles = within(card).getAllByRole('button')
  expect(circles).toHaveLength(2)
  expect(within(card).getByText('Bar Sole')).toBeInTheDocument()
  expect(within(card).getByText('Enoteca Piccola')).toBeInTheDocument()
  expect(within(card).getByText('BS')).toBeInTheDocument()
  expect(within(card).getByText('EP')).toBeInTheDocument()
})

test('tapping an option circle opens a sheet with its details and a Walk there link', async () => {
  renderHome(content)
  const card = (await screen.findByRole('heading', { name: 'Aperitivo options' })).closest('section') as HTMLElement
  fireEvent.click(within(card).getByRole('button', { name: 'Bar Sole' }))
  const sheet = screen.getByRole('dialog', { name: 'Bar Sole' })
  expect(within(sheet).getByText(/Closest to the belvedere/)).toBeInTheDocument()
  expect(within(sheet).getByRole('link', { name: 'Walk there' })).toHaveAttribute(
    'href', expect.stringContaining('destination='),
  )
})

test('the tours row lists the day\'s booked items with their times', async () => {
  // The fixture books B01 on day one and B02 on day three; put both on the Monday so the
  // row has something to show at the clock every other test uses.
  content.bookings = content.bookings.map(b =>
    b.id === 'B01' || b.id === 'B02' ? { ...b, date: '2026-11-02' } : b)

  renderHome(content)

  const row = section('Tours')
  expect(await within(row).findByText('Trattoria Alba — dinner')).toBeInTheDocument()
  expect(within(row).getByText('Train south')).toBeInTheDocument()
  expect(within(row).getByText(/09:10/)).toBeInTheDocument()
})

test('the tours row shows its empty state when nothing is booked today', async () => {
  renderHome(content)
  expect(await within(section('Tours')).findByText('No tours today')).toBeInTheDocument()
})

test('the itineraries row shows the trip with a Now countdown and switches trip on tap', async () => {
  renderHome(content)
  const row = section('Itineraries')
  expect(await within(row).findByText('Valle')).toBeInTheDocument()
  expect(within(row).getByText('Now')).toBeInTheDocument()
  fireEvent.click(within(row).getByRole('button', { name: /Valle/ }))
  expect(await screen.findByText('Day screen')).toBeInTheDocument()
})

test('the walking row lists both V1 legs with their route title and endpoints', async () => {
  renderHome(content)
  const row = section('Walking routes')
  expect(await within(row).findAllByText('Piazza to the belvedere')).toHaveLength(2)
  const first = within(row).getAllByRole('link')[0]
  expect(first).toHaveAttribute('href', expect.stringContaining('google.com/maps/dir'))
  expect(within(row).getByText(/Piazza Grande, Valle → Caffè Nord/)).toBeInTheDocument()
})

test('reminder chips list the open todos oldest first and link to Bookings', async () => {
  renderHome(content)
  const row = section('Reminders')
  const chips = await within(row).findAllByRole('link')
  expect(chips.map(c => c.textContent)).toEqual([
    'Book Trattoria Alba — dinner by 20 Oct',
    'Book Saturday dinner — decide, then book by 27 Oct',
  ])
  fireEvent.click(chips[0])
  expect(await screen.findByText('Bookings screen')).toBeInTheDocument()
})

test('a booking already marked booked in live state drops off the reminder row', async () => {
  useBookingStateMock.mockReturnValue({
    state: { T01: { status: 'booked' } }, loading: false, save: vi.fn(),
  })
  renderHome(content)
  const chips = await within(section('Reminders')).findAllByRole('link')
  expect(chips).toHaveLength(1)
  expect(chips[0]).toHaveTextContent('Saturday dinner')
})

test('before the trip starts the header keeps today and a caption names the day being shown', async () => {
  vi.setSystemTime(PRE_TRIP)
  renderHome(content)
  expect(await screen.findByRole('heading', { name: /Tuesday 20 October/ })).toBeInTheDocument()
  expect(screen.getByText('Plans for Sunday 1 November')).toBeInTheDocument()
})

test('Home starts the ticket warm pass for the active trip', async () => {
  renderHome(content)
  await screen.findByRole('heading', { name: 'Tours' })
  expect(warmMock).toHaveBeenCalledWith('valle')
})
