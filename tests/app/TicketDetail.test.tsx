import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, test, expect } from 'vitest'
import { TripContext, TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'
import { QUEUED_COPY } from '../../src/lib/state'
import type { AttachmentRow, BookingStateRow } from '../../src/lib/state'
import { fourCells } from '../../src/lib/tickets'
import type { BookingRow } from '../../src/lib/types'

const { useBookingStateMock, useAttachmentsMock } = vi.hoisted(() => ({
  useBookingStateMock: vi.fn(() => ({
    state: {} as Record<string, BookingStateRow>,
    loading: false,
    save: vi.fn(async (_bookingId: string, _patch: Partial<Omit<BookingStateRow, 'trip' | 'booking_id' | 'updated_at'>>) => ({ queued: false })),
  })),
  useAttachmentsMock: vi.fn(() => ({ list: [] as AttachmentRow[], loading: false, upload: vi.fn(), url: vi.fn(), remove: vi.fn(), error: null as string | null, cached: new Set<string>() })),
}))
vi.mock('../../src/lib/state', () => ({ useBookingState: useBookingStateMock, useAttachments: useAttachmentsMock, useChecks: () => ({ done: new Set(), loading: false, toggle: vi.fn() }), QUEUED_COPY: 'q' }))
vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'owner-1' } } }) }))
vi.mock('../../src/lib/photos', () => ({ usePhoto: (p: string | null) => (p ? `blob:${p}` : null), warmTripPhotos: vi.fn() }))

import { TicketDetail, routeEnds } from '../../src/screens/TicketDetail'

const throwingClient = new Proxy({}, { get() { throw new Error('no network in tests') } }) as never
function mount(content: CityContent, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TripProvider initial={{ trips: [content.trip], slug: 'valle', content }} client={throwingClient}>
        <Routes><Route path="/ticket/:trip/:id" element={<TicketDetail />} /></Routes>
      </TripProvider>
    </MemoryRouter>,
  )
}
let content: CityContent
beforeEach(async () => {
  content = await loadValle()
  useBookingStateMock.mockReturnValue({ state: {}, loading: false, save: vi.fn(async () => ({ queued: false })) })
})

test('transport booking renders the boarding pass: route strip, title, cells, stub with form and attachments', () => {
  mount(content, '/ticket/valle/B02')
  const pass = screen.getByRole('article', { name: /Train south/ })
  expect(pass.className).toContain('pass')
  expect(within(pass).getByText('Tuesday 3 November')).toBeInTheDocument()
  expect(within(pass).getByText('09:10')).toBeInTheDocument()
  expect(screen.getByLabelText('Status')).toBeInTheDocument()          // BookingForm
  expect(screen.getByRole('heading', { name: 'Attachments' })).toBeInTheDocument()
})

test('event booking renders the place layout instead', () => {
  mount(content, '/ticket/valle/B01')
  expect(screen.getByRole('article', { name: /Trattoria Alba/ }).className).toContain('place-detail')
  expect(screen.getByLabelText('Status')).toBeInTheDocument()
})

test('an event booking with a photo_path shows the hero photo and credit, not the glyph', () => {
  const modified = structuredClone(content)
  const b01 = modified.bookings.find(b => b.id === 'B01')!
  b01.photo_path = 'valle/x.jpg'
  b01.photo_credit = 'Ana P.'
  mount(modified, '/ticket/valle/B01')
  const hero = document.querySelector('.place-detail__hero--event') as HTMLElement
  expect(hero.querySelector('img')).toHaveAttribute('src', 'blob:valle/x.jpg')
  expect(within(hero).getByText('Photo: Ana P.')).toBeInTheDocument()
  expect(hero.querySelector('.place-detail__glyph')).toBeNull()
})

test('unknown id shows a not-found line', () => {
  mount(content, '/ticket/valle/NOPE')
  expect(screen.getByText(/No ticket NOPE/)).toBeInTheDocument()
})

test('the boarding pass body head is the page heading', () => {
  mount(content, '/ticket/valle/B02')
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Train south')
})

test('a booking with no cost/contact/book-by/fields renders no cells grid', () => {
  // B02 in the fixture has none of those, so fourCells(B02) is empty.
  const b02 = content.bookings.find(b => b.id === 'B02')!
  expect(fourCells(b02)).toEqual([])
  mount(content, '/ticket/valle/B02')
  const pass = screen.getByRole('article', { name: /Train south/ })
  expect(pass.querySelector('.pass__cells')).toBeNull()
})

