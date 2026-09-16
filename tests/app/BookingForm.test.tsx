import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'
import { BookingForm } from '../../src/components/BookingForm'
import type { BookingRow } from '../../src/lib/types'
import type { BookingStateRow, WriteResult } from '../../src/lib/state'

// BookingForm takes `save` as a prop, so it needs no router/trip/auth context — this
// exercises exactly the piece lifted out of the old Bookings.tsx BookingSheet.
const booking: BookingRow = {
  id: 'T01', trip: 'valle', kind: 'todo', title: 'Trattoria Alba — dinner', date: '2026-11-02', time: '19:30',
  priority: 'critical', book_by: '2026-10-20', decide_by: null, contact: '+39 0123 456 789', address: null,
  notes: null, fallback: 'Osteria Blu, Via Corta 9', relates_to: null, options: null, status_from_file: 'not booked',
  fields: {}, sort: 2, photo_path: null, photo_credit: null,
}

type Save = (bookingId: string, patch: Partial<Omit<BookingStateRow, 'trip' | 'booking_id' | 'updated_at'>>) => Promise<WriteResult>
let saveMock: ReturnType<typeof vi.fn<Save>>
beforeEach(() => { saveMock = vi.fn<Save>().mockResolvedValue({ queued: false }) })

test('selecting a status and pressing Save calls save with the patch', async () => {
  render(<BookingForm booking={booking} row={undefined} save={saveMock} />)
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'booked' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(saveMock).toHaveBeenCalledWith('T01', expect.objectContaining({ status: 'booked' })))
})

test('a queued save shows the accent "saved on this phone" message instead of "Saved"', async () => {
  saveMock.mockResolvedValueOnce({ queued: true })
  render(<BookingForm booking={booking} row={undefined} save={saveMock} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  const msg = await screen.findByText('Saved on this phone — will sync when online')
  expect(msg).toHaveClass('form__msg--queued')
})

test('a non-queued save shows "Saved"', async () => {
  render(<BookingForm booking={booking} row={undefined} save={saveMock} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  const msg = await screen.findByText('Saved')
  expect(msg).toHaveClass('form__msg--info')
})

test('a rejected save surfaces the error message', async () => {
  saveMock.mockRejectedValueOnce(new Error('network down'))
  render(<BookingForm booking={booking} row={undefined} save={saveMock} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  const msg = await screen.findByText('network down')
  expect(msg).toHaveClass('form__msg--error')
})

test('pre-fills fields from the existing state row', () => {
  render(<BookingForm booking={booking} row={{ trip: 'valle', booking_id: 'T01', status: 'confirmed', confirmation_ref: 'REF9', cost: 40, currency: 'USD', notes: 'bring cash', updated_at: '2026-01-01' }} save={saveMock} />)
  expect(screen.getByLabelText('Status')).toHaveValue('confirmed')
  expect(screen.getByLabelText('Confirmation ref')).toHaveValue('REF9')
  expect(screen.getByLabelText('Cost')).toHaveValue(40)
  expect(screen.getByLabelText('Currency')).toHaveValue('USD')
  expect(screen.getByLabelText('Notes')).toHaveValue('bring cash')
})
