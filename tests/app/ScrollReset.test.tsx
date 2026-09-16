import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom'
import { vi, beforeEach, afterEach } from 'vitest'
import { TabBar } from '../../src/components/TabBar'
import { ScrollReset } from '../../src/components/ScrollReset'

// The app scrolls the document body. React Router does not reset the scroll offset on a
// client-side navigation, so a tap from a long, scrolled screen (More) to a short one
// (Bookings, Day) carried the offset over. On iOS the body is left over-scrolled and the
// fixed tab bar rides up with it, leaving a gap beneath. Every route change must land at the top.
function Shell() { return <><ScrollReset /><Outlet /><TabBar /></> }
function mount(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<h1>Home</h1>} />
          <Route path="/day" element={<h1>Day</h1>} />
          <Route path="/day/:date" element={<h1>Day dated</h1>} />
          <Route path="/bookings" element={<h1>Bookings</h1>} />
          <Route path="/more" element={<h1>More</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}
const scrollTo = vi.fn()
beforeEach(() => { scrollTo.mockClear(); vi.stubGlobal('scrollTo', scrollTo) })
afterEach(() => vi.unstubAllGlobals())

test('tapping a tab scrolls the document back to the top', () => {
  mount('/more')
  scrollTo.mockClear()
  fireEvent.click(screen.getByRole('link', { name: 'Bookings' }))
  expect(screen.getByRole('heading', { name: 'Bookings' })).toBeInTheDocument()
  expect(scrollTo).toHaveBeenCalledWith(0, 0)
})

test('a pathname change without a tab (Day prev/next date) also lands at the top', () => {
  mount('/day')
  scrollTo.mockClear()
  fireEvent.click(screen.getByRole('link', { name: 'Day' }))   // same tab, same path: no-op
  expect(scrollTo).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('link', { name: 'Home' }))
  expect(scrollTo).toHaveBeenCalledTimes(1)
})
