import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { cacheKey } from '../../src/lib/offlineMaps'
import { loadValle } from '../helpers/content'
import type { CityContent, OfflineAreaRow } from '../../src/lib/types'

// ---------------------------------------------------------------- maplibre stub
interface Recorded { ev: string; layers: string[] | null; fn: (arg?: unknown) => void }

const { maplibreState, savePlace } = vi.hoisted(() => ({
  maplibreState: {
    instances: [] as { style: unknown }[],
    handlers: [] as Recorded[],
    sources: [] as { id: string }[],
    layers: [] as { id: string }[],
    fits: [] as unknown[],
    setDataCalls: [] as { id: string; data: unknown }[],
    removed: 0,
    protocolAdds: 0,
    protocolsRegistered: 0,
  },
  savePlace: vi.fn(),
}))

vi.mock('maplibre-gl', () => {
  class MapStub {
    constructor(opts: { style: unknown }) { maplibreState.instances.push({ style: opts.style }) }
    on(ev: string, a: unknown, b?: unknown) {
      const layers = typeof a === 'function' ? null : (a as string[])
      const fn = (typeof a === 'function' ? a : b) as (arg?: unknown) => void
      maplibreState.handlers.push({ ev, layers, fn })
      return this
    }
    addSource(id: string) { maplibreState.sources.push({ id }) }
    addLayer(layer: { id: string }) { maplibreState.layers.push({ id: layer.id }) }
    getLayer(id: string) { return maplibreState.layers.find(l => l.id === id) }
    getSource(id: string) {
      return { setData: (data: unknown) => maplibreState.setDataCalls.push({ id, data }) }
    }
    fitBounds(bounds: unknown, opts: unknown) { maplibreState.fits.push({ bounds, opts }) }
    getZoom() { return 12 }
    easeTo() {}
    flyTo() {}
    isStyleLoaded() { return true }
    getCanvas() { return { style: {} } }
    remove() { maplibreState.removed += 1 }
  }
  return { Map: MapStub, addProtocol: vi.fn(), removeProtocol: vi.fn(), Marker: class {} }
})

vi.mock('pmtiles', () => {
  class ProtocolStub {
    tile = vi.fn()
    constructor() { maplibreState.protocolsRegistered += 1 }
    add() { maplibreState.protocolAdds += 1 }
  }
  class PMTilesStub { constructor(public source: unknown) {} }
  return { Protocol: ProtocolStub, PMTiles: PMTilesStub }
})

vi.mock('../../src/lib/state', () => ({
  useChecks: () => ({ done: new Set<string>(), loading: false, toggle: vi.fn() }),
  useDayNotes: () => ({ note: '', savedPlaces: [], loading: false, setNote: vi.fn(), savePlace, removePlace: vi.fn() }),
}))

import MapScreen from '../../src/screens/Map'

// ---------------------------------------------------------------- cache polyfill
class FakeCache {
  store = new Map<string, Response>()
  async put(req: Request | string, res: Response) { this.store.set(typeof req === 'string' ? req : req.url, res.clone()) }
  async match(req: Request | string) { return this.store.get(typeof req === 'string' ? req : req.url) }
  async delete(req: Request | string) { return this.store.delete(typeof req === 'string' ? req : req.url) }
  async keys() { return [...this.store.keys()] }
}
class FakeCacheStorage {
  caches = new Map<string, FakeCache>()
  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache())
    return this.caches.get(name) as unknown as Cache
  }
  async delete(name: string) { return this.caches.delete(name) }
  async has(name: string) { return this.caches.has(name) }
  async keys() { return [...this.caches.keys()] }
  async match() { return undefined }
}

const AREAS: OfflineAreaRow[] = [
  { trip: 'valle', seq: 1, name: 'Centre', min_lng: -9.2, min_lat: 38.6, max_lng: -9.1, max_lat: 38.8, pmtiles_path: 'valle/1.pmtiles', size_bytes: 6 * 1024 * 1024, built_at: '2026-01-01' },
  { trip: 'valle', seq: 2, name: 'Outskirts', min_lng: -9.3, min_lat: 38.5, max_lng: -9.2, max_lat: 38.7, pmtiles_path: 'valle/2.pmtiles', size_bytes: 6 * 1024 * 1024, built_at: '2026-01-01' },
]

const MONDAY = '2026-11-02'
const throwingClient = new Proxy({}, { get() { throw new Error('no network in tests') } }) as never

let cacheStorage: FakeCacheStorage
let content: CityContent

async function makeContent(withAreas: boolean): Promise<CityContent> {
  const c = await loadValle()
  const coords: Record<string, [number, number]> = {
    '08:30': [38.71, -9.14],
    '10:00': [38.712, -9.145],
    '11:00': [38.715, -9.15],
  }
  for (const item of c.items) {
    if (item.kind !== 'stop' || item.date !== MONDAY) continue
    const co = item.time ? coords[item.time] : undefined
    if (co) { item.lat = co[0]; item.lng = co[1] }
  }
  c.areas = withAreas ? AREAS.map(a => ({ ...a })) : []
  return c
}

