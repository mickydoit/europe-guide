import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent, TripRow } from '../../src/lib/types'

const { useBookingStateMock, saveMock } = vi.hoisted(() => ({ useBookingStateMock: vi.fn(), saveMock: vi.fn(async () => ({ queued: false })) }))
vi.mock('../../src/lib/state', () => ({ useBookingState: useBookingStateMock, QUEUED_COPY: 'Saved on this phone — will sync when online' }))
vi.mock('../../src/lib/sync', () => ({ useSync: () => ({ pending: 0, failed: 0, syncing: false, lastError: undefined, retryFailed: vi.fn() }) }))

import { Tickets } from '../../src/screens/Tickets'
import { bookingsRedirect } from '../../src/App'

const throwingClient = new Proxy({}, { get() { throw new Error('no network in tests') } }) as never

function mount(content: CityContent, trips: TripRow[] = [content.trip]) {
  return render(
    <MemoryRouter initialEntries={['/tickets']}>
      <TripProvider initial={{ trips, slug: 'valle', content }} client={throwingClient}>
        <Routes>
          <Route path="/tickets" element={<Tickets />} />
          <Route path="/ticket/:trip/:id" element={<p>Ticket screen</p>} />
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
  vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-20T08:00:00Z'))
})
afterEach(() => vi.useRealTimers())

test('country tabs from trips; city chips only when a country has several trips', () => {
  const es1 = { ...content.trip, slug: 'seville', name: 'Seville', country: 'Spain', country_code: 'es', sort: 2 }
  const es2 = { ...content.trip, slug: 'barcelona', name: 'Barcelona', country: 'Spain', country_code: 'es', sort: 3 }
  mount(content, [content.trip, es1, es2])
  const tabs = screen.getByRole('group', { name: 'Country' })
  expect(within(tabs).getAllByRole('button').map(t => t.textContent)).toEqual([content.trip.country, 'Spain'])
  expect(screen.queryByRole('group', { name: 'City' })).toBeNull()
  fireEvent.click(within(tabs).getByRole('button', { name: 'Spain' }))
  const cities = screen.getByRole('group', { name: 'City' })
  expect(within(cities).getAllByRole('button').map(t => t.textContent)).toEqual(['Seville', 'Barcelona'])
})

test('bookings grouped by day with headers, walk-ins absent, cards link to detail', () => {
  mount(content)
  expect(screen.getByRole('heading', { name: 'Sunday 1 November' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Tuesday 3 November' })).toBeInTheDocument()
  const walkin = content.bookings.find(b => b.kind === 'walkin')
  if (walkin) expect(screen.queryByText(walkin.title)).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: /Train south/ }))
  expect(screen.getByText('Ticket screen')).toBeInTheDocument()
})

test('tapping the status pill cycles through save()', () => {
  mount(content)
  const card = screen.getByRole('link', { name: /Train south/ }).closest('.ticket-card') as HTMLElement   // the status button is a sibling of the link, not inside it
  fireEvent.click(within(card).getByRole('button', { name: /Status/ }))
  expect(saveMock).toHaveBeenCalledWith('B02', { status: 'confirmed' })
})

test('earlier days collapse once the trip is underway', () => {
  vi.setSystemTime(new Date('2026-11-03T08:00:00Z'))
  mount(content)
  expect(screen.getByRole('button', { name: /earlier day/ })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Sunday 1 November' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /earlier day/ }))
  expect(screen.getByRole('heading', { name: 'Sunday 1 November' })).toBeInTheDocument()
})

test('/bookings redirects to /tickets', () => {
  // App wraps everything in AuthProvider/RequireAuth; only the redirect is under test here.
  render(
    <MemoryRouter initialEntries={['/bookings']}>
      <Routes>
        <Route path="/bookings" element={bookingsRedirect} />
        <Route path="/tickets" element={<p>Tickets screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByText('Tickets screen')).toBeInTheDocument()
})
