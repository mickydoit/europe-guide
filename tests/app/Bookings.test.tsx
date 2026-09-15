import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'

const { saveMock, uploadMock, urlMock, removeMock, useBookingStateMock, useAttachmentsMock, useAuthMock } = vi.hoisted(() => {
  const saveMock = vi.fn().mockResolvedValue(undefined)
  const uploadMock = vi.fn().mockResolvedValue(undefined)
  const urlMock = vi.fn().mockResolvedValue('https://signed.example/file.pdf')
  const removeMock = vi.fn().mockResolvedValue(undefined)
  const useBookingStateMock = vi.fn(() => ({ state: {}, loading: false, save: saveMock }))
  const useAttachmentsMock = vi.fn(() => ({ list: [], loading: false, upload: uploadMock, url: urlMock, remove: removeMock, error: null }))
  const useAuthMock = vi.fn(() => ({ session: { user: { id: 'owner-1' } } }))
  return { saveMock, uploadMock, urlMock, removeMock, useBookingStateMock, useAttachmentsMock, useAuthMock }
})
vi.mock('../../src/lib/state', () => ({ useBookingState: useBookingStateMock, useAttachments: useAttachmentsMock }))
vi.mock('../../src/lib/auth', () => ({ useAuth: useAuthMock }))

import { Bookings } from '../../src/screens/Bookings'

const throwingClient = new Proxy({}, { get() { throw new Error('no network in tests') } }) as never

function renderBookings(content: CityContent) {
  return render(
    <MemoryRouter initialEntries={['/bookings']}>
      <TripProvider initial={{ trips: [content.trip], slug: 'valle', content }} client={throwingClient}>
        <Bookings />
      </TripProvider>
    </MemoryRouter>,
  )
}

let content: CityContent

beforeEach(async () => {
  content = await loadValle()
  useBookingStateMock.mockReturnValue({ state: {}, loading: false, save: saveMock })
  useAttachmentsMock.mockReturnValue({ list: [], loading: false, upload: uploadMock, url: urlMock, remove: removeMock, error: null })
  useAuthMock.mockReturnValue({ session: { user: { id: 'owner-1' } } })
  saveMock.mockClear()
  uploadMock.mockClear()
})

test('T01 appears under To book with a critical pill, before T02', () => {
  renderBookings(content)
  const toBookHeading = screen.getByRole('heading', { name: 'To book' })
  const section = toBookHeading.closest('section') as HTMLElement
  const rowTitles = within(section).getAllByText(/Trattoria Alba|Saturday dinner/, { exact: false })
  expect(rowTitles[0].textContent).toContain('Trattoria Alba')
  const t01Row = rowTitles[0].closest('button') as HTMLElement
  expect(within(t01Row).getByText('critical', { exact: false })).toBeInTheDocument()
})

test('B01 appears under Booked', () => {
  renderBookings(content)
  const bookedHeading = screen.getByRole('heading', { name: 'Booked' })
  const section = bookedHeading.closest('section') as HTMLElement
  expect(within(section).getByText(/Trattoria Alba/, { exact: false })).toBeInTheDocument()
})

test('opening T01 shows a tel: link and the humanised Why urgent field', () => {
  renderBookings(content)
  const toBookHeading = screen.getByRole('heading', { name: 'To book' })
  const section = toBookHeading.closest('section') as HTMLElement
  const row = within(section).getByText(/Trattoria Alba/, { exact: false }).closest('button') as HTMLElement
  fireEvent.click(row)

  const dialog = screen.getByRole('dialog')
  const tel = within(dialog).getByRole('link', { name: /\+39/ }) as HTMLAnchorElement
  expect(tel.href).toMatch(/^tel:/)
  expect(within(dialog).getByText('Why urgent')).toBeInTheDocument()
})

test('selecting status booked and pressing Save calls save with the patch', async () => {
  renderBookings(content)
  const toBookHeading = screen.getByRole('heading', { name: 'To book' })
  const section = toBookHeading.closest('section') as HTMLElement
  const row = within(section).getByText(/Trattoria Alba/, { exact: false }).closest('button') as HTMLElement
  fireEvent.click(row)

  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText('Status'), { target: { value: 'booked' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(saveMock).toHaveBeenCalledWith('T01', expect.objectContaining({ status: 'booked' })))
})

test('choosing a file calls upload with that file', async () => {
  renderBookings(content)
  const toBookHeading = screen.getByRole('heading', { name: 'To book' })
  const section = toBookHeading.closest('section') as HTMLElement
  const row = within(section).getByText(/Trattoria Alba/, { exact: false }).closest('button') as HTMLElement
  fireEvent.click(row)

  const dialog = screen.getByRole('dialog')
  const file = new File(['hello'], 'ticket.pdf', { type: 'application/pdf' })
  const input = within(dialog).getByLabelText('Add PDF or photo') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })

  await waitFor(() => expect(uploadMock).toHaveBeenCalledWith(file))
})
