import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'

const { useAuthMock, downloadIcsMock, useSyncMock, useOutboxOpsMock, flushOutboxMock, retryFailedMock } = vi.hoisted(() => {
  const useAuthMock = vi.fn(() => ({ session: { user: { email: 'owner@example.com' } }, signOut: vi.fn() }))
  const downloadIcsMock = vi.fn()
  const retryFailedMock = vi.fn().mockResolvedValue(undefined)
  const useSyncMock = vi.fn(() => ({ pending: 0, failed: 0, syncing: false, lastError: undefined as string | undefined, retryFailed: retryFailedMock }))
  const useOutboxOpsMock = vi.fn(() => [] as Array<{ id: string; kind: string; status: string }>)
  const flushOutboxMock = vi.fn().mockResolvedValue({ done: 0, remaining: 0, failed: 0 })
  return { useAuthMock, downloadIcsMock, useSyncMock, useOutboxOpsMock, flushOutboxMock, retryFailedMock }
})
vi.mock('../../src/lib/auth', () => ({ useAuth: useAuthMock }))
vi.mock('../../src/lib/sync', () => ({ useSync: useSyncMock, useOutboxOps: useOutboxOpsMock, flushOutbox: flushOutboxMock }))
vi.mock('../../src/lib/ics', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/ics')>()
  return { ...actual, downloadIcs: downloadIcsMock }
})

import { More } from '../../src/screens/More'

const throwingClient = new Proxy({}, { get() { throw new Error('no network in tests') } }) as never

function renderMore(content: CityContent) {
  return render(
    <MemoryRouter initialEntries={['/more']}>
      <TripProvider initial={{ trips: [content.trip], slug: 'valle', content }} client={throwingClient}>
        <More />
      </TripProvider>
    </MemoryRouter>,
  )
}

let content: CityContent

beforeEach(async () => {
  content = await loadValle()
  useSyncMock.mockReturnValue({ pending: 0, failed: 0, syncing: false, lastError: undefined, retryFailed: retryFailedMock })
  useOutboxOpsMock.mockReturnValue([])
  flushOutboxMock.mockClear()
  retryFailedMock.mockClear()
})

test('no Pending changes section when the outbox is empty', async () => {
  renderMore(content)
  await screen.findByRole('heading', { name: 'More' })
  expect(screen.queryByRole('heading', { name: 'Pending changes' })).toBeNull()
})

test('Pending changes lists the queued ops by kind with Sync now, and Retry failed once one has given up', async () => {
  useSyncMock.mockReturnValue({ pending: 2, failed: 1, syncing: false, lastError: 'Load failed', retryFailed: retryFailedMock })
  useOutboxOpsMock.mockReturnValue([
    { id: '1', kind: 'check_set', status: 'pending' },
    { id: '2', kind: 'check_set', status: 'pending' },
    { id: '3', kind: 'attachment_upload', status: 'failed' },
  ])
  renderMore(content)
  const heading = await screen.findByRole('heading', { name: 'Pending changes' })
  const section = heading.closest('section') as HTMLElement
  expect(within(section).getByText('2 checks', { exact: false })).toBeInTheDocument()
  expect(within(section).getByText('1 upload', { exact: false })).toBeInTheDocument()
  expect(within(section).getByText('Load failed', { exact: false })).toBeInTheDocument()

  fireEvent.click(within(section).getByRole('button', { name: 'Sync now' }))
  expect(flushOutboxMock).toHaveBeenCalled()
  fireEvent.click(within(section).getByRole('button', { name: 'Retry failed' }))
  expect(retryFailedMock).toHaveBeenCalled()
})

test('the Retry failed button is absent while nothing has given up', async () => {
  useSyncMock.mockReturnValue({ pending: 1, failed: 0, syncing: false, lastError: undefined, retryFailed: retryFailedMock })
  useOutboxOpsMock.mockReturnValue([{ id: '1', kind: 'day_notes', status: 'pending' }])
  renderMore(content)
  await screen.findByRole('heading', { name: 'Pending changes' })
  expect(screen.getByRole('button', { name: 'Sync now' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Retry failed' })).toBeNull()
})

test('lists three parked venues', async () => {
  renderMore(content)
  const heading = await screen.findByRole('heading', { name: 'Parked venues' })
  const section = heading.closest('section') as HTMLElement
  expect(within(section).getByText('Castello Alto', { exact: false })).toBeInTheDocument()
  expect(within(section).getByText('Museo Civico', { exact: false })).toBeInTheDocument()
  expect(within(section).getByText('Giardino Botanico', { exact: false })).toBeInTheDocument()
})

test('lists three standing notes under "Standing notes"', async () => {
  renderMore(content)
  const heading = await screen.findByRole('heading', { name: 'Standing notes' })
  const section = heading.closest('section') as HTMLElement
  expect(within(section).getAllByText('Cash:', { exact: false }).length).toBeGreaterThan(0)
  expect(within(section).getAllByText('Sunsets:', { exact: false }).length).toBeGreaterThan(0)
  expect(within(section).getAllByText('funicular', { exact: false }).length).toBeGreaterThan(0)
})

test('has a Sign out button', async () => {
  renderMore(content)
  expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument()
})

test('has a Refresh data button that does not throw when clicked', async () => {
  renderMore(content)
  const btn = await screen.findByRole('button', { name: 'Refresh data' })
  expect(() => fireEvent.click(btn)).not.toThrow()
})

test('has an enabled Export calendar button that calls downloadIcs with the trip ics', async () => {
  downloadIcsMock.mockClear()
  renderMore(content)
  const btn = await screen.findByRole('button', { name: /Export .* calendar \(\.ics\)/ })
  expect(btn).toBeEnabled()
  fireEvent.click(btn)
  expect(downloadIcsMock).toHaveBeenCalledTimes(1)
  const [filename, text] = downloadIcsMock.mock.calls[0]
  expect(filename).toBe('europe-2026-valle.ics')
  expect(text).toContain('BEGIN:VCALENDAR')
})
