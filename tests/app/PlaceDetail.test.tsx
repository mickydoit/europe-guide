import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, test, expect } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'

const { toggle } = vi.hoisted(() => ({ toggle: vi.fn(async () => ({ queued: false })) }))
vi.mock('../../src/lib/state', () => ({ useChecks: () => ({ done: new Set<string>(), loading: false, toggle }), QUEUED_COPY: 'q' }))
const { usePhotoMock } = vi.hoisted(() => ({ usePhotoMock: vi.fn((p: string | null) => (p ? `blob:${p}` : null)) }))
vi.mock('../../src/lib/photos', () => ({ usePhoto: usePhotoMock, warmTripPhotos: vi.fn() }))

import { PlaceDetail } from '../../src/screens/PlaceDetail'

const throwingClient = new Proxy({}, { get() { throw new Error('no network in tests') } }) as never
let content: CityContent
beforeEach(async () => { content = await loadValle(); toggle.mockClear(); usePhotoMock.mockImplementation((p: string | null) => (p ? `blob:${p}` : null)) })

function mount(c: CityContent, id: string) {
  return render(
    <MemoryRouter initialEntries={[`/place/${encodeURIComponent(id)}`]}>
      <TripProvider initial={{ trips: [c.trip], slug: 'valle', content: c }} client={throwingClient}>
        <Routes><Route path="/place/:id" element={<PlaceDetail />} /></Routes>
      </TripProvider>
    </MemoryRouter>,
  )
}

test('shows the stop, its details, walk link and options; tick calls toggle', () => {
  const stop = content.items.find(i => i.kind === 'stop' && content.items.some(o => o.kind === 'option' && o.parent_item === i.id))!
  mount(content, stop.id)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(stop.place_name ?? stop.plan.replace(/\*\*/g, ''))
  const options = content.items.filter(o => o.kind === 'option' && o.parent_item === stop.id)
  for (const o of options) expect(screen.getByText(new RegExp((o.place_name ?? o.plan).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 12)))).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Mark done/ }))
  expect(toggle).toHaveBeenCalledWith(stop.id)
})

test('a stop with a photo_path shows the hero photo and credit, not the glyph', () => {
  const modified = structuredClone(content)
  const stop = modified.items.find(i => i.kind === 'stop')!
  stop.photo_path = 'valle/x.jpg'
  stop.photo_credit = 'Ana P.'
  mount(modified, stop.id)
  const hero = document.querySelector('.place-detail__hero') as HTMLElement
  expect(hero.querySelector('img')).toHaveAttribute('src', 'blob:valle/x.jpg')
  expect(within(hero).getByText('Photo: Ana P.')).toBeInTheDocument()
  expect(hero.querySelector('.place-detail__glyph')).toBeNull()
})

test('a stop with no photo_path shows the glyph and no image', () => {
  const stop = content.items.find(i => i.kind === 'stop' && !i.photo_path)!
  mount(content, stop.id)
  const hero = document.querySelector('.place-detail__hero') as HTMLElement
  expect(hero.querySelector('.place-detail__glyph')).not.toBeNull()
  expect(hero.querySelector('img')).toBeNull()
})

test('a photo_path whose bytes are not available falls back to the glyph, with no scrim', () => {
  usePhotoMock.mockReturnValue(null)
  const modified = structuredClone(content)
  const stop = modified.items.find(i => i.kind === 'stop')!
  stop.photo_path = 'valle/x.jpg'
  stop.photo_credit = 'Ana P.'
  mount(modified, stop.id)
  const hero = document.querySelector('.place-detail__hero') as HTMLElement
  expect(hero.querySelector('.place-detail__glyph')).not.toBeNull()
  expect(hero.querySelector('img')).toBeNull()
  expect(hero.className).not.toContain('place-detail__hero--photo')
  expect(screen.queryByText('Photo: Ana P.')).toBeNull()
})

test('shows a "Walk there" link to Google Maps for a stop with an address', () => {
  const stop = content.items.find(i => i.kind === 'stop' && !!i.address)!
  mount(content, stop.id)
  const link = screen.getByRole('link', { name: 'Walk there' }) as HTMLAnchorElement
  expect(link.href).toMatch(/^https:\/\/www\.google\.com\/maps/)
})

test('a failed tick says so instead of failing silently', async () => {
  toggle.mockRejectedValueOnce(new Error('offline'))
  const stop = content.items.find(i => i.kind === 'stop')!
  mount(content, stop.id)
  fireEvent.click(screen.getByRole('button', { name: /Mark done/ }))
  const msg = await screen.findByText(/Couldn't save/)
  expect(msg.className).toContain('form__msg--error')
})

test('a queued tick says it will sync later', async () => {
  toggle.mockResolvedValueOnce({ queued: true })
  const stop = content.items.find(i => i.kind === 'stop')!
  mount(content, stop.id)
  fireEvent.click(screen.getByRole('button', { name: /Mark done/ }))
  const msg = await screen.findByText('q')
  expect(msg.className).toContain('form__msg--queued')
})

test('shows the walk to the next stop from the route leg and the route this stop belongs to', () => {
  const piazza = content.items.find(i => i.kind === 'stop' && i.place_name === 'Piazza Grande')!
  const leg = content.legs.find(l => l.route_id === 'V1' && l.seq === 0)!
  render(
    <MemoryRouter initialEntries={[`/place/${encodeURIComponent(piazza.id)}`]}>
      <TripProvider initial={{ trips: [content.trip], slug: 'valle', content }} client={throwingClient}>
        <Routes><Route path="/place/:id" element={<PlaceDetail />} /></Routes>
      </TripProvider>
    </MemoryRouter>,
  )
  const walk = screen.getByRole('link', { name: /Walk to Caffè Nord/ })
  expect(walk).toHaveAttribute('href', leg.google_url)
  const route = screen.getByRole('link', { name: /Open route/ })
  expect(route).toHaveAttribute('href', content.routes.find(r => r.id === 'V1')!.google_url)
  expect(screen.getByText(/Part of/)).toHaveTextContent(/Piazza to the belvedere/)
})
