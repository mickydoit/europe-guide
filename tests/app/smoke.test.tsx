import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

function chain(): Record<string, unknown> {
  const q: Record<string, unknown> = {
    select: () => q, eq: () => q, order: () => q, limit: () => q,
    then: (res: (v: { data: unknown[]; error: null }) => void) => res({ data: [], error: null }),
  }
  return q
}
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { email: 'x@y.z' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => chain(),
  },
}))
import App from '../../src/App'

test('renders the Home placeholder and five tabs', async () => {
  render(<MemoryRouter><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
  expect(screen.getAllByRole('link')).toHaveLength(5)
})
