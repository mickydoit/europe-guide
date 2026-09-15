import polyline from '@mapbox/polyline'

const EARTH_RADIUS_M = 6_371_000

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const d = Math.PI / 180
  const dLat = (b.lat - a.lat) * d
  const dLng = (b.lng - a.lng) * d
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** Decodes a Google-encoded polyline into GeoJSON-order [lng, lat] pairs. */
export function decodePolyline(encoded: string): [number, number][] {
  return polyline.decode(encoded).map(([lat, lng]) => [lng, lat])
}

/** Padded bounding box (metres) as [minLng, minLat, maxLng, maxLat]. */
export function bboxOfPoints(points: [number, number][], padM = 200): [number, number, number, number] {
  const lngs = points.map(p => p[0])
  const lats = points.map(p => p[1])
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const dLat = padM / 111_320
  const midLat = (minLat + maxLat) / 2
  const dLng = padM / (111_320 * Math.cos((midLat * Math.PI) / 180))
  return [minLng - dLng, minLat - dLat, maxLng + dLng, maxLat + dLat]
}

export function distanceLabel(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(1)} km`
}
