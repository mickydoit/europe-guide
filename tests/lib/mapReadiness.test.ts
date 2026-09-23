import { test, expect } from 'vitest'
import { fullyCachedSlugs, needsDownload } from '../../src/lib/mapReadiness'
import { cacheKey } from '../../src/lib/offlineMaps'
import { FakeCacheStorage } from '../helpers/fakeCaches'
import type { OfflineAreaRow, TripRow } from '../../src/lib/types'

function trip(slug: string, start: string, end: string, sort: number): TripRow {
  return {
    slug, name: slug[0].toUpperCase() + slug.slice(1), country: 'Nowhere', country_code: 'NW',
    start_date: start, end_date: end, base: null, timezone: 'Europe/Istanbul', intro: null, sort,
  }
}

function area(slug: string, bytes: number, seq = 0): OfflineAreaRow {
  return {
    trip: slug, seq, name: `${slug} centre`, min_lng: 0, min_lat: 0, max_lng: 1, max_lat: 1,
    pmtiles_path: `${slug}/${seq}.pmtiles`, size_bytes: bytes, built_at: '2026-01-01',
  }
}

// Past, current, future — the shape of a multi-city trip mid-flight.
const TRIPS = [
  trip('alba', '2026-09-10', '2026-09-15', 1),
  trip('bruna', '2026-09-21', '2026-09-25', 2),
  trip('corta', '2026-09-25', '2026-09-28', 3),
  trip('delta', '2026-10-05', '2026-10-10', 4),
]
const AREAS: Record<string, OfflineAreaRow[]> = {
  alba: [area('alba', 1_000_000)],
  bruna: [area('bruna', 3_000_000)],
  corta: [area('corta', 1_500_000)],
  delta: [area('delta', 9_000_000)],
}
const TODAY = '2026-09-23'

test('names the city you are in when its map is not on the phone', () => {
  const need = needsDownload(TRIPS, AREAS, new Set(), TODAY)
  expect(need.map(n => n.slug)).toContain('bruna')
})

test('a city whose map is fully cached is not named', () => {
  const need = needsDownload(TRIPS, AREAS, new Set(['bruna']), TODAY)
  expect(need.map(n => n.slug)).not.toContain('bruna')
})

test('a trip that has already ended is never named, cached or not', () => {
  const need = needsDownload(TRIPS, AREAS, new Set(), TODAY)
  expect(need.map(n => n.slug)).not.toContain('alba')
})

test('an upcoming city is named before you get there', () => {
  const need = needsDownload(TRIPS, AREAS, new Set(), TODAY)
  expect(need.map(n => n.slug)).toEqual(['bruna', 'corta', 'delta'])
})

test('the city you are in is marked as needed now, a later one carries its start date', () => {
  const need = needsDownload(TRIPS, AREAS, new Set(), TODAY)
  expect(need.find(n => n.slug === 'bruna')?.neededOn).toBeNull()
  expect(need.find(n => n.slug === 'corta')?.neededOn).toBe('2026-09-25')
})

test('carries the total bytes so the card can offer a size', () => {
  const need = needsDownload(TRIPS, AREAS, new Set(), TODAY)
  expect(need.find(n => n.slug === 'corta')?.bytes).toBe(1_500_000)
})

test('sums bytes across several areas of one city', () => {
  const areas = { ...AREAS, corta: [area('corta', 1_500_000, 0), area('corta', 500_000, 1)] }
  const need = needsDownload(TRIPS, areas, new Set(), TODAY)
  expect(need.find(n => n.slug === 'corta')?.bytes).toBe(2_000_000)
})

// A city with no tiles cut yet cannot be downloaded, so warning about it would be a dead end.
test('a city with no offline areas at all is not named', () => {
  const areas = { ...AREAS, corta: [] }
  const need = needsDownload(TRIPS, areas, new Set(), TODAY)
  expect(need.map(n => n.slug)).not.toContain('corta')
})

test('a city missing from the areas map entirely is not named', () => {
  const { corta: _omitted, ...areas } = AREAS
  const need = needsDownload(TRIPS, areas, new Set(), TODAY)
  expect(need.map(n => n.slug)).not.toContain('corta')
})

test('nothing to do when every city ahead is already saved', () => {
  const need = needsDownload(TRIPS, AREAS, new Set(['bruna', 'corta', 'delta']), TODAY)
  expect(need).toEqual([])
})

// The last day of a city still counts as being in it — you need the map until you leave.
test('a trip ending today is still named', () => {
  const trips = [trip('bruna', '2026-09-21', TODAY, 1)]
  const need = needsDownload(trips, AREAS, new Set(), TODAY)
  expect(need.map(n => n.slug)).toEqual(['bruna'])
})

// ---- fullyCachedSlugs ------------------------------------------------------

async function seed(cs: FakeCacheStorage, slug: string, seq: number, bytes: number) {
  const cache = await cs.open('europe-guide-maps')
  await cache.put(cacheKey(slug, seq), new Response(new Uint8Array(bytes).buffer))
}

test('a city with every area cached is reported as cached', async () => {
  const cs = new FakeCacheStorage()
  await seed(cs, 'bruna', 0, 3_000_000)
  const got = await fullyCachedSlugs(AREAS, cs as unknown as CacheStorage)
  expect(got.has('bruna')).toBe(true)
})

test('a city with no cached areas is not reported as cached', async () => {
  const cs = new FakeCacheStorage()
  const got = await fullyCachedSlugs(AREAS, cs as unknown as CacheStorage)
  expect(got.has('bruna')).toBe(false)
})

test('a city with only some of its areas cached is not reported as cached', async () => {
  const cs = new FakeCacheStorage()
  const areas = { corta: [area('corta', 1_500_000, 0), area('corta', 500_000, 1)] }
  await seed(cs, 'corta', 0, 1_500_000)
  const got = await fullyCachedSlugs(areas, cs as unknown as CacheStorage)
  expect(got.has('corta')).toBe(false)
})

// Cached bytes that no longer match the row mean the city was re-cut since it was saved;
// that is a different map, so it must not count as ready.
test('a city whose cached bytes no longer match its row is not reported as cached', async () => {
  const cs = new FakeCacheStorage()
  await seed(cs, 'bruna', 0, 12)
  const got = await fullyCachedSlugs(AREAS, cs as unknown as CacheStorage)
  expect(got.has('bruna')).toBe(false)
})
