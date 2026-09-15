import { splitLegs, fetchPolyline } from '../../scripts/import/legs'
import type { RouteRow } from '../../scripts/import/types'
const route: RouteRow = { id: 'W3', trip: 'lisbon', date: '2026-09-30', title: 'x', distance_text: null, mode: 'walking', covers: [], note: null, sort: 0,
  google_url: 'https://www.google.com/maps/dir/?api=1&origin=Miradouro+de+Santa+Catarina%2C+Lisboa&destination=Mesa+de+Frades%2C+R.+dos+Rem%C3%A9dios+139A%2C+Lisboa&waypoints=Pra%C3%A7a+do+Com%C3%A9rcio%2C+Lisboa&travelmode=walking' }
test('splitLegs makes N-1 hops with single-destination deep links', () => {
  const legs = splitLegs(route)
  expect(legs).toHaveLength(2)
  expect(legs[0]).toMatchObject({ trip: 'lisbon', route_id: 'W3', seq: 0, from_name: 'Miradouro de Santa Catarina, Lisboa', to_name: 'Praça do Comércio, Lisboa' })
  expect(legs[1].to_name).toBe('Mesa de Frades, R. dos Remédios 139A, Lisboa')
  const u = new URL(legs[0].google_url)
  expect(u.searchParams.get('origin')).toBe('Miradouro de Santa Catarina, Lisboa')
  expect(u.searchParams.get('destination')).toBe('Praça do Comércio, Lisboa')
  expect(u.searchParams.get('travelmode')).toBe('walking')
  expect(u.searchParams.get('waypoints')).toBeNull()
})
test('fetchPolyline posts to Routes API with WALK and reads the first route', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ routes: [{ polyline: { encodedPolyline: 'abc' }, distanceMeters: 1200, duration: '900s' }] })) }) as typeof fetch
  const leg = { ...splitLegs(route)[0], from_lat: 38.71, from_lng: -9.15, to_lat: 38.707, to_lng: -9.136 }
  const r = await fetchPolyline('KEY', leg, 'walking', fetchImpl)
  expect(r).toEqual({ polyline: 'abc', distance_m: 1200, duration_s: 900 })
  expect(calls[0].url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes')
  const body = JSON.parse(calls[0].init.body as string)
  expect(body.travelMode).toBe('WALK')
  expect((calls[0].init.headers as Record<string, string>)['X-Goog-FieldMask']).toContain('routes.polyline.encodedPolyline')
})
test('fetchPolyline returns null when endpoints are not geocoded', async () => {
  expect(await fetchPolyline('KEY', splitLegs(route)[0], 'walking')).toBeNull()
})