function renderMap(c: CityContent) {
  return render(
    <MemoryRouter initialEntries={['/map']}>
      <TripProvider initial={{ trips: [c.trip], slug: 'valle', content: c }} client={throwingClient}>
        <MapScreen />
      </TripProvider>
    </MemoryRouter>,
  )
}

async function seedCache(areas: OfflineAreaRow[]) {
  const cache = await cacheStorage.open('europe-guide-maps')
  for (const area of areas) {
    await cache.put(
      cacheKey('valle', area.seq),
      new Response(new Uint8Array([1, 2, 3]).buffer, { headers: { 'content-length': '3' } }),
    )
  }
}

beforeEach(async () => {
  cacheStorage = new FakeCacheStorage()
  vi.stubGlobal('caches', cacheStorage as unknown as CacheStorage)
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition: vi.fn(() => 7), clearWatch: vi.fn() },
  })
  maplibreState.instances = []
  maplibreState.handlers = []
  maplibreState.sources = []
  maplibreState.layers = []
  maplibreState.fits = []
  maplibreState.setDataCalls = []
  maplibreState.removed = 0
  maplibreState.protocolAdds = 0
  localStorage.clear()
  content = await makeContent(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function fire(ev: string, arg?: unknown) {
  const handlers = maplibreState.handlers.filter(h => h.ev === ev)
  act(() => { for (const h of handlers) h.fn(arg) })
}

test('renders the Close button and the Today | All control', async () => {
  renderMap(content)
  expect(await screen.findByRole('button', { name: 'Close map' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Locate me' })).toBeInTheDocument()
})

test('with every area cached, one PMTiles archive is added per area and the style carries N sources', async () => {
  const withAreas = await makeContent(true)
  await seedCache(withAreas.areas)

  renderMap(withAreas)

  await waitFor(() => expect(maplibreState.instances.length).toBe(1))
  expect(maplibreState.protocolAdds).toBe(2)
  const style = maplibreState.instances[0].style as { sources: Record<string, { url: string }> }
  expect(Object.keys(style.sources)).toEqual(['area-1', 'area-2'])
  expect(style.sources['area-1'].url).toBe('pmtiles://maps/valle/1')
  expect(style.sources['area-2'].url).toBe('pmtiles://maps/valle/2')
})

test('with nothing cached and offline, the not-downloaded banner shows and the map still renders', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const withAreas = await makeContent(true)

  renderMap(withAreas)

  expect(await screen.findByText(/Offline map not downloaded/)).toBeInTheDocument()
  await waitFor(() => expect(maplibreState.instances.length).toBe(1))
  const style = maplibreState.instances[0].style as { sources: Record<string, unknown> }
  expect(Object.keys(style.sources)).toEqual([])
})

test('online with nothing cached shows the download prompt with Download and Later', async () => {
  const withAreas = await makeContent(true)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  // defaultSigner would hit Supabase; stub the storage call it makes.
  const { supabase } = await import('../../src/lib/supabase')
  vi.spyOn(supabase.storage, 'from').mockReturnValue({
    createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed.example/${path}` }, error: null }),
  } as never)

  renderMap(withAreas)

  expect(await screen.findByText(/Download the Valle offline map \(12 MB\)\?/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument()
})

test('tapping a stop opens the sheet with its title and a Walk there link', async () => {
  renderMap(content)
  await waitFor(() => expect(maplibreState.instances.length).toBe(1))

  fire('load')
  expect(maplibreState.layers.map(l => l.id)).toEqual([
    'legs-line', 'parked-circle', 'stops-circle', 'stops-label', 'user-accuracy', 'user-dot',
  ])

  const stop = content.items.find(i => i.kind === 'stop' && i.date === MONDAY && i.time === '11:00')!
  fire('click', { features: [{ layer: { id: 'stops-circle' }, properties: { id: stop.id, kind: 'stop' } }] })

  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveAttribute('aria-label', stop.place_name ?? stop.plan)
  const walk = screen.getByRole('link', { name: 'Walk there' })
  expect(walk).toHaveAttribute('href', expect.stringContaining('destination='))
})

test('geolocation is watched on mount and cleared on unmount, and the map is removed', async () => {
  const geo = navigator.geolocation as unknown as { watchPosition: ReturnType<typeof vi.fn>; clearWatch: ReturnType<typeof vi.fn> }
  const { unmount } = renderMap(content)
  await waitFor(() => expect(maplibreState.instances.length).toBe(1))

  expect(geo.watchPosition).toHaveBeenCalledTimes(1)
  expect(geo.watchPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 })

  unmount()
  expect(geo.clearWatch).toHaveBeenCalledWith(7)
  expect(maplibreState.removed).toBe(1)
})
