import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'
import type { AttachmentRow } from '../../src/lib/state'

const { uploadMock, urlMock, removeMock, useAttachmentsMock, useAuthMock } = vi.hoisted(() => {
  const uploadMock = vi.fn().mockResolvedValue({ queued: false })
  const urlMock = vi.fn().mockResolvedValue('https://signed.example/file.pdf')
  const removeMock = vi.fn().mockResolvedValue(undefined)
  const useAttachmentsMock = vi.fn(() => ({ list: [] as AttachmentRow[], loading: false, upload: uploadMock, url: urlMock, remove: removeMock, error: null as string | null, cached: new Set<string>() }))
  const useAuthMock = vi.fn(() => ({ session: { user: { id: 'owner-1' } } as { user: { id: string } } | null }))
  return { uploadMock, urlMock, removeMock, useAttachmentsMock, useAuthMock }
})
vi.mock('../../src/lib/state', () => ({ useAttachments: useAttachmentsMock, QUEUED_COPY: 'Saved on this phone — will sync when online' }))
vi.mock('../../src/lib/auth', () => ({ useAuth: useAuthMock }))

import { AttachmentsPanel } from '../../src/components/AttachmentsPanel'

function mount() {
  return render(<AttachmentsPanel tripSlug="valle" bookingId="T01" />)
}

const baseAttachment = { id: 'a1', trip: 'valle', booking_id: 'T01', storage_path: 'p/ticket.pdf', filename: 'ticket.pdf', mime: 'application/pdf', size: 1234, uploaded_at: '2026-01-01' }

beforeEach(() => {
  useAttachmentsMock.mockReturnValue({ list: [], loading: false, upload: uploadMock, url: urlMock, remove: removeMock, error: null, cached: new Set<string>() })
  useAuthMock.mockReturnValue({ session: { user: { id: 'owner-1' } } })
  uploadMock.mockClear()
  urlMock.mockClear()
  removeMock.mockClear()
})

test('renders nothing when there is no signed-in owner', () => {
  useAuthMock.mockReturnValue({ session: null })
  const { container } = mount()
  expect(container).toBeEmptyDOMElement()
})

test('opening an attachment opens the window synchronously before the signed url resolves (iOS popup safety)', async () => {
  let resolveUrl: (v: string) => void = () => {}
  urlMock.mockImplementationOnce(() => new Promise<string>(resolve => { resolveUrl = resolve }))
  useAttachmentsMock.mockReturnValue({ list: [baseAttachment], loading: false, upload: uploadMock, url: urlMock, remove: removeMock, error: null, cached: new Set<string>() })
  const fakeWindow = { location: { href: '' }, close: vi.fn() }
  const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWindow as unknown as Window)

  mount()
  fireEvent.click(screen.getByRole('button', { name: 'ticket.pdf' }))

  // window.open must already have been called before the mocked url() resolves.
  expect(openSpy).toHaveBeenCalledTimes(1)
  expect(openSpy).toHaveBeenCalledWith('', '_blank', 'noopener')
  expect(urlMock).toHaveBeenCalledWith(baseAttachment)

  resolveUrl('https://signed.example/ticket.pdf')
  await waitFor(() => expect(fakeWindow.location.href).toBe('https://signed.example/ticket.pdf'))

  openSpy.mockRestore()
})

test('a rejected attachment delete surfaces an inline error', async () => {
  removeMock.mockRejectedValueOnce(new Error('network down'))
  useAttachmentsMock.mockReturnValue({ list: [baseAttachment], loading: false, upload: uploadMock, url: urlMock, remove: removeMock, error: null, cached: new Set<string>() })
  vi.spyOn(window, 'confirm').mockReturnValue(true)

  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

  expect(await screen.findByText('network down')).toBeInTheDocument()
})

test('choosing a file calls upload with that file', async () => {
  mount()
  const file = new File(['hello'], 'ticket.pdf', { type: 'application/pdf' })
  const input = screen.getByLabelText('Add PDF or photo') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })

  await waitFor(() => expect(uploadMock).toHaveBeenCalledWith(file))
})

test('a queued upload shows the queued message and the file input stays usable', async () => {
  uploadMock.mockResolvedValueOnce({ queued: true })
  mount()
  const input = screen.getByLabelText('Add PDF or photo') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['hi'], 'ticket.pdf', { type: 'application/pdf' })] } })

  expect(await screen.findByText('Saved on this phone — will sync when online')).toBeInTheDocument()
  expect(input.disabled).toBe(false)
})

test('the file input is disabled while attachments are loading, with a caption', () => {
  useAttachmentsMock.mockReturnValue({ list: [], loading: true, upload: uploadMock, url: urlMock, remove: removeMock, error: null, cached: new Set<string>() })
  mount()
  const input = screen.getByLabelText('Add PDF or photo') as HTMLInputElement
  expect(input.disabled).toBe(true)
  expect(screen.getByText('Loading attachments…')).toBeInTheDocument()
})

test('a pending attachment row is tagged "waiting to upload"', () => {
  useAttachmentsMock.mockReturnValue({
    list: [{ ...baseAttachment, id: 'pending:owner-1/valle/T01/1-ticket.pdf', storage_path: 'owner-1/valle/T01/1-ticket.pdf', pendingUpload: true }],
    loading: false, upload: uploadMock, url: urlMock, remove: removeMock, error: null, cached: new Set<string>(),
  })
  mount()
  expect(screen.getByText('waiting to upload')).toBeInTheDocument()
})

test('a cached attachment row is tagged "offline"', () => {
  useAttachmentsMock.mockReturnValue({ list: [baseAttachment], loading: false, upload: uploadMock, url: urlMock, remove: removeMock, error: null, cached: new Set(['a1']) })
  mount()
  expect(screen.getByText('offline')).toBeInTheDocument()
})

test('a row not yet cached shows no "offline" pill', () => {
  useAttachmentsMock.mockReturnValue({ list: [baseAttachment], loading: false, upload: uploadMock, url: urlMock, remove: removeMock, error: null, cached: new Set<string>() })
  mount()
  expect(screen.queryByText('offline')).toBeNull()
})
