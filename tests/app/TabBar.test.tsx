import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { test, expect } from 'vitest'
import { TabBar, TABS } from '../../src/components/TabBar'

function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><TabBar /></MemoryRouter>)
}

test('five tabs in order, glyph only, named for screen readers', () => {
  mount('/')
  expect(TABS.map(t => t.label)).toEqual(['Home', 'Day', 'Map', 'Tickets', 'More'])
  const links = screen.getAllByRole('link')
  expect(links.map(l => l.getAttribute('aria-label'))).toEqual(['Home', 'Day', 'Map', 'Tickets', 'More'])
  for (const l of links) expect(l.textContent).toBe('')   // Figma 1:85 has no labels under the glyphs
  expect(links.map(l => l.getAttribute('href'))).toEqual(['/', '/day', '/map', '/tickets', '/more'])
  for (const l of links) expect(l.querySelector('.icon')).not.toBeNull()
})

test('active tab is marked and only one is active', () => {
  mount('/tickets')
  const active = screen.getAllByRole('link').filter(l => l.classList.contains('tabbar__tab--active'))
  expect(active).toHaveLength(1)
  expect(active[0]).toHaveAccessibleName('Tickets')
})

test('hidden on the map route', () => {
  const { container } = mount('/map/2026-10-05')
  expect(container.querySelector('nav')).toBeNull()
})
