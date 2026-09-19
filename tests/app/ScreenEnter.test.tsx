import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'
import { ScreenEnter } from '../../src/components/ScreenEnter'

// Every tab change and detail open fades the new screen in. Flicking between dates on Day
// stays on the same tab, so it must NOT replay; the map is a full-screen fixed canvas and
// must not be wrapped at all (an animated ancestor would flicker it under the tab bar).
function mount(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route element={<ScreenEnter />}>
          <Route path="/" element={<h1>Home</h1>} />
          <Route path="/day" element={<><h1>Day</h1><Link to="/day/2026-09-30">Next</Link><Link to="/tickets">Tickets</Link></>} />
          <Route path="/day/:date" element={<h1>Day dated</h1>} />
          <Route path="/tickets" element={<h1>Tickets</h1>} />
          <Route path="/map" element={<h1>Map</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

test('a screen is wrapped in the entrance element', () => {
  mount('/')
  expect(screen.getByRole('heading', { name: 'Home' }).parentElement).toHaveClass('screen-enter')
})

test('changing date on Day keeps the same wrapper; changing tab remounts it', () => {
  mount('/day')
  const before = screen.getByRole('heading', { name: 'Day' }).parentElement
  fireEvent.click(screen.getByRole('link', { name: 'Next' }))
  expect(screen.getByRole('heading', { name: 'Day dated' }).parentElement).toBe(before)
})

test('a tab change gives a fresh wrapper so the animation replays', () => {
  mount('/day')
  const before = screen.getByRole('heading', { name: 'Day' }).parentElement
  fireEvent.click(screen.getByRole('link', { name: 'Tickets' }))
  const after = screen.getByRole('heading', { name: 'Tickets' }).parentElement
  expect(after).toHaveClass('screen-enter')
  expect(after).not.toBe(before)
})

test('the map is not wrapped', () => {
  mount('/map')
  expect(screen.getByRole('heading', { name: 'Map' }).parentElement).not.toHaveClass('screen-enter')
})
