import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, test, expect } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'

const { toggle } = vi.hoisted(() => ({ toggle: vi.fn(async () => ({ queued: false })) }))
vi.mock('../../src/lib/state', () => ({ useChecks: () => ({ done: new Set<string>(), loading: false, toggle }), QUEUED_COPY: 'q' }))

import { PlaceDetail } from '../../src/screens/PlaceDetail'

const throwingClient = new Proxy({}, { get() { throw new Error('no network in tests') } }) as never
let content: CityContent
beforeEach(async () => { content = await loadValle(); toggle.mockClear() })

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
