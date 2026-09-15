import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'

const { useAuthMock, downloadIcsMock } = vi.hoisted(() => {
  const useAuthMock = vi.fn(() => ({ session: { user: { email: 'owner@example.com' } }, signOut: vi.fn() }))
  const downloadIcsMock = vi.fn()
  return { useAuthMock, downloadIcsMock }
})
vi.mock('../../src/lib/auth', () => ({ useAuth: useAuthMock }))
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
