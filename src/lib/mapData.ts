import type { CityContent } from './types'
import { decodePolyline, bboxOfPoints } from './geo'

function stripBold(text: string): string {
  return text.replace(/\*\*/g, '')
}

export function stopsGeoJSON(
  content: CityContent,
  date: string | null,
  done: Set<string>,
): GeoJSON.FeatureCollection {
  const items = content.items
    .filter(
      (item): item is typeof item & { lat: number; lng: number } =>
        item.kind === 'stop' &&
        item.lat != null &&
        item.lng != null &&
        (date == null || item.date === date),
    )
    .sort((a, b) => (a.date === b.date ? a.sort - b.sort : a.date.localeCompare(b.date)))

  return {
    type: 'FeatureCollection',
    features: items.map((item, index) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [item.lng, item.lat] },
      properties: {
        id: item.id,
        n: index + 1,
        title: stripBold(item.place_name ?? item.plan),
        time: item.time ?? null,
        done: done.has(item.id),
        date: item.date,
      },
    })),
  }
}

export function parkedGeoJSON(content: CityContent): GeoJSON.FeatureCollection {
  const rows = content.parked.filter(
    (row): row is typeof row & { lat: number; lng: number } => row.lat != null && row.lng != null,
  )

  return {
    type: 'FeatureCollection',
    features: rows.map(row => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
      properties: {
        id: `parked:${row.seq}`,
        title: row.name,
        what: row.what ?? '',
        kind: 'parked',
      },
    })),
  }
}

export function legsGeoJSON(content: CityContent, date: string | null): GeoJSON.FeatureCollection {
  const routeById = new Map(content.routes.map(route => [route.id, route]))
  const features: GeoJSON.Feature[] = []

  for (const leg of content.legs) {
    const route = routeById.get(leg.route_id)
    if (!route) continue
    if (date != null && route.date !== date) continue

    let coordinates: [number, number][]
    if (leg.polyline) {
      coordinates = decodePolyline(leg.polyline)
    } else if (leg.from_lat != null && leg.from_lng != null && leg.to_lat != null && leg.to_lng != null) {
      coordinates = [
        [leg.from_lng, leg.from_lat],
        [leg.to_lng, leg.to_lat],
      ]
    } else {
      continue
    }

    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: { route_id: leg.route_id, seq: leg.seq, mode: route.mode },
    })
  }

  return { type: 'FeatureCollection', features }
}

export interface Place {
  id: string
  name: string
  lat: number
  lng: number
  rating: number | null
  openNow: boolean | null
}

export function placesGeoJSON(places: Place[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: places.map(place => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [place.lng, place.lat] },
      properties: {
        id: place.id,
        title: place.name,
        rating: place.rating,
        open: place.openNow,
        kind: 'place',
      },
    })),
  }
}

export function boundsFor(
  fc: GeoJSON.FeatureCollection,
  padM = 200,
): [number, number, number, number] | null {
  const points: [number, number][] = []
  for (const feature of fc.features) {
    const geometry = feature.geometry
    if (geometry.type === 'Point') {
      points.push(geometry.coordinates as [number, number])
    } else if (geometry.type === 'LineString') {
      points.push(...(geometry.coordinates as [number, number][]))
    }
  }
  if (points.length === 0) return null
  return bboxOfPoints(points, padM)
}
