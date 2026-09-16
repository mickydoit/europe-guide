import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

const { useSyncMock } = vi.hoisted(() => ({
  useSyncMock: vi.fn(() => ({ pending: 0, failed: 0, syncing: false, lastError: undefined as string | undefined, retryFailed: vi.fn() })),
}))
vi.mock('../../src/lib/sync', () => ({ useSync: useSyncMock }))

import { SyncBadge } from '../../src/components/SyncBadge'

function setSync(s: Partial<{ pending: number; failed: number; syncing: boolean; lastError: string }>) {
  useSyncMock.mockReturnValue({ pending: 0, failed: 0, syncing: false, lastError: undefined, retryFailed: vi.fn(), ...s })
}

test('renders nothing when the outbox is empty and nothing is in flight', () => {
  setSync({})
  const { container } = render(<SyncBadge />)
  expect(container).toBeEmptyDOMElement()
})

test('renders "2 to sync" for two pending ops', () => {
  setSync({ pending: 2 })
  render(<SyncBadge />)
  const pill = screen.getByText('2 to sync')
  expect(pill).toBeInTheDocument()
  expect(pill).toHaveClass('pill--highlight')
})

test('renders "Syncing…" while a flush is in flight', () => {
  setSync({ pending: 3, syncing: true })
  render(<SyncBadge />)
  expect(screen.getByText('Syncing…')).toBeInTheDocument()
  expect(screen.queryByText('3 to sync')).toBeNull()
})

test('renders "1 failed" in lavender when an op has given up', () => {
  setSync({ pending: 0, failed: 1 })
  render(<SyncBadge />)
  const pill = screen.getByText('1 failed')
  expect(pill).toHaveClass('pill--lavender')
})
