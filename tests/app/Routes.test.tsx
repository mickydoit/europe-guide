import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'

import { Routes as RoutesScreen } from '../../src/screens/Routes'

const throwingClient = new Proxy({}, { get() { throw new Error('no network in tests') } }) as never

function renderRoutes(content: CityContent) {
  return render(
    <MemoryRouter initialEntries={['/routes']}>
      <TripProvider initial={{ trips: [content.trip], slug: 'valle', content }} client={throwingClient}>
        <RoutesScreen />
      </TripProvider>
    </MemoryRouter>,
  )
}

let content: CityContent

beforeEach(async () => {
  content = await loadValle()
})

test('V1 lists exactly two legs', async () => {
  renderRoutes(content)
  const heading = await screen.findByText('Piazza to the belvedere', { exact: false })
  const card = heading.closest('.route-card') as HTMLElement
  const legs = within(card).getAllByText(/→/)
  expect(legs).toHaveLength(2)
})

test('V2 shows a Taxi pill', async () => {
  renderRoutes(content)
  const heading = await screen.findByText('Station to dinner', { exact: false })
  const card = heading.closest('.route-card') as HTMLElement
  expect(within(card).getByText('Taxi')).toBeInTheDocument()
})

test('an undated route group sorts last, under an "Undated" heading', async () => {
  content.routes.push({
    id: 'V-undated', trip: content.trip.slug, date: null, title: 'Someday walk',
    distance_text: null, mode: 'walking', covers: [], note: null,
    google_url: 'https://maps.google.com/undated', sort: 999,
  })
  renderRoutes(content)
  await screen.findByText('Someday walk')
  const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)
  expect(headings[headings.length - 1]).toBe('Undated')
})

test('whole-route link href equals the fixture url', async () => {
  renderRoutes(content)
  const heading = await screen.findByText('Piazza to the belvedere', { exact: false })
  const card = heading.closest('.route-card') as HTMLElement
  const link = within(card).getByText('Open whole route') as HTMLAnchorElement
  expect(link.href).toBe(content.routes.find(r => r.id === 'V1')!.google_url)
  expect(link.getAttribute('rel')).toContain('noopener')
})
