import { ticketLinkLabel } from '../../src/lib/tickets'

// The link into a booking must not promise a ticket that is not there.
test('a real attachment is the only thing that earns "Open ticket"', () => {
  expect(ticketLinkLabel('booked', true)).toBe('Open ticket')
  expect(ticketLinkLabel('not_booked', true)).toBe('Open ticket')
})
test('a settled booking without a file is "Open booking"', () => {
  for (const s of ['booked', 'confirmed', 'reserved_unpaid', 'unconfirmed'] as const) expect(ticketLinkLabel(s, false)).toBe('Open booking')
})
test('a to-do is "To book"; walk-ups and the superseded are "Details"', () => {
  expect(ticketLinkLabel('not_booked', false)).toBe('To book')
  expect(ticketLinkLabel('undecided', false)).toBe('To book')
  expect(ticketLinkLabel(null, false)).toBe('To book')
  for (const s of ['walk_up', 'not_needed', 'cancelled'] as const) expect(ticketLinkLabel(s, false)).toBe('Details')
})
