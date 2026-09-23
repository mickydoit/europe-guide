import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

/**
 * A scroller that behaves like a real one: scrollTop is clamped to the content that exists.
 * The itinerary arrives asynchronously (Supabase, or IndexedDB after iOS reloads a backgrounded
 * PWA), so at restore time the screen can still be empty and the offset has nowhere to go.
 */
function mountGrowing() {
  const root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root)
  let y = 0
  let height = 0            // no content yet
  Object.defineProperty(root, 'clientHeight', { configurable: true, get: () => 800 })
  Object.defineProperty(root, 'scrollHeight', { configurable: true, get: () => height })
  Object.defineProperty(root, 'scrollTop', {
    configurable: true,
    get: () => y,
    set: (v: number) => { y = Math.max(0, Math.min(v, Math.max(0, height - 800))) },
  })
  return { root, grow: (h: number) => { height = h } }
}

test('restores the offset once the itinerary finally renders, not against an empty screen', async () => {
  const { root, grow } = mountGrowing()
  grow(4000)
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
  root.scrollTop = 480; fireEvent.scroll(root)
  fireEvent.click(screen.getByRole('link', { name: 'Open' }))
  grow(0)                                   // the reload: content gone, screen empty
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(root.scrollTop).toBe(0)            // nowhere to scroll to yet
  // The one-frame retry already in place fires here, against a screen that is still empty.
  await new Promise(r => setTimeout(r, 60))
  grow(4000)                                // only NOW does the itinerary arrive
  await waitFor(() => expect(root.scrollTop).toBe(480))
})
