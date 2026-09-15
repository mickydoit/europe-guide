import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'
import type { AttachmentRow } from '../../src/lib/state'

const { saveMock, uploadMock, urlMock, removeMock, useBookingStateMock, useAttachmentsMock, useAuthMock } = vi.hoisted(() => {
  const saveMock = vi.fn().mockResolvedValue(undefined)
  const uploadMock = vi.fn().mockResolvedValue(undefined)
  const urlMock = vi.fn().mockResolvedValue('https://signed.example/file.pdf')
  const removeMock = vi.fn().mockResolvedValue(undefined)
  const useBookingStateMock = vi.fn(() => ({ state: {}, loading: false, save: saveMock }))
  const useAttachmentsMock = vi.fn(() => ({ list: [] as AttachmentRow[], loading: false, upload: uploadMock, url: urlMock, remove: removeMock, error: null as string | null }))
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

test('B01 appears under Booked with a Booked pill', () => {
  renderBookings(content)
  const bookedHeading = screen.getByRole('heading', { name: 'Booked' })
  const section = bookedHeading.closest('section') as HTMLElement
  const nameEl = within(section).getByText(/Trattoria Alba/, { exact: false })
  expect(nameEl).toBeInTheDocument()
  const row = nameEl.closest('button') as HTMLElement
  expect(within(row).getByText('Booked')).toBeInTheDocument()
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
  expect(tel.getAttribute('href')).toBe('tel:+390123456789')
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

test('opening an attachment opens the window synchronously before the signed url resolves (iOS popup safety)', async () => {
  let resolveUrl: (v: string) => void = () => {}
  urlMock.mockImplementationOnce(() => new Promise<string>(resolve => { resolveUrl = resolve }))
  const attachment = {
    id: 'a1', trip: 'valle', booking_id: 'T01', storage_path: 'p/ticket.pdf',
    filename: 'ticket.pdf', mime: 'application/pdf', size: 1234, uploaded_at: '2026-01-01',
  }
  useAttachmentsMock.mockReturnValue({ list: [attachment], loading: false, upload: uploadMock, url: urlMock, remove: removeMock, error: null })
  const fakeWindow = { location: { href: '' }, close: vi.fn() }
  const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWindow as unknown as Window)

  renderBookings(content)
  const toBookHeading = screen.getByRole('heading', { name: 'To book' })
  const section = toBookHeading.closest('section') as HTMLElement
  const row = within(section).getByText(/Trattoria Alba/, { exact: false }).closest('button') as HTMLElement
  fireEvent.click(row)

  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'ticket.pdf' }))

  // window.open must already have been called before the mocked url() resolves.
  expect(openSpy).toHaveBeenCalledTimes(1)
  expect(openSpy).toHaveBeenCalledWith('', '_blank', 'noopener')
  expect(urlMock).toHaveBeenCalledWith(attachment)

  resolveUrl('https://signed.example/ticket.pdf')
  await waitFor(() => expect(fakeWindow.location.href).toBe('https://signed.example/ticket.pdf'))

  openSpy.mockRestore()
})

test('a rejected attachment delete surfaces an inline error in the sheet', async () => {
  removeMock.mockRejectedValueOnce(new Error('network down'))
  const attachment = {
    id: 'a1', trip: 'valle', booking_id: 'T01', storage_path: 'p/ticket.pdf',
    filename: 'ticket.pdf', mime: 'application/pdf', size: 1234, uploaded_at: '2026-01-01',
  }
  useAttachmentsMock.mockReturnValue({ list: [attachment], loading: false, upload: uploadMock, url: urlMock, remove: removeMock, error: null })
  vi.spyOn(window, 'confirm').mockReturnValue(true)

  renderBookings(content)
  const toBookHeading = screen.getByRole('heading', { name: 'To book' })
  const section = toBookHeading.closest('section') as HTMLElement
  const row = within(section).getByText(/Trattoria Alba/, { exact: false }).closest('button') as HTMLElement
  fireEvent.click(row)

  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

  expect(await within(dialog).findByText('network down')).toBeInTheDocument()
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

test('a queued save shows the accent "saved on this phone" message instead of "Saved"', async () => {
  saveMock.mockResolvedValueOnce({ queued: true })
  renderBookings(content)
  const section = screen.getByRole('heading', { name: 'To book' }).closest('section') as HTMLElement
  fireEvent.click(within(section).getByText(/Trattoria Alba/, { exact: false }).closest('button') as HTMLElement)

  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

  const msg = await within(dialog).findByText('Saved on this phone — will sync when online')
  expect(msg).toHaveClass('form__msg--queued')
})

test('a queued upload shows the same message and the file input stays usable', async () => {
  uploadMock.mockResolvedValueOnce({ queued: true })
  renderBookings(content)
  const section = screen.getByRole('heading', { name: 'To book' }).closest('section') as HTMLElement
  fireEvent.click(within(section).getByText(/Trattoria Alba/, { exact: false }).closest('button') as HTMLElement)

  const dialog = screen.getByRole('dialog')
  const input = within(dialog).getByLabelText('Add PDF or photo') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['hi'], 'ticket.pdf', { type: 'application/pdf' })] } })

  expect(await within(dialog).findByText('Saved on this phone — will sync when online')).toBeInTheDocument()
  expect(input.disabled).toBe(false)
})

test('a pending attachment row is tagged "waiting to upload"', async () => {
  useAttachmentsMock.mockReturnValue({
    list: [{
      id: 'pending:owner-1/valle/T01/1-ticket.pdf', trip: 'valle', booking_id: 'T01',
      storage_path: 'owner-1/valle/T01/1-ticket.pdf', filename: 'ticket.pdf',
      mime: 'application/pdf', size: 1234, uploaded_at: '2026-01-01', pendingUpload: true,
    }],
    loading: false, upload: uploadMock, url: urlMock, remove: removeMock, error: null,
  })
  renderBookings(content)
  const section = screen.getByRole('heading', { name: 'To book' }).closest('section') as HTMLElement
  fireEvent.click(within(section).getByText(/Trattoria Alba/, { exact: false }).closest('button') as HTMLElement)

  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText('waiting to upload')).toBeInTheDocument()
})
