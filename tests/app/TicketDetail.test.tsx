import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, test, expect } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'
import type { AttachmentRow } from '../../src/lib/state'
import { fourCells } from '../../src/lib/tickets'
import type { BookingRow } from '../../src/lib/types'

const { useBookingStateMock, useAttachmentsMock } = vi.hoisted(() => ({
  useBookingStateMock: vi.fn(() => ({ state: {}, loading: false, save: vi.fn(async () => ({ queued: false })) })),
  useAttachmentsMock: vi.fn(() => ({ list: [] as AttachmentRow[], loading: false, upload: vi.fn(), url: vi.fn(), remove: vi.fn(), error: null as string | null, cached: new Set<string>() })),
}))
vi.mock('../../src/lib/state', () => ({ useBookingState: useBookingStateMock, useAttachments: useAttachmentsMock, useChecks: () => ({ done: new Set(), loading: false, toggle: vi.fn() }), QUEUED_COPY: 'q' }))
vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'owner-1' } } }) }))

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
beforeEach(async () => { content = await loadValle() })

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
  relates_to: null, options: null, status_from_file: null, fields: {}, sort: 0,
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
