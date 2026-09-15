import { makeGoogleGeocoder, makeCachedGeocoder, geocodeContent, supabaseCache } from '../../scripts/import/geocode'
import type { CityContent } from '../../scripts/import/types'
import type { SupabaseClient } from '@supabase/supabase-js'
test('google geocoder parses the first result and returns null on ZERO_RESULTS', async () => {
  const fetchImpl = (async (url: string) => new Response(JSON.stringify(url.includes('Nowhere') ? { status: 'ZERO_RESULTS', results: [] } :
    { status: 'OK', results: [{ geometry: { location: { lat: 1.5, lng: 2.5 } }, formatted_address: 'F', place_id: 'P' }] }))) as typeof fetch
  const g = makeGoogleGeocoder('K', 'pt', fetchImpl)
  expect(await g('Senzi, Lisboa')).toEqual({ lat: 1.5, lng: 2.5, formatted: 'F', place_id: 'P' })
  expect(await g('Nowhere')).toBeNull()
})
test('google geocoder surfaces non-JSON HTTP errors with status and query', async () => {
  const fetchImpl = (async () => new Response('<html>Forbidden</html>', { status: 403 })) as typeof fetch
  const g = makeGoogleGeocoder('K', 'pt', fetchImpl)
  await expect(g('Senzi, Lisboa')).rejects.toThrow(/HTTP 403/)
  await expect(g('Senzi, Lisboa')).rejects.toThrow(/Senzi, Lisboa/)
})
test('cached geocoder hits cache first and writes on miss', async () => {
  const store = new Map<string, { lat: number; lng: number; formatted: string; place_id: string }>()
  let innerCalls = 0
  const inner = async (q: string) => { innerCalls++; return { lat: 1, lng: 2, formatted: q, place_id: 'x' } }
  const g = makeCachedGeocoder(inner, { get: async q => store.get(q) ?? null, set: async (q, v) => { store.set(q, v) } })
  await g('A'); await g('A'); await g('B')
  expect(innerCalls).toBe(2); expect(store.size).toBe(2)
})
test('geocodeContent fills items, parked and leg endpoints and reports misses', async () => {
  const g = async (q: string) => (q.startsWith('Miss') ? null : { lat: 10, lng: 20, formatted: q, place_id: 'p' })
  const c = { trip: { slug: 'v' }, items: [{ kind: 'stop', place_name: 'Caffè Nord', address: 'Via Roma 12', lat: null, lng: null }, { kind: 'stop', place_name: 'Miss Me', address: null, lat: null, lng: null }, { kind: 'note', place_name: null }],
    parked: [{ name: 'Castle', address: null, lat: null, lng: null }], legs: [{ from_name: 'A, Valle', to_name: 'Miss B', from_lat: null, from_lng: null, to_lat: null, to_lng: null }] } as unknown as CityContent
  const r = await geocodeContent(c, g, 'Valle')
  expect(c.items[0]).toMatchObject({ lat: 10, lng: 20 }); expect(c.parked[0].lat).toBe(10)
  expect(c.legs[0]).toMatchObject({ from_lat: 10, to_lat: null })
  expect(r.misses).toEqual(['Miss Me, Valle', 'Miss B'])
})
test('supabaseCache warns and treats a select/upsert error as a miss, without throwing', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const fakeClient = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }),
      upsert: async () => ({ error: { message: 'boom' } }),
    }),
  } as unknown as SupabaseClient
  const cache = supabaseCache(fakeClient, 'owner-1')
  const inner = async (q: string) => ({ lat: 1, lng: 2, formatted: q, place_id: 'p' })
  const g = makeCachedGeocoder(inner, cache)
  const r = await g('Somewhere')
  expect(r).toEqual({ lat: 1, lng: 2, formatted: 'Somewhere', place_id: 'p' })
  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})
