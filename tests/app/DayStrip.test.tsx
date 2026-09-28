import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { test, expect } from 'vitest'
import { DayStrip } from '../../src/components/DayStrip'
import type { DayRow } from '../../src/lib/types'

const days: DayRow[] = [
  { trip: 'valle', date: '2026-11-01', title: null, status: null, intro: null },
  { trip: 'valle', date: '2026-11-02', title: null, status: null, intro: null },
]

function mount(selected: string) {
  return render(<MemoryRouter><DayStrip days={days} selected={selected} today="2026-11-01" /></MemoryRouter>)
}

test('other days are links you can tap to switch', () => {
  mount('2026-11-01')
  expect(screen.getByRole('link', { name: 'Mon 2' })).toHaveAttribute('href', '/day/2026-11-02')
})

/**
 * A <Link> whose target equals the current path auto-REPLACEs, and a replace mints a fresh
 * location.key — stranding the scroll offset saved under the old one, so the next Back lands
 * at the top. The day you are already on is not a navigation; it must not be a link.
 */
test('the day you are already on is not a link', () => {
  mount('2026-11-01')
  expect(screen.queryByRole('link', { name: 'Sun 1' })).toBeNull()
})

test('the selected day is still marked as current for screen readers', () => {
  const { container } = mount('2026-11-01')
  const sel = container.querySelector('.day-chip--selected')
  expect(sel).not.toBeNull()
  expect(sel).toHaveAttribute('aria-current', 'date')
})
