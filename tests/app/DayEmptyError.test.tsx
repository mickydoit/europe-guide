import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi } from 'vitest'

// I4: error must be checked before the "no trips yet" empty state. useTrip is mocked
// directly here (rather than driven through a failing TripProvider fetch) because the
// scenario under test is a pure render-order concern, not a data-loading one.
const { useTripMock } = vi.hoisted(() => ({
  useTripMock: vi.fn(() => ({
    trips: [], slug: null, content: null, error: 'load trips: boom', loading: false, offline: false,
    setSlug: vi.fn(), refresh: vi.fn(),
  })),
}))
vi.mock('../../src/lib/trip', () => ({ useTrip: useTripMock }))

import { Day } from '../../src/screens/Day'

test('renders the error text (not "No trips yet") when error is set and trips is empty', () => {
  render(
    <MemoryRouter initialEntries={['/day']}>
      <Routes>
        <Route path="/day" element={<Day />} />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByText('load trips: boom')).toBeInTheDocument()
  expect(screen.queryByText(/No trips yet/)).toBeNull()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
})
