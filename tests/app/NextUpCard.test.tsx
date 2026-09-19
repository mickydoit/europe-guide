import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NextUpCard } from '../../src/components/NextUpCard'
import type { BookingRow } from '../../src/lib/types'

const booking: BookingRow = {
  id: 'B01', trip: 'lisbon', kind: 'booked', title: 'Mesa de Frades — fado show with dinner', date: '2026-09-30', time: '21:30',
  priority: null, book_by: null, decide_by: null, contact: '+351 917029436', address: 'R. dos Remédios 139, Lisboa',
  notes: null, fallback: null, relates_to: null, options: null, status_from_file: 'confirmed',
  fields: { ref: 'ACO-T146090738' }, sort: 1, photo_path: null, photo_credit: null,
}

test('the card leads with the name, not the booking reference', () => {
  render(<MemoryRouter><NextUpCard booking={booking} kind="event" date="2026-09-30" to="/tickets/B01" /></MemoryRouter>)
  expect(screen.getByText('Mesa de Frades — fado show with dinner')).toHaveClass('nextup__name')
  expect(screen.queryByText('ACO-T146090738')).toBeNull()
  expect(screen.getByText(/R\. dos Remédios 139/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Call Mesa de Frades — fado show with dinner' })).toHaveAttribute('href', 'tel:+351917029436')
})
