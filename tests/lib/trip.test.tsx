import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadValle } from '../helpers/content'
import { mockSupabaseContent } from '../helpers/supabaseMock'
import { TripProvider, useTrip } from '../../src/lib/trip'
import { getCachedPlaceMeta, putCachedAreas, putCachedCity, resetDbForTests } from '../../src/lib/db'
import type { CityContent, PlaceMeta } from '../../src/lib/types'

function Probe() {
  const { slug, content, offline, error, loading, setSlug, refresh } = useTrip()
  return (
    <div>
      <button onClick={() => { void refresh() }}>refresh</button>
      <div data-testid="slug">{slug ?? 'null'}</div>
      <div data-testid="items">{content ? content.items.length : 'none'}</div>
      <div data-testid="offline">{String(offline)}</div>
      <div data-testid="error">{error ?? 'none'}</div>
      <div data-testid="loading">{String(loading)}</div>
      <button onClick={() => setSlug('x')}>set</button>
      <button onClick={() => setSlug('valle')}>set-valle</button>
      <button onClick={() => setSlug('other')}>set-other</button>
    </div>
  )
}

/**
 * A minimal hand-rolled Supabase mock (not tests/helpers/supabaseMock.ts) that serves
 * distinct CityContent per slug and can delay one slug's response — used to set up a
 * genuine race between two in-flight loadCity() calls.
 */
const RACE_TABLE: Record<string, keyof CityContent> = {
  trips: 'trip', days: 'days', items: 'items', bookings: 'bookings', routes: 'routes',
  legs: 'legs', alerts: 'alerts', parked_venues: 'parked', standing_notes: 'notes', offline_areas: 'areas',
}
function raceMock(contents: Record<string, CityContent>, delays: Record<string, number>): SupabaseClient {
  function query(table: string) {
    let slug: string | null = null
    const q: Record<string, unknown> = {
      select() { return q }, order() { return q }, limit() { return q },
      eq(_col: string, val: string) { slug = val; return q },
      not() { return q },
      then(res: (v: { data: unknown[]; error: null }) => void) {
        const respond = () => {
          if (slug === null) { res({ data: Object.values(contents).map(c => c.trip), error: null }); return }
          const c = contents[slug]
          res({ data: table === 'trips' ? [c.trip] : (c[RACE_TABLE[table]] as unknown[]), error: null })
        }
        const delay = slug !== null ? (delays[slug] ?? 0) : 0
        if (delay > 0) setTimeout(respond, delay); else respond()
      },
    }
    return q
  }
  return { from: query } as unknown as SupabaseClient
}

beforeEach(async () => {
  await resetDbForTests()
  await new Promise<void>(resolve => {
    const req = indexedDB.deleteDatabase('europe-guide')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
  localStorage.clear()
  history.replaceState(null, '', '/')
})

test('resolves the only trip and loads its content from a clean state', async () => {
  const content = await loadValle()
  const mock = mockSupabaseContent(content)
  render(<TripProvider client={mock.client}><Probe /></TripProvider>)
  await waitFor(() => expect(screen.getByTestId('slug')).toHaveTextContent('valle'))
  await waitFor(() => expect(screen.getByTestId('items')).toHaveTextContent(String(content.items.length)))
  expect(screen.getByTestId('offline')).toHaveTextContent('false')
  expect(screen.getByTestId('error')).toHaveTextContent('none')
})

test('falls back to cached content and reports offline when items fails but a cache exists', async () => {
  const content = await loadValle()
  await putCachedCity(content)
  const mock = mockSupabaseContent(content, { failTable: 'items' })
  render(<TripProvider client={mock.client}><Probe /></TripProvider>)
  await waitFor(() => expect(screen.getByTestId('offline')).toHaveTextContent('true'))
  expect(screen.getByTestId('items')).toHaveTextContent(String(content.items.length))
  expect(screen.getByTestId('error')).toHaveTextContent('none')
})

test('reports an error when the fetch fails and there is no cache', async () => {
  const content = await loadValle()
  const mock = mockSupabaseContent(content, { failTable: 'items' })
  render(<TripProvider client={mock.client}><Probe /></TripProvider>)
  await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent(/items/))
  expect(screen.getByTestId('offline')).toHaveTextContent('false')
})

test('setSlug persists the choice to localStorage', async () => {
  const content = await loadValle()
  const mock = mockSupabaseContent(content)
  render(<TripProvider client={mock.client}><Probe /></TripProvider>)
  await waitFor(() => expect(screen.getByTestId('slug')).toHaveTextContent('valle'))
  fireEvent.click(screen.getByRole('button', { name: 'set' }))
  expect(localStorage.getItem('europe-guide.trip')).toBe('x')
  await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent(/not found/))
})

