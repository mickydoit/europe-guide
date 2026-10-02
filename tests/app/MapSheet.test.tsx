import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MapSheet } from '../../src/components/MapSheet'

const base = { open: true, title: 'Tasca X', subtitle: null, details: null, walkHref: null, onClose: () => {} }

test('a place sheet shows "Not for us" and calls onReject', () => {
  const onReject = vi.fn()
  render(<MemoryRouter><MapSheet {...base} kind="place" onSave={() => {}} onReject={onReject} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Not for us' }))
  expect(onReject).toHaveBeenCalledTimes(1)
})

test('a stop sheet has no "Not for us" button', () => {
  render(<MemoryRouter><MapSheet {...base} kind="stop" onReject={() => {}} /></MemoryRouter>)
  expect(screen.queryByRole('button', { name: 'Not for us' })).toBeNull()
})
