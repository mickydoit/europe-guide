import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

const { signInWithPassword, onAuthStateChange } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
}))
vi.mock('../../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange, signInWithPassword,
    signOut: vi.fn(), resetPasswordForEmail: vi.fn(), updateUser: vi.fn() } },
}))
import App from '../../src/App'

test('unauthenticated user sees sign in instead of Home', async () => {
  render(<MemoryRouter><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Home' })).toBeNull()
})

test('bad password shows the error message', async () => {
  signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } })
  render(<MemoryRouter><App /></MemoryRouter>)
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'a@b.c' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(screen.getByText('Invalid login credentials')).toBeInTheDocument())
})
