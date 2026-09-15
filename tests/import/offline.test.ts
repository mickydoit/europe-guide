import { clusterPoints, bboxOf, buildOfflineAreas } from '../../scripts/import/offline'
import type { CityContent } from '../../scripts/import/types'
test('clusters points by distance', () => {
  const c = clusterPoints([{ lat: 38.71, lng: -9.14 }, { lat: 38.712, lng: -9.142 }, { lat: 38.79, lng: -9.39 }, { lat: 38.69, lng: -9.20 }])
  expect(c).toHaveLength(3); expect(c[0]).toHaveLength(2)
})
test('bbox pads by metres', () => {
  const b = bboxOf([{ lat: 38.71, lng: -9.14 }], 400)
  expect(b.max_lat - 38.71).toBeCloseTo(0.0036, 3); expect(b.min_lng).toBeLessThan(-9.14)
})
test('buildOfflineAreas runs pmtiles per cluster and uploads', async () => {
  const cmds: string[][] = []; const ups: string[] = []
  const content = { items: [{ kind: 'stop', place_name: 'Centre', lat: 38.71, lng: -9.14 }, { kind: 'stop', place_name: 'Far', lat: 38.79, lng: -9.39 }], parked: [], legs: [] } as unknown as CityContent
  const rows = await buildOfflineAreas('valle', content, { buildUrl: 'https://build.protomaps.com/20260901.pmtiles', outDir: '/tmp/x',
    exec: async (cmd, args) => { cmds.push([cmd, ...args]) }, upload: async () => 1234, statImpl: async () => ({ size: 1234 }) })
  expect(rows).toHaveLength(2); expect(rows[0]).toMatchObject({ trip: 'valle', seq: 0, name: 'Centre', pmtiles_path: 'valle/0.pmtiles', size_bytes: 1234 })
  expect(cmds[0][0]).toBe('pmtiles'); expect(cmds[0]).toContain('extract'); expect(cmds[0].some(a => a.startsWith('--bbox='))).toBe(true); expect(cmds[0]).toContain('--maxzoom=16')
})
test('buildOfflineAreas rejects when the extracted file is missing', async () => {
  const content = { items: [{ kind: 'stop', place_name: 'Centre', lat: 38.71, lng: -9.14 }], parked: [], legs: [] } as unknown as CityContent
  await expect(buildOfflineAreas('valle', content, { buildUrl: 'https://build.protomaps.com/20260901.pmtiles', outDir: '/tmp/x',
    exec: async () => {}, upload: async () => 1234, statImpl: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) } }))
    .rejects.toThrow(/produced no file/)
})
test('buildOfflineAreas rejects when the extracted file is empty', async () => {
  const content = { items: [{ kind: 'stop', place_name: 'Centre', lat: 38.71, lng: -9.14 }], parked: [], legs: [] } as unknown as CityContent
  await expect(buildOfflineAreas('valle', content, { buildUrl: 'https://build.protomaps.com/20260901.pmtiles', outDir: '/tmp/x',
    exec: async () => {}, upload: async () => 1234, statImpl: async () => ({ size: 0 }) }))
    .rejects.toThrow(/produced no file/)
})
