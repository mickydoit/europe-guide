import { loadValle } from '../helpers/content'
import { stopsGeoJSON, parkedGeoJSON, legsGeoJSON, placesGeoJSON, boundsFor } from '../../src/lib/mapData'
import type { CityContent } from '../../src/lib/types'

const MONDAY = '2026-11-02'

async function loadValleWithCoords(): Promise<CityContent> {
  const content = await loadValle()
  const mondayStops = content.items.filter(i => i.kind === 'stop' && i.date === MONDAY)
  // Give a few Monday stops real coordinates so they show up in the map layers.
  const coords: Record<string, [number, number]> = {
    '08:30': [38.71, -9.14],
    '10:00': [38.712, -9.145],
    '11:00': [38.715, -9.15],
  }
  for (const item of mondayStops) {
    const c = item.time ? coords[item.time] : undefined
    if (c) {
      item.lat = c[0]
      item.lng = c[1]
    }
  }
  return content
}

test('stopsGeoJSON orders stops by date then sort, numbering 1..k', async () => {
  const content = await loadValleWithCoords()
  const done = new Set<string>()
  const fc = stopsGeoJSON(content, MONDAY, done)
  expect(fc.type).toBe('FeatureCollection')
  expect(fc.features.length).toBe(3)
  const ns = fc.features.map(f => f.properties!.n)
  expect(ns).toEqual([1, 2, 3])
  // sort order should be ascending
  const sorts = fc.features.map(f => {
    const item = content.items.find(i => i.id === f.properties!.id)!
    return item.sort
  })
  expect(sorts).toEqual([...sorts].sort((a, b) => a - b))
})

test('stopsGeoJSON reflects the done set', async () => {
  const content = await loadValleWithCoords()
  const first = content.items.find(i => i.kind === 'stop' && i.date === MONDAY && i.time === '08:30')!
  const done = new Set([first.id])
  const fc = stopsGeoJSON(content, MONDAY, done)
  const feature = fc.features.find(f => f.properties!.id === first.id)!
  expect(feature.properties!.done).toBe(true)
  const other = fc.features.find(f => f.properties!.id !== first.id)!
  expect(other.properties!.done).toBe(false)
})

test('stopsGeoJSON title strips bold markdown and falls back to plan', async () => {
  const content = await loadValleWithCoords()
  const fc = stopsGeoJSON(content, MONDAY, new Set())
  const titles = fc.features.map(f => f.properties!.title as string)
  for (const title of titles) {
    expect(title).not.toContain('**')
  }
  // 11:00 stop has place_name "Belvedere"
  const belvedere = fc.features.find(f => f.properties!.time === '11:00')!
  expect(belvedere.properties!.title).toBe('Belvedere')
})

test('stopsGeoJSON with null date includes stops from every date', async () => {
  const content = await loadValleWithCoords()
  const fc = stopsGeoJSON(content, null, new Set())
  expect(fc.features.length).toBe(3)
})

test('stopsGeoJSON excludes items without coordinates', async () => {
  const content = await loadValle()
  const fc = stopsGeoJSON(content, null, new Set())
  expect(fc.features).toEqual([])
})

test('legsGeoJSON decodes a polyline into a 3-point line', async () => {
  const content = await loadValle()
  content.legs[0]!.polyline = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
  const fc = legsGeoJSON(content, MONDAY)
  const withPolyline = fc.features.find(f => f.properties!.seq === content.legs[0]!.seq)!
  expect(withPolyline.geometry.type).toBe('LineString')
  expect((withPolyline.geometry as GeoJSON.LineString).coordinates).toEqual([
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ])
})

