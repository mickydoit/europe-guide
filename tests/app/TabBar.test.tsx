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

function mountWith(path: string, mapsPending: boolean) {
  return render(<MemoryRouter initialEntries={[path]}><TabBar mapsPending={mapsPending} /></MemoryRouter>)
}

test('no dot on the Map tab when every map ahead is saved', () => {
  const { container } = mountWith('/', false)
  expect(container.querySelector('.tabbar__dot')).toBeNull()
})

test('a dot marks the Map tab when a map still needs downloading', () => {
  const { container } = mountWith('/', true)
  const dot = container.querySelector('.tabbar__dot')
  expect(dot).not.toBeNull()
  expect(dot!.closest('a')).toHaveAccessibleName(/Map/)
})

// The glyph row carries no text (Figma 1:85); the dot must not smuggle any in.
test('the dot adds no visible text to the bar', () => {
  mountWith('/', true)
  for (const l of screen.getAllByRole('link')) expect(l.textContent).toBe('')
})

test('the Map tab says why it is marked, for screen readers', () => {
  mountWith('/', true)
  expect(screen.getByRole('link', { name: 'Map — offline map not downloaded' })).toBeInTheDocument()
})
