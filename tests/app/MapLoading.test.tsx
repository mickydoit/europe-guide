import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { test, expect } from 'vitest'
import { MapLoading } from '../../src/components/MapLoading'

// TabBar returns null on /map, and the map's own Close button lives inside the chunk that has
// not arrived — so without a control here the owner is stranded with nothing tappable.
test('the map loading screen offers a way back out', () => {
  render(<MemoryRouter><MapLoading /></MemoryRouter>)
  const out = screen.getByRole('link', { name: /close|back/i })
  expect(out).toHaveAttribute('href', '/')
})

test('it still says the map is loading', () => {
  render(<MemoryRouter><MapLoading /></MemoryRouter>)
  expect(screen.getByText(/loading map/i)).toBeInTheDocument()
})
