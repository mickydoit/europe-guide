import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, afterEach } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent, ItemRow } from '../../src/lib/types'
import type { SavedPlace } from '../../src/lib/state'

const { toggle, useChecksMock, removePlace, useDayNotesMock } = vi.hoisted(() => {
  const toggle = vi.fn()
  const removePlace = vi.fn()
  return {
    toggle,
    removePlace,
    useChecksMock: vi.fn(() => ({ done: new Set<string>(), loading: false, toggle })),
    useDayNotesMock: vi.fn(() => ({
      note: '', savedPlaces: [] as SavedPlace[], loading: false,
      setNote: vi.fn(), savePlace: vi.fn(), removePlace,
    })),
  }
})
vi.mock('../../src/lib/state', () => ({
  useChecks: useChecksMock,
  useDayNotes: useDayNotesMock,
  QUEUED_COPY: 'Saved on this phone — will sync when online',
}))
// The Day header carries a SyncBadge; keep the outbox (and its IndexedDB reads) out of these tests.
vi.mock('../../src/lib/sync', () => ({ useSync: () => ({ pending: 0, failed: 0, syncing: false, lastError: undefined, retryFailed: vi.fn() }) }))

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
  removePlace.mockReset()
  removePlace.mockResolvedValue(undefined)
  useDayNotesMock.mockReturnValue({
    note: '', savedPlaces: [], loading: false, setNote: vi.fn(), savePlace: vi.fn(), removePlace,
  })
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

test('clicking the tick calls toggle with the item id', async () => {
  renderDay('2026-11-02', content)
  const heading = await screen.findByText('Piazza Grande', { exact: false })
  const row = heading.closest('.stop-row') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: 'Mark done' }))
  expect(toggle).toHaveBeenCalledWith('valle/2026-11-02/0830/piazza-grande')
})

test('a failed toggle surfaces an inline "could not save" message that clears itself', async () => {
  toggle.mockRejectedValueOnce(new Error('offline'))
  renderDay('2026-11-02', content)
  const heading = await screen.findByText('Piazza Grande', { exact: false })
  const row = heading.closest('.stop-row') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: 'Mark done' }))
  expect(await screen.findByText("Couldn't save — you may be offline")).toBeInTheDocument()
})

test('a queued toggle surfaces the accent "saved on this phone" message, not the error one', async () => {
  toggle.mockResolvedValueOnce({ queued: true })
  renderDay('2026-11-02', content)
  const heading = await screen.findByText('Piazza Grande', { exact: false })
  const row = heading.closest('.stop-row') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: 'Mark done' }))
  const msg = await screen.findByText('Saved on this phone — will sync when online')
  expect(msg).toHaveClass('form__msg--queued')
  expect(screen.queryByText("Couldn't save — you may be offline")).toBeNull()
})

