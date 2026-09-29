import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet, Link, useNavigate } from 'react-router-dom'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { ScrollReset } from '../../src/components/ScrollReset'
import type React from 'react'

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

/**
 * iOS terminates a backgrounded standalone PWA; relaunching it from the home screen is a NEW
 * browsing context, and a new browsing context gets an empty sessionStorage area. Offsets kept
 * only in sessionStorage are therefore guaranteed to be gone at the exact moment they are
 * wanted. This mounts a completely fresh copy of the module with sessionStorage wiped, which is
 * what a relaunch looks like from the module's point of view.
 */
test('offsets survive the app being relaunched, not just reloaded', async () => {
  const root = mount()
  root.scrollTop = 480; fireEvent.scroll(root)

  sessionStorage.clear()                       // the relaunch
  vi.resetModules()
  const fresh = await import('../../src/components/ScrollReset')
  const saved = fresh.savedOffsets()
  expect([...saved.values()]).toContain(480)
})

function mountGrowingApp() {
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
  return { root, grow }
}

// touchstart fires for ANY finger contact — a tap on a link, an impatient tap on "Loading…",
// a thumb resting on the glass. Treating that as "the owner is scrolling" abandoned the
// restore on a screen that had not filled in yet, which lands them at the top.
test('a tap during the restore does not abandon it', async () => {
  const { root, grow } = mountGrowingApp()
  root.scrollTop = 480; fireEvent.scroll(root)
  fireEvent.click(screen.getByRole('link', { name: 'Open' }))
  grow(0)
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  fireEvent.touchStart(root)                 // an impatient tap, not a scroll
  await new Promise(r => setTimeout(r, 60))
  grow(4000)
  await waitFor(() => expect(root.scrollTop).toBe(480))
})

// A real drag is the owner taking over, and must win immediately.
test('an actual drag during the restore hands control back to the owner', async () => {
  const { root, grow } = mountGrowingApp()
  root.scrollTop = 480; fireEvent.scroll(root)
  fireEvent.click(screen.getByRole('link', { name: 'Open' }))
  grow(0)
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  fireEvent.touchMove(root)
  await new Promise(r => setTimeout(r, 60))
  grow(4000)
  await new Promise(r => setTimeout(r, 200))
  expect(root.scrollTop).toBe(0)             // left where the owner put it, not yanked back
})

/**
 * React Router gives the first entry of EVERY browsing context the key 'default'. Now that
 * offsets outlive the context, an offset saved on one launch's first screen would be restored
 * on the next launch's first screen — whatever screen that is. Entries are therefore keyed by
 * path as well: a relaunch on the same screen still gets its offset back, a launch elsewhere
 * does not inherit it.
 */
test('a cold launch on a different screen does not inherit the first-entry offset', async () => {
  const root = mount()
  root.scrollTop = 480; fireEvent.scroll(root)

  vi.resetModules()
  const fresh = await import('../../src/components/ScrollReset')
  document.getElementById('root')?.remove()
  const again = document.createElement('div'); again.id = 'root'; document.body.appendChild(again)
  Object.defineProperty(again, 'scrollTop', { value: 0, writable: true })
  function FreshShell() { return <><fresh.ScrollReset /><Outlet /></> }
  render(
    <MemoryRouter initialEntries={['/day']}>
      <Routes><Route element={<FreshShell />}><Route path="/day" element={<h1>Day</h1>} /></Route></Routes>
    </MemoryRouter>,
    { container: again },
  )
  expect(screen.getByRole('heading', { name: 'Day' })).toBeInTheDocument()
  expect(again.scrollTop).toBe(0)
  expect(scrollTo).toHaveBeenLastCalledWith(0, 0)
})

test('a corrupt or foreign value under the storage key does not break the module', async () => {
  localStorage.setItem('europe-guide.scroll-positions', '{}')
  vi.resetModules()
  const fresh = await import('../../src/components/ScrollReset')
  expect(fresh.savedOffsets().size).toBe(0)
  localStorage.removeItem('europe-guide.scroll-positions')
})

/**
 * iOS recreates the page whenever it likes — reliably after a PDF opens in a new window and the
 * app sits in the background. The new page has a fresh history: one entry, key 'default', and no
 * memory of the entry the owner came from. Back on a detail screen therefore falls back to a
 * REPLACE of the list's route. Keyed by history key, the saved offset could never be found again,
 * so every such Back landed at the top. Offsets are keyed by path, and a Back-fallback says so.
 *
 * Each `page()` below is a separate page lifetime: a fresh copy of the module (its memory starts
 * from localStorage, like a real relaunch) and a fresh router whose first entry is 'default'.
 */
const STORE = 'europe-guide.scroll-positions'
function BackFallback({ to }: { to: string }) {
  const nav = useNavigate()
  return <button onClick={() => nav(to, { replace: true, state: { back: true } })}>Back</button>
}
async function page(initial: string, routes: React.ReactNode) {
  vi.resetModules()
  const fresh = await import('../../src/components/ScrollReset')
  document.getElementById('root')?.remove()
  const root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root)
  Object.defineProperty(root, 'scrollTop', { value: 0, writable: true })
  function FreshShell() { return <><fresh.ScrollReset /><Outlet /></> }
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes><Route element={<FreshShell />}>{routes}</Route></Routes>
    </MemoryRouter>,
    { container: root },
  )
  return root
}
const listAndDetail = <>
  <Route path="/tickets" element={<><h1>Tickets</h1><Link to="/ticket/B01">Open</Link></>} />
  <Route path="/ticket/:id" element={<><h1>Detail</h1><BackFallback to="/tickets" /></>} />
</>

test('after iOS recreates the page on a detail screen, Back still returns to where the list was', async () => {
  localStorage.removeItem(STORE)
  const first = await page('/tickets', listAndDetail)
  first.scrollTop = 480; fireEvent.scroll(first)
  fireEvent.click(screen.getByRole('link', { name: 'Open' }))

  const again = await page('/ticket/B01', listAndDetail)             // iOS dropped and relaunched the page here
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('heading', { name: 'Tickets' })).toBeInTheDocument()
  expect(again.scrollTop).toBe(480)
})

test('a relaunch straight onto the list gets its recent offset back', async () => {
  localStorage.removeItem(STORE)
  const first = await page('/tickets', listAndDetail)
  first.scrollTop = 480; fireEvent.scroll(first)

  const again = await page('/tickets', listAndDetail)
  expect(again.scrollTop).toBe(480)
})

test('an offset from hours ago is not restored on a launch', async () => {
  localStorage.setItem(STORE, JSON.stringify([['/tickets', { y: 480, at: Date.now() - 3 * 60 * 60 * 1000 }]]))
  const again = await page('/tickets', listAndDetail)
  expect(again.scrollTop).toBe(0)
})

test('a tap on the tab you are already on leaves the list where it is', async () => {
  localStorage.removeItem(STORE)
  function Replace() { const nav = useNavigate(); return <button onClick={() => nav('/tickets', { replace: true })}>Same tab</button> }
  const root = await page('/tickets', <Route path="/tickets" element={<><h1>Tickets</h1><Replace /></>} />)
  root.scrollTop = 200; fireEvent.scroll(root)
  fireEvent.click(screen.getByRole('button', { name: 'Same tab' }))
  expect(root.scrollTop).toBe(200)
})