test('a stale slug in localStorage that no longer names a trip falls back to the resolution rule', async () => {
  const content = await loadValle()
  localStorage.setItem('europe-guide.trip', 'ghost')
  const mock = mockSupabaseContent(content)
  render(<TripProvider client={mock.client}><Probe /></TripProvider>)
  await waitFor(() => expect(screen.getByTestId('slug')).toHaveTextContent('valle'))
})

test('the ?trip= query param wins over localStorage', async () => {
  const content = await loadValle()
  localStorage.setItem('europe-guide.trip', 'other')
  history.replaceState(null, '', '/?trip=valle')
  const mock = mockSupabaseContent(content)
  render(<TripProvider client={mock.client}><Probe /></TripProvider>)
  await waitFor(() => expect(screen.getByTestId('slug')).toHaveTextContent('valle'))
})

test('a later setSlug wins over a slower earlier one (staleness guard)', async () => {
  const content = await loadValle()
  const other: CityContent = { ...structuredClone(content), trip: { ...content.trip, slug: 'other', name: 'Other' }, items: content.items.slice(0, 2) }
  // 'other' is inserted first so it is trips[0] and thus the default initial slug — the
  // two clicks below are then both genuine slug transitions, each starting a fresh loadCity().
  const contents: Record<string, CityContent> = { other, valle: content }
  const client = raceMock(contents, { valle: 50, other: 0 })
  render(<TripProvider client={client}><Probe /></TripProvider>)
  await waitFor(() => expect(screen.getByTestId('slug')).toHaveTextContent(/^other$/))
  await waitFor(() => expect(screen.getByTestId('items')).toHaveTextContent(/^2$/))
  expect(content.items.length).not.toBe(other.items.length) // sanity: the two contents are genuinely distinguishable

  fireEvent.click(screen.getByRole('button', { name: 'set-valle' })) // slow: 50ms
  fireEvent.click(screen.getByRole('button', { name: 'set-other' })) // fast: resolves first

  await waitFor(() => expect(screen.getByTestId('items')).toHaveTextContent(/^2$/))
  expect(screen.getByTestId('slug')).toHaveTextContent(/^other$/)

  // let the slow, now-stale 'valle' response arrive and confirm it is discarded
  await new Promise(resolve => setTimeout(resolve, 80))
  expect(screen.getByTestId('slug')).toHaveTextContent(/^other$/)
  expect(screen.getByTestId('items')).toHaveTextContent(/^2$/)
})

test('an initial seed skips the fetch entirely', async () => {
  const content = await loadValle()
  const throwingClient = { from: () => { throw new Error('should not be called') } } as unknown as SupabaseClient
  render(
    <TripProvider client={throwingClient} initial={{ trips: [content.trip], slug: 'valle', content }}>
      <Probe />
    </TripProvider>,
  )
  expect(screen.getByTestId('loading')).toHaveTextContent('false')
  expect(screen.getByTestId('slug')).toHaveTextContent('valle')
  expect(screen.getByTestId('items')).toHaveTextContent(String(content.items.length))
})

test('reports an error and no slug when the trips fetch fails with no cache', async () => {
  const content = await loadValle()
  const mock = mockSupabaseContent(content, { failTable: 'trips' })
  render(<TripProvider client={mock.client}><Probe /></TripProvider>)
  await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent(/trips/))
  expect(screen.getByTestId('slug')).toHaveTextContent('null')
})

test('refresh() shows "Refreshing…" for as long as it runs', async () => {
  const content = await loadValle()
  // A slow city read, so `loading` can be observed true while the refresh is in flight.
  const client = raceMock({ valle: content }, { valle: 60 })

  render(
    <TripProvider client={client} initial={{ trips: [content.trip], slug: 'valle', content }}>
      <Probe />
    </TripProvider>,
  )
  expect(screen.getByTestId('loading').textContent).toBe('false')

  fireEvent.click(screen.getByText('refresh'))

  await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('true'))
  await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
})

function AreasProbe() {
  const { allAreas } = useTrip()
  return <div data-testid="all-areas">{allAreas.map(a => `${a.trip}:${a.seq}`).join(',')}</div>
}

test('the provider exposes offline areas for every trip, not just the city on screen', async () => {
  const content = await loadValle()
  const mock = mockSupabaseContent(content)
  render(<TripProvider client={mock.client}><AreasProbe /></TripProvider>)
  await waitFor(() => {
    expect(screen.getByTestId('all-areas').textContent)
      .toBe(content.areas.map(a => `${a.trip}:${a.seq}`).join(','))
  })
})

