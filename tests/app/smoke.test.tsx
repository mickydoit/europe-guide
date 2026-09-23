import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

const trip = {
  slug: 'valle', name: 'Valle', country: 'Italy', country_code: 'it',
  start_date: '2026-11-01', end_date: '2026-11-03', base: null,
  timezone: 'UTC', intro: null, sort: 0,
}

// One trip and nothing else, so `/` has enough to render the real Home screen.
const area = {
  trip: 'valle', seq: 0, name: 'Valle centre', min_lng: 0, min_lat: 0, max_lng: 1, max_lat: 1,
  pmtiles_path: 'valle/0.pmtiles', size_bytes: 1_000_000, built_at: '2026-01-01',
}

function chain(table: string): Record<string, unknown> {
  const data = table === 'trips' ? [trip] : table === 'offline_areas' ? [area] : []
  const q: Record<string, unknown> = {
    select: () => q, eq: () => q, order: () => q, limit: () => q, like: () => q,
    then: (res: (v: { data: unknown[]; error: null }) => void) => res({ data, error: null }),
  }
  return q
}
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { email: 'x@y.z' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (table: string) => chain(table),
  },
}))
import App from '../../src/App'

test('/ renders the Home screen and shows five tabs', async () => {
  render(<MemoryRouter><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Reminders' })).toBeInTheDocument()
  expect(within(screen.getByRole('navigation')).getAllByRole('link')).toHaveLength(5)
})

// jsdom has no Cache API, so nothing reads as saved — which is the state this dot is for.
test('the Map tab is dotted while a city ahead has no offline map saved', async () => {
  const { container } = render(<MemoryRouter><App /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Tickets' })
  await waitFor(() => expect(container.querySelector('.tabbar__dot')).not.toBeNull())
  expect(screen.getByRole('link', { name: 'Map — offline map not downloaded' })).toBeInTheDocument()
})
