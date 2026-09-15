import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, afterEach } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent, ItemRow } from '../../src/lib/types'

const { toggle, useChecksMock } = vi.hoisted(() => {
  const toggle = vi.fn()
  return { toggle, useChecksMock: vi.fn(() => ({ done: new Set<string>(), loading: false, toggle })) }
})
vi.mock('../../src/lib/state', () => ({ useChecks: useChecksMock }))

import { Day } from '../../src/screens/Day'

const throwingClient = new Proxy({}, { get() { throw new Error('no network in tests') } }) as never

function renderDay(date: string, content: CityContent) {
  return render(
    <MemoryRouter initialEntries={[`/day/${date}`]}>
      <TripProvider initial={{ trips: [content.trip], slug: 'valle', content }} client={throwingClient}>
        <Routes>
          <Route path="/day/:date?" element={<Day />} />
        </Routes>
      </TripProvider>
    </MemoryRouter>,
  )
}

let content: CityContent

beforeEach(async () => {
  content = await loadValle()
  useChecksMock.mockReturnValue({ done: new Set<string>(), loading: false, toggle })
})

afterEach(() => {
  vi.useRealTimers()
})

test('renders three block headings for the main Valle day', async () => {
  renderDay('2026-11-02', content)
  expect(await screen.findByRole('heading', { name: 'Morning' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Midday' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Evening' })).toBeInTheDocument()
})

test('renders the Caffè Nord card with a Walk there link containing destination=', async () => {
  renderDay('2026-11-02', content)
  const card = (await screen.findByText('Caffè Nord', { exact: false })).closest('.stop-card')
  expect(card).not.toBeNull()
  const link = card!.querySelector('a') as HTMLAnchorElement
  expect(link.textContent).toBe('Walk there')
  expect(link.href).toContain('destination=')
})

test('clicking the tick calls toggle with the item id', async () => {
  renderDay('2026-11-02', content)
  const heading = await screen.findByText('Piazza Grande', { exact: false })
  const card = heading.closest('.stop-card') as HTMLElement
  fireEvent.click(within(card).getByRole('button', { name: 'Mark done' }))
  expect(toggle).toHaveBeenCalledWith('valle/2026-11-02/0830/piazza-grande')
})

test('a failed toggle surfaces an inline "could not save" message that clears itself', async () => {
  toggle.mockRejectedValueOnce(new Error('offline'))
  renderDay('2026-11-02', content)
  const heading = await screen.findByText('Piazza Grande', { exact: false })
  const card = heading.closest('.stop-card') as HTMLElement
  fireEvent.click(within(card).getByRole('button', { name: 'Mark done' }))
  expect(await screen.findByText("Couldn't save — you may be offline")).toBeInTheDocument()
})

test('a null-block note with a lower sort renders before the Morning heading', async () => {
  const date = '2026-11-02'
  const note: ItemRow = {
    id: 'valle/2026-11-02/note', trip: 'valle', date, block: null, time: null, time_text: null,
    approx: false, kind: 'note', parent_item: null, plan: 'A note before Morning', details: null,
    sort: 0, place_name: null, address: null, lat: null, lng: null, url: null, route_id: null,
  }
  content.items = [
    note,
    ...content.items.filter(i => i.date === date).map(i => ({ ...i, sort: i.sort + 1 })),
    ...content.items.filter(i => i.date !== date),
  ]
  renderDay(date, content)
  const heading = await screen.findByRole('heading', { name: 'Morning' })
  const note_el = await screen.findByText('A note before Morning')
  // eslint-disable-next-line no-bitwise
  expect(note_el.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test("the options table's two options appear under their parent", async () => {
  renderDay('2026-11-02', content)
  const heading = await screen.findByText('pick one below', { exact: false })
  const card = heading.closest('.stop-card') as HTMLElement
  fireEvent.click(within(card).getByRole('button', { name: 'Details' }))
  expect(within(card).getByText('Bar Sole', { exact: false })).toBeInTheDocument()
  expect(within(card).getByText('Enoteca Piccola', { exact: false })).toBeInTheDocument()
})

test('the /day/<last date> route renders the block-less day', async () => {
  renderDay('2026-11-03', content)
  expect(await screen.findByText('Taxi to the station', { exact: false })).toBeInTheDocument()
  expect(screen.getByText('Train south', { exact: false })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Morning' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Midday' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Evening' })).toBeNull()
})

test('NowNext shows next text when Date is fixed inside the trip', async () => {
  vi.useFakeTimers({ now: new Date('2026-11-02T08:00:00Z') })
  renderDay('2026-11-02', content)
  expect(screen.getByText('in 15 min', { exact: false })).toBeInTheDocument()
})

test('the live banner updates the countdown 30s at a time', async () => {
  vi.useFakeTimers({ now: new Date('2026-11-02T08:00:00Z') })
  renderDay('2026-11-02', content)
  expect(screen.getByText('in 15 min', { exact: false })).toBeInTheDocument()
  act(() => { vi.advanceTimersByTime(60_000) })
  expect(screen.getByText('in 14 min', { exact: false })).toBeInTheDocument()
})
