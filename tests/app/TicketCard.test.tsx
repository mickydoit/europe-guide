import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { test, expect, vi } from 'vitest'
import { TicketCard } from '../../src/components/TicketCard'
import { StatusPill } from '../../src/components/StatusPill'
import type { BookingRow } from '../../src/lib/types'

vi.mock('../../src/lib/photos', () => ({ usePhoto: (p: string | null) => (p ? `blob:${p}` : null), warmTripPhotos: vi.fn() }))

const booking: BookingRow = {
  id: 'T04', trip: 'seville', kind: 'todo', title: 'AVE Seville → Barcelona', date: '2026-10-07', time: '08:45', priority: 'critical',
  book_by: '2026-09-17', decide_by: null, contact: null, address: null, notes: null, fallback: null, relates_to: null, options: null,
  status_from_file: 'not booked', fields: { cost: '€120 for two' }, sort: 3, photo_path: null, photo_credit: null,
}

test('transport card: teal tone, Poppins title, lines, icon, link', () => {
  render(<MemoryRouter><TicketCard booking={booking} kind="transport" status="not_booked" to="/ticket/seville/T04" /></MemoryRouter>)
  const link = screen.getByRole('link', { name: /AVE Seville/ })
  expect(link).toHaveAttribute('href', '/ticket/seville/T04')
  expect(link.closest('.ticket-card')!.className).toContain('ticket-card--transport')
  expect(screen.getByText('Departs')).toBeInTheDocument()
  expect(screen.getByText('08:45')).toBeInTheDocument()
  expect(screen.getByText('€120 for two')).toBeInTheDocument()
  expect(link.querySelector('.ticket-card__icon')).toBeNull()   // the faded 72px art is gone from cards
  const badges = link.closest('.ticket-card')!.querySelector('.ticket-card__badges')!
  expect(badges.querySelector('.badge--kind')).not.toBeNull()
  expect(badges.querySelector('.badge--status')!.className).toContain('badge--todo')
  expect(screen.getByText('Not booked')).toBeInTheDocument()
})

test('tone override and status tap', () => {
  const cycle = vi.fn()
  render(<MemoryRouter><TicketCard booking={booking} kind="event" status="booked" tone="highlight" to="/x" onCycleStatus={cycle} /></MemoryRouter>)
  expect(screen.getByRole('link').closest('.ticket-card')!.className).toContain('ticket-card--highlight')
  fireEvent.click(screen.getByRole('button', { name: /Booked/ }))
  expect(cycle).toHaveBeenCalledTimes(1)
})

test('status tap does not navigate; link click does', () => {
  const cycle = vi.fn()
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<TicketCard booking={booking} kind="event" status="booked" to="/x" onCycleStatus={cycle} />} />
        <Route path="/x" element={<p>Navigated</p>} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: /Booked/ }))
  expect(cycle).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Navigated')).toBeNull()

  fireEvent.click(screen.getByRole('link'))
  expect(screen.getByText('Navigated')).toBeInTheDocument()
})

test('a booking with a photo_path renders the card photo; without, no art at all', () => {
  const withPhoto: BookingRow = { ...booking, photo_path: 'valle/x.jpg', photo_credit: 'Ana P.' }
  const { rerender } = render(<MemoryRouter><TicketCard booking={withPhoto} kind="transport" status="not_booked" to="/ticket/seville/T04" /></MemoryRouter>)
  expect(screen.getByRole('link').querySelector('.ticket-card__photo')).toHaveAttribute('src', 'blob:valle/x.jpg')

  rerender(<MemoryRouter><TicketCard booking={booking} kind="transport" status="not_booked" to="/ticket/seville/T04" /></MemoryRouter>)
  expect(screen.getByRole('link').querySelector('.ticket-card__art')).toBeNull()
})

test('StatusPill labels', () => {
  const { rerender } = render(<StatusPill status={null} />)
  expect(screen.getByText('—')).toBeInTheDocument()
  rerender(<StatusPill status="confirmed" />)
  expect(screen.getByText('Confirmed')).toBeInTheDocument()
})
