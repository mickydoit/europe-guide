import { haversineM, decodePolyline, bboxOfPoints, distanceLabel } from '../../src/lib/geo'

test('decodePolyline returns [lng, lat] pairs', () => {
  const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
  expect(points).toEqual([
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ])
})

test('haversineM computes Lisbon to Sintra distance within 1500m of 23500', () => {
  const d = haversineM({ lat: 38.7169, lng: -9.1399 }, { lat: 38.7981, lng: -9.3903 })
  expect(Math.abs(d - 23500)).toBeLessThanOrEqual(1500)
})

test('haversineM returns 0 for identical points', () => {
  expect(haversineM({ lat: 10, lng: 10 }, { lat: 10, lng: 10 })).toBe(0)
})

test('bboxOfPoints expands both axes by the padding', () => {
  const points: [number, number][] = [[-9.14, 38.71], [-9.13, 38.72]]
  const unpadded = bboxOfPoints(points, 0)
  const padded = bboxOfPoints(points, 200)
  expect(padded[0]).toBeLessThan(unpadded[0])
  expect(padded[1]).toBeLessThan(unpadded[1])
  expect(padded[2]).toBeGreaterThan(unpadded[2])
  expect(padded[3]).toBeGreaterThan(unpadded[3])
})

test('bboxOfPoints defaults to a 200m pad', () => {
  const points: [number, number][] = [[-9.14, 38.71], [-9.13, 38.72]]
  expect(bboxOfPoints(points)).toEqual(bboxOfPoints(points, 200))
})

test('distanceLabel formats under 1000m as whole metres', () => {
  expect(distanceLabel(850)).toBe('850 m')
})

test('distanceLabel formats 1000m and over as one-decimal km', () => {
  expect(distanceLabel(1234)).toBe('1.2 km')
})
