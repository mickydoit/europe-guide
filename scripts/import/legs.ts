import { pointsFromGoogleUrl } from './places'
import type { RouteRow, LegRow } from './types'
export function splitLegs(route: RouteRow): LegRow[] {
  const { names } = pointsFromGoogleUrl(route.google_url); const legs: LegRow[] = []
  for (let i = 0; i < names.length - 1; i++) {
    const p = new URLSearchParams({ api: '1', origin: names[i], destination: names[i + 1], travelmode: route.mode })
    legs.push({ trip: route.trip, route_id: route.id, seq: i, from_name: names[i], to_name: names[i + 1], from_lat: null, from_lng: null, to_lat: null, to_lng: null, google_url: `https://www.google.com/maps/dir/?${p.toString()}`, polyline: null, distance_m: null, duration_s: null })
  }
  return legs
}
const MODE = { walking: 'WALK', driving: 'DRIVE', transit: 'TRANSIT' } as const
export async function fetchPolyline(key: string, leg: LegRow, mode: RouteRow['mode'], fetchImpl: typeof fetch = fetch) {
  if (leg.from_lat == null || leg.to_lat == null) return null
  const body = { origin: { location: { latLng: { latitude: leg.from_lat, longitude: leg.from_lng } } }, destination: { location: { latLng: { latitude: leg.to_lat, longitude: leg.to_lng } } }, travelMode: MODE[mode], polylineQuality: 'HIGH_QUALITY' }
  const res = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration' }, body: JSON.stringify(body) })
  const j = await res.json() as { routes?: { polyline: { encodedPolyline: string }; distanceMeters: number; duration: string }[]; error?: { message: string } }
  if (j.error) throw new Error(`routes api: ${j.error.message}`)
  const r = j.routes?.[0]; if (!r) return null
  return { polyline: r.polyline.encodedPolyline, distance_m: r.distanceMeters, duration_s: parseInt(r.duration, 10) }
}