test('falls back to the cached areas when the network is gone', async () => {
  const content = await loadValle()
  await putCachedAreas(content.areas)
  const dead = { from: () => { throw new Error('offline') } } as unknown as SupabaseClient
  render(<TripProvider client={dead}><AreasProbe /></TripProvider>)
  await waitFor(() => {
    expect(screen.getByTestId('all-areas').textContent)
      .toBe(content.areas.map(a => `${a.trip}:${a.seq}`).join(','))
  })
})

function PlaceMetaProbe() {
  const { placeMeta } = useTrip()
  return <div data-testid="place-meta">{placeMeta.map(p => p.primary_type).join(',')}</div>
}

/**
 * Like raceMock, but the `items`/`parked_venues` chains also support `.select(META_COLS).not(...)`
 * (the metadata fetch), answering with `meta` — or rejecting both tables when `meta` is null, to
 * exercise the cached-fallback path. Everything else behaves like mockSupabaseContent's client.
 */
function metaMock(content: CityContent, meta: { items: PlaceMeta[]; parked: PlaceMeta[] } | null): SupabaseClient {
  function query(table: string) {
    let rows: unknown[] = table === 'trips' ? [content.trip] : (content[RACE_TABLE[table]] as unknown[] ?? [])
    const q: Record<string, unknown> = {
      select() { return q }, order() { return q }, limit() { return q },
      eq(col: string, val: unknown) { rows = (rows as Record<string, unknown>[]).filter(r => r[col] === val); return q },
      not(..._args: unknown[]) {
        if (meta === null) return Promise.reject(new Error(`${table} meta down`))
        return Promise.resolve({ data: table === 'items' ? meta.items : meta.parked, error: null })
      },
      then(res: (v: { data: unknown[]; error: null }) => void) { res({ data: rows, error: null }) },
    }
    return q
  }
  return { from: query } as unknown as SupabaseClient
}

test('TripProvider exposes placeMeta fetched with the trips, and serves the cached copy when the fetch fails', async () => {
  const content = await loadValle()
  const meta = {
    items: [{ primary_type: 'cafe', types: ['cafe'], price_level: null, rating: 4.9, rating_count: 198 }] as PlaceMeta[],
    parked: [{ primary_type: 'castle', types: ['castle'], price_level: null, rating: 4.4, rating_count: 5000 }] as PlaceMeta[],
  }
  const live = metaMock(content, meta)
  const { unmount } = render(<TripProvider client={live}><PlaceMetaProbe /></TripProvider>)
  await waitFor(() => expect(screen.getByTestId('place-meta')).toHaveTextContent('cafe,castle'))
  expect(await getCachedPlaceMeta()).toEqual([...meta.items, ...meta.parked])
  unmount()

  const dead = metaMock(content, null)
  render(<TripProvider client={dead}><PlaceMetaProbe /></TripProvider>)
  await waitFor(() => expect(screen.getByTestId('place-meta')).toHaveTextContent('cafe,castle'))
})

// ---- setSlug must not destroy the router's history state ---------------------
// react-router keeps { usr, key, idx } in history.state. Wiping it makes location.key read
// back as 'default', which is the value PlaceDetail/TicketDetail's Back button treats as
// "there is nowhere to go back to" — so Back silently becomes a REPLACE and the itinerary
// reopens at the top.
test('switching trip keeps the router history state intact', async () => {
  const content = await loadValle()
  const mock = mockSupabaseContent(content)
  history.replaceState({ usr: null, key: 'abc12345', idx: 3 }, '', '/day/2026-11-02')
  render(<TripProvider client={mock.client}><Probe /></TripProvider>)
  await screen.findByTestId('slug')
  fireEvent.click(screen.getByText('set-other'))
  await waitFor(() => {
    expect((history.state as { key?: string } | null)?.key).toBe('abc12345')
    expect((history.state as { idx?: number } | null)?.idx).toBe(3)
  })
})

test('switching trip still puts the new slug in the query string', async () => {
  const content = await loadValle()
  const mock = mockSupabaseContent(content)
  history.replaceState({ usr: null, key: 'abc12345', idx: 3 }, '', '/day/2026-11-02')
  render(<TripProvider client={mock.client}><Probe /></TripProvider>)
  await screen.findByTestId('slug')
  fireEvent.click(screen.getByText('set-other'))
  await waitFor(() => expect(location.search).toBe('?trip=other'))
})
