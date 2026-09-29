import { makeGoogleMetaFetcher, makeCachedMetaFetcher, enrichPlaceMeta, supabaseMetaCache } from '../../scripts/import/placeMeta'
import type { CityContent, PlaceMeta } from '../../scripts/import/types'
import type { SupabaseClient } from '@supabase/supabase-js'

const details = { primaryType: 'cafe', types: ['cafe', 'food', 'point_of_interest'], priceLevel: 'PRICE_LEVEL_MODERATE', rating: 4.9, userRatingCount: 198 }

test('google meta fetcher GETs Place Details with the five-field mask and maps the answer', async () => {
  let captured: { url: string; init: RequestInit } | null = null
  const fetchImpl = (async (url: string, init: RequestInit) => { captured = { url, init }; return new Response(JSON.stringify(details), { status: 200 }) }) as unknown as typeof fetch
  const f = makeGoogleMetaFetcher('K', fetchImpl)
  const r = await f('ChIJabc')
  expect(captured!.url).toBe('https://places.googleapis.com/v1/places/ChIJabc')
  expect((captured!.init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe('primaryType,types,priceLevel,rating,userRatingCount')
  expect((captured!.init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('K')
  expect(r).toEqual({ primary_type: 'cafe', types: ['cafe', 'food', 'point_of_interest'], price_level: 'PRICE_LEVEL_MODERATE', rating: 4.9, rating_count: 198 })
})

test('google meta fetcher accepts an id that already carries the places/ prefix and leaves absent fields null', async () => {
  let url = ''
  const fetchImpl = (async (u: string) => { url = u; return new Response(JSON.stringify({ types: ['museum'] }), { status: 200 }) }) as unknown as typeof fetch
  const r = await makeGoogleMetaFetcher('K', fetchImpl)('places/ChIJxyz')
  expect(url).toBe('https://places.googleapis.com/v1/places/ChIJxyz')
  expect(r).toEqual({ primary_type: null, types: ['museum'], price_level: null, rating: null, rating_count: null })
})

test('google meta fetcher returns null on 404 and throws on other HTTP errors', async () => {
  const f404 = makeGoogleMetaFetcher('K', (async () => new Response('gone', { status: 404 })) as unknown as typeof fetch)
  expect(await f404('ChIJ1')).toBeNull()
  const f500 = makeGoogleMetaFetcher('K', (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch)
  await expect(f500('ChIJ1')).rejects.toThrow(/place details HTTP 500/)
})

test('cached meta fetcher hits the cache first and writes on miss', async () => {
  const store = new Map<string, PlaceMeta>()
  let calls = 0
  const inner = async () => { calls++; return { primary_type: 'cafe', types: ['cafe'], price_level: null, rating: 4.5, rating_count: 10 } }
  const f = makeCachedMetaFetcher(inner, { get: async id => store.get(id) ?? null, set: async (id, v) => { store.set(id, v) } })
  await f('a'); await f('a'); await f('b')
  expect(calls).toBe(2); expect(store.size).toBe(2)
})

test('enrichPlaceMeta fills items and parked from the geocoder place_id, skips rows without a place, reports misses', async () => {
  const geocode = async (q: string) => (q.startsWith('Miss') ? null : { lat: 1, lng: 2, formatted: q, place_id: `pid:${q}` })
  const metaFor: Record<string, PlaceMeta | null> = {
    'pid:Falta Café, R. das Fontaínhas 6, Lisboa': { primary_type: 'cafe', types: ['cafe'], price_level: null, rating: 4.9, rating_count: 198 },
    'pid:Castle, Lisboa': { primary_type: 'castle', types: ['castle'], price_level: null, rating: 4.4, rating_count: 5000 },
  }
  let fetched = 0
  const fetchMeta = async (id: string) => { fetched++; return metaFor[id] ?? null }
  const c = {
    items: [
      { kind: 'stop', place_name: 'Falta Café', address: 'R. das Fontaínhas 6', lat: 1, lng: 2 },
      { kind: 'stop', place_name: 'Miss Me', address: null, lat: null, lng: null },
      { kind: 'note', place_name: null },
      { kind: 'stop', place_name: 'Already', address: null, lat: 1, lng: 2, primary_type: 'bar', types: ['bar'], price_level: null, rating: 4, rating_count: 1 },
    ],
    parked: [{ name: 'Castle', address: null, lat: 1, lng: 2 }],
  } as unknown as CityContent
  const r = await enrichPlaceMeta(c, geocode, fetchMeta, 'Lisboa')
  expect(c.items[0]).toMatchObject({ primary_type: 'cafe', rating_count: 198 })
  expect(c.items[3]).toMatchObject({ primary_type: 'bar' })          // already had metadata: untouched
  expect(c.parked[0]).toMatchObject({ primary_type: 'castle' })
  expect(fetched).toBe(2)                                             // 'Already' and the note cost nothing
  expect(r).toEqual({ fetched: 2, missing: ['Miss Me, Lisboa'] })
})

test('supabaseMetaCache reads the geocode_cache row by place_id and upserts the five fields', async () => {
  const calls: { op: string; payload?: unknown; filter?: unknown }[] = []
  const fakeClient = {
    from: () => ({
      select: () => ({ eq: (col: string, v: string) => ({ maybeSingle: async () => { calls.push({ op: 'select', filter: [col, v] }); return { data: { primary_type: 'cafe', types: ['cafe'], price_level: null, rating: 4.5, rating_count: 20, meta_fetched_at: '2026-09-29T00:00:00Z' }, error: null } } }) }),
      update: (payload: unknown) => ({ eq: async (col: string, v: string) => { calls.push({ op: 'update', payload, filter: [col, v] }); return { error: null } } }),
    }),
  } as unknown as SupabaseClient
  const cache = supabaseMetaCache(fakeClient)
  expect(await cache.get('ChIJ1')).toEqual({ primary_type: 'cafe', types: ['cafe'], price_level: null, rating: 4.5, rating_count: 20 })
  expect(calls[0]).toEqual({ op: 'select', filter: ['place_id', 'ChIJ1'] })
  await cache.set('ChIJ1', { primary_type: 'bar', types: ['bar'], price_level: null, rating: 4, rating_count: 1 })
  expect(calls[1].op).toBe('update')
  expect(calls[1].payload).toMatchObject({ primary_type: 'bar', types: ['bar'], rating: 4, rating_count: 1 })
  expect((calls[1].payload as { meta_fetched_at: string }).meta_fetched_at).toMatch(/^\d{4}-/)
})

test('supabaseMetaCache treats a row without meta_fetched_at as a miss', async () => {
  const fakeClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { primary_type: null, types: null, price_level: null, rating: null, rating_count: null, meta_fetched_at: null }, error: null }) }) }) }) } as unknown as SupabaseClient
  expect(await supabaseMetaCache(fakeClient).get('ChIJ1')).toBeNull()
})
