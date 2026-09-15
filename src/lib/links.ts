import type { RouteRow, LegRow } from './types'

export function walkLink(
  p: { lat: number | null; lng: number | null; name: string | null; address?: string | null },
  tripName: string,
  mode: 'walking' | 'driving' = 'walking',
): string | null {
  if (p.lat != null && p.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=${mode}`
  }
  if (p.name) {
    const query = [p.name, p.address, tripName].filter(Boolean).join(', ')
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}&travelmode=${mode}`
  }
  return null
}

export function routeLink(route: RouteRow): string {
  return route.google_url
}

export function legLink(leg: LegRow): string {
  return leg.google_url
}