test('shows the four-cell strip built by fourCells once the booking has cost/contact/book-by', () => {
  // The fixture's B02 has none of these fields populated, so give it some here (kind stays
  // "transport" — that classification comes from the title, not from this fixture data).
  const modified = structuredClone(content)
  const b02 = modified.bookings.find(b => b.id === 'B02')!
  b02.contact = '+39 111 222 333'
  b02.book_by = '2026-10-20'
  b02.fields = { cost: '€45' }
  const cells = fourCells(b02)
  expect(cells.length).toBeGreaterThan(0)

  mount(modified, '/ticket/valle/B02')
  const pass = screen.getByRole('article', { name: /Train south/ })
  const cellsGrid = pass.querySelector('.pass__cells') as HTMLElement
  expect(cellsGrid).toBeInTheDocument()
  for (const c of cells) {
    expect(within(cellsGrid).getByText(c.key)).toBeInTheDocument()
    expect(within(cellsGrid).getByText(c.value)).toBeInTheDocument()
  }
})

test('the ref falls back to the booking id when there is no state ref or fields.ref', () => {
  mount(content, '/ticket/valle/B02')
  const pass = screen.getByRole('article', { name: /Train south/ })
  const ref = pass.querySelector('.pass__ref') as HTMLElement
  expect(ref).toHaveTextContent('B02')
})

test('the stub shows the status pill and the notes', () => {
  mount(content, '/ticket/valle/B02')
  const pass = screen.getByRole('article', { name: /Train south/ })
  const status = pass.querySelector('.pass__status') as HTMLElement
  expect(within(status).getByText('Booked')).toBeInTheDocument()
  expect(within(status).getByText(/Departs from Valle station/)).toBeInTheDocument()
})

const baseBooking: BookingRow = {
  id: 'X', trip: 'valle', kind: 'booked', title: '', date: null, time: null, priority: null,
  book_by: null, decide_by: null, contact: null, address: null, notes: null, fallback: null,
  relates_to: null, options: null, status_from_file: null, fields: {}, sort: 0, photo_path: null, photo_credit: null,
}

test('routeEnds splits an arrow-separated title', () => {
  expect(routeEnds({ ...baseBooking, title: 'A → B' })).toEqual({ from: 'A', to: 'B' })
})

test('routeEnds splits a title using the word "to"', () => {
  expect(routeEnds({ ...baseBooking, title: 'A to B' })).toEqual({ from: 'A', to: 'B' })
})

test('routeEnds splits a space-hyphen-space title like "LIS - SVQ"', () => {
  expect(routeEnds({ ...baseBooking, title: 'LIS - SVQ' })).toEqual({ from: 'LIS', to: 'SVQ' })
})

test('a title with no separator falls back to the title and the address', () => {
  expect(routeEnds({ ...baseBooking, title: 'Trattoria Alba', address: 'Via Alba 3' })).toEqual({ from: 'Trattoria Alba', to: 'Via Alba 3' })
})

test('the booking form waits for the saved state and picks it up when it lands', () => {
  // The state read is a round trip; BookingForm seeds its fields once, at mount. Mounting it
  // against an empty map used to leave the fields blank and let Save write nulls over the
  // stored ref/cost/notes.
  useBookingStateMock.mockReturnValue({ state: {}, loading: true, save: vi.fn(async () => ({ queued: false })) })
  const { rerender } = mount(content, '/ticket/valle/B02')
  expect(screen.queryByLabelText('Status')).toBeNull()

  useBookingStateMock.mockReturnValue({
    state: {
      B02: {
        trip: 'valle', booking_id: 'B02', status: 'confirmed', confirmation_ref: 'ABC123',
        cost: 42, currency: 'EUR', notes: 'n', updated_at: '2026-09-16T00:00:00Z',
      },
    },
    loading: false,
    save: vi.fn(async () => ({ queued: false })),
  })
  rerender(
    <MemoryRouter initialEntries={['/ticket/valle/B02']}>
      <TripProvider initial={{ trips: [content.trip], slug: 'valle', content }} client={throwingClient}>
        <Routes><Route path="/ticket/:trip/:id" element={<TicketDetail />} /></Routes>
      </TripProvider>
    </MemoryRouter>,
  )
  expect(screen.getByLabelText('Confirmation ref')).toHaveValue('ABC123')
  expect(screen.getByLabelText('Status')).toHaveValue('confirmed')
})

