import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, test, expect } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'
import type { AttachmentRow } from '../../src/lib/state'

const { useBookingStateMock, useAttachmentsMock } = vi.hoisted(() => ({
  useBookingStateMock: vi.fn(() => ({ state: {}, loading: false, save: vi.fn(async () => ({ queued: false })) })),
  useAttachmentsMock: vi.fn(() => ({ list: [] as AttachmentRow[], loading: false, upload: vi.fn(), url: vi.fn(), remove: vi.fn(), error: null as string | null, cached: new Set<string>() })),
}))
vi.mock('../../src/lib/state', () => ({ useBookingState: useBookingStateMock, useAttachments: useAttachmentsMock, useChecks: () => ({ done: new Set(), loading: false, toggle: vi.fn() }), QUEUED_COPY: 'q' }))
vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'owner-1' } } }) }))

import { TicketDetail } from '../../src/screens/TicketDetail'

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