test('legsGeoJSON falls back to a 2-point line from endpoints when no polyline', async () => {
  const content = await loadValle()
  content.legs[0]!.polyline = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
  const secondLeg = content.legs[1]!
  secondLeg.from_lat = 38.71
  secondLeg.from_lng = -9.14
  secondLeg.to_lat = 38.72
  secondLeg.to_lng = -9.15
  const fc = legsGeoJSON(content, MONDAY)
  const fallback = fc.features.find(f => f.properties!.seq === secondLeg.seq && f.properties!.route_id === secondLeg.route_id)!
  expect((fallback.geometry as GeoJSON.LineString).coordinates).toEqual([
    [-9.14, 38.71],
    [-9.15, 38.72],
  ])
})

test('legsGeoJSON skips legs with neither polyline nor endpoint coordinates', async () => {
  const content = await loadValle()
  const fc = legsGeoJSON(content, MONDAY)
  // none of the fixture legs have polyline or endpoints by default
  expect(fc.features.length).toBe(0)
})

test('legsGeoJSON filters by the route date, and null returns legs for all dates', async () => {
  const content = await loadValle()
  content.legs.forEach(leg => {
    leg.from_lat = 1
    leg.from_lng = 1
    leg.to_lat = 2
    leg.to_lng = 2
  })
  const monday = legsGeoJSON(content, MONDAY)
  expect(monday.features.length).toBe(content.legs.length)
  const other = legsGeoJSON(content, '2026-11-03')
  expect(other.features.length).toBe(0)
  const all = legsGeoJSON(content, null)
  expect(all.features.length).toBe(content.legs.length)
})

test('legsGeoJSON carries route mode in properties', async () => {
  const content = await loadValle()
  content.legs.forEach(leg => {
    leg.from_lat = 1
    leg.from_lng = 1
    leg.to_lat = 2
    leg.to_lng = 2
  })
  const fc = legsGeoJSON(content, MONDAY)
  const drivingLeg = fc.features.find(f => f.properties!.route_id === 'V2')!
  expect(drivingLeg.properties!.mode).toBe('driving')
})

test('parkedGeoJSON features carry parked: ids', async () => {
  const content = await loadValle()
  content.parked.forEach((row, i) => {
    row.lat = 38.7 + i
    row.lng = -9.1 - i
  })
  const fc = parkedGeoJSON(content)
  expect(fc.features.length).toBe(content.parked.length)
  const ids = fc.features.map(f => f.properties!.id)
  expect(ids).toEqual(content.parked.map(row => `parked:${row.seq}`))
  expect(fc.features[0]!.properties!.kind).toBe('parked')
})

test('parkedGeoJSON excludes venues without coordinates', async () => {
  const content = await loadValle()
  const fc = parkedGeoJSON(content)
  expect(fc.features).toEqual([])
})

test('placesGeoJSON maps place fields into point features', () => {
  const fc = placesGeoJSON([
    { id: 'p1', name: 'Café Sole', lat: 38.7, lng: -9.1, rating: 4.5, openNow: true },
  ])
  expect(fc.features.length).toBe(1)
  expect(fc.features[0]!.properties).toEqual({
    id: 'p1',
    title: 'Café Sole',
    rating: 4.5,
    open: true,
    kind: 'place',
  })
  expect(fc.features[0]!.geometry).toEqual({ type: 'Point', coordinates: [-9.1, 38.7] })
})

test('boundsFor is null for an empty collection', () => {
  expect(boundsFor({ type: 'FeatureCollection', features: [] })).toBeNull()
})

test('boundsFor pads the bbox of all Point and LineString coordinates', () => {
  const fc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-9.14, 38.71] } },
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [[-9.13, 38.72], [-9.12, 38.73]] },
      },
    ],
  }
  const bounds = boundsFor(fc)
  expect(bounds).not.toBeNull()
  const [minLng, minLat, maxLng, maxLat] = bounds!
  expect(minLng).toBeLessThan(-9.14)
  expect(minLat).toBeLessThan(38.71)
  expect(maxLng).toBeGreaterThan(-9.12)
  expect(maxLat).toBeGreaterThan(38.73)
})