test('a cold deep link into another trip switches the trip context to the one in the path', () => {
  const other = { ...content.trip, slug: 'other', name: 'Other' }
  const setSlug = vi.fn()
  const value = {
    trips: [content.trip, other], slug: 'valle', content, loading: false, offline: false,
    error: null, setSlug, refresh: vi.fn(async () => {}),
  }
  render(
    <MemoryRouter initialEntries={['/ticket/other/B02']}>
      <TripContext.Provider value={value}>
        <Routes><Route path="/ticket/:trip/:id" element={<TicketDetail />} /></Routes>
      </TripContext.Provider>
    </MemoryRouter>,
  )
  expect(setSlug).toHaveBeenCalledWith('other')
  // ...and until that trip's content arrives it says Loading, not "No ticket".
  expect(screen.getByText(/Loading/)).toBeInTheDocument()
  expect(screen.queryByText(/No ticket/)).toBeNull()
})

test('a save does not remount BookingForm and lose its queued message or the typed edit', async () => {
  // useBookingState().save commits an optimistic row with a fresh updated_at synchronously,
  // before the write resolves. If BookingForm is keyed on that timestamp, the owner's own
  // save remounts it mid-handleSave and the "Saved"/queued message lands on a dead instance.
  let currentState: Record<string, BookingStateRow> = {
    B02: {
      trip: 'valle', booking_id: 'B02', status: 'booked', confirmation_ref: null,
      cost: null, currency: null, notes: null, updated_at: '2026-09-01T00:00:00Z',
    },
  }
  const saveMock = vi.fn(async (bookingId: string, patch: Partial<Omit<BookingStateRow, 'trip' | 'booking_id' | 'updated_at'>>) => {
    currentState = { ...currentState, [bookingId]: { ...currentState[bookingId], ...patch, updated_at: '2026-09-01T00:00:01Z' } }
    return { queued: true }
  })
  useBookingStateMock.mockImplementation(() => ({ state: currentState, loading: false, save: saveMock }))

  const { rerender } = mount(content, '/ticket/valle/B02')
  fireEvent.change(screen.getByLabelText('Confirmation ref'), { target: { value: 'ZZ9' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.getByText(QUEUED_COPY)).toBeInTheDocument())

  // The optimistic commit already landed (currentState carries the new updated_at); rerender
  // to pick it up, the way the real hook's own setState would trigger a re-render.
  rerender(
    <MemoryRouter initialEntries={['/ticket/valle/B02']}>
      <TripProvider initial={{ trips: [content.trip], slug: 'valle', content }} client={throwingClient}>
        <Routes><Route path="/ticket/:trip/:id" element={<TicketDetail />} /></Routes>
      </TripProvider>
    </MemoryRouter>,
  )

  expect(screen.getByLabelText('Confirmation ref')).toHaveValue('ZZ9')
  expect(screen.getByText(QUEUED_COPY)).toHaveClass('form__msg--queued')
})

test('routeEnds prefers explicit from/to fields over the title', () => {
  const b = { ...content.bookings.find(x => x.id === 'B02')!, title: 'Ryanair FR3628 LIS → SVQ', fields: { from: 'LIS', to: 'SVQ' } }
  expect(routeEnds(b)).toEqual({ from: 'LIS', to: 'SVQ' })
})

test('a flight with from/to/arrives/ref fields fills both ends of the route strip and the ref', () => {
  const modified = structuredClone(content)
  const b02 = modified.bookings.find(x => x.id === 'B02')!
  b02.title = 'Ryanair FR3628 LIS → SVQ'
  b02.fields = { ref: 'S151VF', from: 'LIS', to: 'SVQ', arrives: '10:00', seats: '21A, 21B' }
  mount(modified, '/ticket/valle/B02')
  const pass = screen.getByRole('article', { name: /Ryanair/ })
  expect(within(pass).getByText('LIS')).toBeInTheDocument()
  expect(within(pass).getByText('SVQ')).toBeInTheDocument()
  expect(within(pass).getByText('09:10')).toBeInTheDocument()
  expect(within(pass).getByText('Arrives')).toBeInTheDocument()
  expect(within(pass).getByText('10:00')).toBeInTheDocument()
  expect(within(pass).getByText('S151VF')).toBeInTheDocument()
  expect(within(pass).getByText('Seats')).toBeInTheDocument()
  expect(within(pass).queryByText('From')).toBeNull()   // route fields never appear as cells
})
