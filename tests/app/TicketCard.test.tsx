import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { test, expect, vi } from 'vitest'
import { TicketCard } from '../../src/components/TicketCard'
import { StatusPill } from '../../src/components/StatusPill'
import type { BookingRow } from '../../src/lib/types'

const booking: BookingRow = {
  id: 'T04', trip: 'seville', kind: 'todo', title: 'AVE Seville → Barcelona', date: '2026-10-07', time: '08:45', priority: 'critical',
  book_by: '2026-09-17', decide_by: null, contact: null, address: null, notes: null, fallback: null, relates_to: null, options: null,
  status_from_file: 'not booked', fields: { cost: '€120 for two' }, sort: 3,
}

test('transport card: teal tone, Poppins title, lines, icon, link', () => {
  render(<MemoryRouter><TicketCard booking={booking} kind="transport" status="not_booked" to="/ticket/seville/T04" /></MemoryRouter>)
  const link = screen.getByRole('link', { name: /AVE Seville/ })
  expect(link).toHaveAttribute('href', '/ticket/seville/T04')
  expect(link.className).toContain('ticket-card--transport')
  expect(screen.getByText('Departs')).toBeInTheDocument()
  expect(screen.getByText('08:45')).toBeInTheDocument()
  expect(screen.getByText('€120 for two')).toBeInTheDocument()
  expect(link.querySelector('.icon')).not.toBeNull()
  expect(screen.getByText('Not booked')).toBeInTheDocument()
})

test('tone override and status tap', () => {
  const cycle = vi.fn()
  render(<MemoryRouter><TicketCard booking={booking} kind="event" status="booked" tone="highlight" to="/x" onCycleStatus={cycle} /></MemoryRouter>)
  expect(screen.getByRole('link').className).toContain('ticket-card--highlight')
  fireEvent.click(screen.getByRole('button', { name: /Booked/ }))
  expect(cycle).toHaveBeenCalledTimes(1)
})

test('StatusPill labels', () => {
  const { rerender } = render(<StatusPill status={null} />)
  expect(screen.getByText('—')).toBeInTheDocument()
  rerender(<StatusPill status="confirmed" />)
  expect(screen.getByText('Confirmed')).toBeInTheDocument()
})
