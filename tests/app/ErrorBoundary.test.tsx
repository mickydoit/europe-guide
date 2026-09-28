import { render, screen, fireEvent } from '@testing-library/react'
import { vi, test, expect, beforeEach, afterEach } from 'vitest'
import { ErrorBoundary } from '../../src/components/ErrorBoundary'

function Boom(): never { throw new Error('chunk load failed') }

let spy: ReturnType<typeof vi.spyOn>
beforeEach(() => { spy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { spy.mockRestore() })

test('a throwing screen shows a way out instead of unmounting the whole app', () => {
  render(<ErrorBoundary><Boom /></ErrorBoundary>)
  expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
})

test('the message names what happened rather than going blank', () => {
  render(<ErrorBoundary><Boom /></ErrorBoundary>)
  expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
})

test('children render untouched when nothing throws', () => {
  render(<ErrorBoundary><p>the itinerary</p></ErrorBoundary>)
  expect(screen.getByText('the itinerary')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /reload/i })).toBeNull()
})

test('Reload reloads the app', () => {
  const reload = vi.fn()
  render(<ErrorBoundary onReload={reload}><Boom /></ErrorBoundary>)
  fireEvent.click(screen.getByRole('button', { name: /reload/i }))
  expect(reload).toHaveBeenCalled()
})
