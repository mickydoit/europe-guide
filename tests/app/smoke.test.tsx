import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

const trip = {
  slug: 'valle', name: 'Valle', country: 'Italy', country_code: 'it',
  start_date: '2026-11-01', end_date: '2026-11-03', base: null,
  timezone: 'UTC', intro: null, sort: 0,
}

// One trip and nothing else, so `/` has enough to render the real Home screen.
function chain(table: string): Record<string, unknown> {
  const data = table === 'trips' ? [trip] : []
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