test('a null-block note with a lower sort renders before the Morning heading', async () => {
  const date = '2026-11-02'
  const note: ItemRow = {
    id: 'valle/2026-11-02/note', trip: 'valle', date, block: null, time: null, time_text: null,
    approx: false, kind: 'note', parent_item: null, plan: 'A note before Morning', details: null,
    sort: 0, place_name: null, address: null, lat: null, lng: null, url: null, route_id: null,
    photo_path: null, photo_credit: null,
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

test('the Map link carries the day being viewed', async () => {
  renderDay('2026-11-02', content)
  const link = await screen.findByRole('link', { name: 'Map' })
  expect(link).toHaveAttribute('href', '/map/2026-11-02')
})

test('a saved place renders as a chip with a Walk there link and a working ×', async () => {
  const saved: SavedPlace = { id: 'p1', name: 'Bar Sole', lat: 38.71, lng: -9.14, saved_at: '2026-11-02T10:00:00.000Z' }
  useDayNotesMock.mockReturnValue({
    note: '', savedPlaces: [saved], loading: false, setNote: vi.fn(), savePlace: vi.fn(), removePlace,
  })

  renderDay('2026-11-02', content)

  const row = (await screen.findByRole('heading', { name: 'Saved nearby' })).closest('.saved-places') as HTMLElement
  const chip = within(row).getByText('Bar Sole').closest('.saved-places__chip') as HTMLElement
  expect(within(chip).getByRole('link', { name: 'Walk there' }))
    .toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=38.71,-9.14&travelmode=walking')

  fireEvent.click(within(chip).getByRole('button', { name: 'Remove Bar Sole' }))
  await waitFor(() => expect(removePlace).toHaveBeenCalledWith('p1'))
})

test('the notes hook is keyed on the day in the URL, never a blank date', async () => {
  renderDay('2026-11-03', content)
  await screen.findByRole('link', { name: 'Map' })
  expect(useDayNotesMock).toHaveBeenCalledWith('valle', '2026-11-03')
})

test('the saved-places row stays hidden while the notes are still loading', async () => {
  const saved: SavedPlace = { id: 'p1', name: 'Bar Sole', lat: 38.71, lng: -9.14, saved_at: '2026-11-02T10:00:00.000Z' }
  useDayNotesMock.mockReturnValue({
    note: '', savedPlaces: [saved], loading: true, setNote: vi.fn(), savePlace: vi.fn(), removePlace,
  })

  renderDay('2026-11-02', content)

  await screen.findByRole('link', { name: 'Map' })
  expect(screen.queryByRole('heading', { name: 'Saved nearby' })).toBeNull()
  expect(screen.queryByText('Bar Sole')).toBeNull()
})

test('stops render as rows; a booked stop shows a ticket glyph linking to its ticket; others open the place', () => {
  renderDay('2026-11-02', content)   // Monday carries the named stops; the Trattoria stop resolves to T01 (same date) not B01
  const rows = document.querySelectorAll('.stop-row')
  expect(rows.length).toBeGreaterThan(0)
  const ticketLink = screen.getByRole('link', { name: /Open ticket/ })
  expect(ticketLink).toHaveAttribute('href', '/ticket/valle/T01?trip=valle')
  const placeLinks = screen.getAllByRole('link').filter(l => l.getAttribute('href')?.startsWith('/place/'))
  expect(placeLinks.length).toBeGreaterThan(0)
})

test('a stop whose details begin with a markdown link renders no nested <a> inside the place link', () => {
  const date = '2026-11-02'
  content.items = content.items.map(i =>
    i.id === 'valle/2026-11-02/0830/piazza-grande'
      ? { ...i, details: '**[Route](https://www.google.com/maps/dir/a/b)** — 3 min' }
      : i,
  )
  renderDay(date, content)
  const heading = screen.getByText('Piazza Grande', { exact: false })
  const main = heading.closest('.stop-row__main') as HTMLElement
  expect(within(main).queryByRole('link')).toBeNull()
  // ...and the label survives as text, without the raw markdown or the URL leaking through.
  expect(main.textContent).toContain('Route')
  expect(main.textContent).not.toContain('https://')
  expect(main.textContent).not.toContain('[Route]')
})

test('no weather strip and no trip picker on Day', () => {
  renderDay('2026-11-02', content)
  expect(document.querySelector('.weather')).toBeNull()
  expect(document.querySelector('.trip-picker')).toBeNull()
})

test('a row with a booking shows the kind and status badges', () => {
  renderDay('2026-11-02', content)
  const row = screen.getByRole('link', { name: /Open ticket/ }).closest('.stop-row') as HTMLElement
  expect(row.querySelector('.badge--kind')).not.toBeNull()
  expect(row.querySelector('.badge--status')).not.toBeNull()
})

test('a chip per day replaces the arrows; the shown day is marked and tapping another navigates', () => {
  renderDay('2026-11-02', content)
  const strip = screen.getByRole('list', { name: 'Days' })
  const chips = within(strip).getAllByRole('link')
  expect(chips).toHaveLength(content.days.length)
  expect(chips.map(c => c.textContent)).toEqual(['Sun1', 'Mon2', 'Tue3'])
  expect(chips[1]).toHaveAttribute('aria-current', 'date')
  expect(screen.queryByRole('button', { name: 'Previous day' })).toBeNull()
  fireEvent.click(chips[2])
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Tuesday 3 November/)
})

test('the routes panel and per-block route links are gone from Day', () => {
  renderDay('2026-11-02', content)
  expect(document.querySelector('.route-strip')).toBeNull()
  expect(document.querySelector('.route-link')).toBeNull()
  expect(screen.queryByRole('link', { name: /Open route/ })).toBeNull()
})
