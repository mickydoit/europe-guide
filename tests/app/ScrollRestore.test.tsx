import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet, Link, useNavigate } from 'react-router-dom'
import { vi, beforeEach, afterEach } from 'vitest'
import { ScrollReset } from '../../src/components/ScrollReset'

// A forward tap lands at the top. Coming BACK returns to where the list was scrolled, so a long
// Tickets list or Day does not snap to the top after peeking into an event.
function Back() { const nav = useNavigate(); return <button onClick={() => nav(-1)}>Back</button> }
function Shell() { return <><ScrollReset /><Outlet /></> }
function mount() {
  const root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root)
  Object.defineProperty(root, 'scrollTop', { value: 0, writable: true })
  render(
    <MemoryRouter initialEntries={['/tickets']}>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/tickets" element={<><h1>Tickets</h1><Link to="/ticket/B01">Open</Link></>} />
          <Route path="/ticket/:id" element={<><h1>Detail</h1><Back /></>} />
        </Route>
      </Routes>
    </MemoryRouter>,
    { container: root },
  )
  return root
}
const scrollTo = vi.fn()
beforeEach(() => { scrollTo.mockClear(); vi.stubGlobal('scrollTo', scrollTo) })
afterEach(() => { vi.unstubAllGlobals(); document.getElementById('root')?.remove() })

test('back restores the saved offset; forward goes to the top', () => {
  const root = mount()
  root.scrollTop = 480; fireEvent.scroll(root)          // the owner scrolls the list
  fireEvent.click(screen.getByRole('link', { name: 'Open' }))
  expect(screen.getByRole('heading', { name: 'Detail' })).toBeInTheDocument()
  expect(scrollTo).toHaveBeenLastCalledWith(0, 0)
  expect(root.scrollTop).toBe(0)
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('heading', { name: 'Tickets' })).toBeInTheDocument()
  expect(scrollTo).toHaveBeenLastCalledWith(0, 480)
  expect(root.scrollTop).toBe(480)
})
