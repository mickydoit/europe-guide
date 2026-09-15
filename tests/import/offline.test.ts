import { vi } from 'vitest'
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
test('buildOfflineAreas defaults to a single merged extract for the whole city', async () => {
  const cmds: string[][] = []
  const content = {
    items: [{ kind: 'stop', place_name: 'Centre', lat: 38.71, lng: -9.14 }, { kind: 'stop', place_name: 'Far', lat: 38.79, lng: -9.39 }],
    parked: [], legs: [],
    trip: { name: 'Lisbon' },
  } as unknown as CityContent
  const rows = await buildOfflineAreas('valle', content, { buildUrl: 'https://build.protomaps.com/20260901.pmtiles', outDir: '/tmp/x',
    exec: async (cmd, args) => { cmds.push([cmd, ...args]) }, upload: async () => 1234, statImpl: async () => ({ size: 1234 }) })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ trip: 'valle', seq: 0, name: 'Lisbon', pmtiles_path: 'valle/0.pmtiles', size_bytes: 1234 })
  // bbox contains every input point with >= 400m padding on each side
  expect(rows[0].min_lat).toBeLessThan(38.79 - 0.0036)
  expect(rows[0].max_lat).toBeGreaterThan(38.71 + 0.0036)
  expect(rows[0].min_lng).toBeLessThan(-9.39 - 0.0036)
  expect(rows[0].max_lng).toBeGreaterThan(-9.14 + 0.0036)
  expect(cmds).toHaveLength(1)
  expect(cmds[0][0]).toBe('pmtiles'); expect(cmds[0]).toContain('extract'); expect(cmds[0].some(a => a.startsWith('--bbox='))).toBe(true)
  expect(cmds[0]).toContain('--maxzoom=15')
})
test('buildOfflineAreas with splitAreas:true reproduces the previous per-cluster behaviour', async () => {
  const cmds: string[][] = []
  const content = {
    items: [{ kind: 'stop', place_name: 'Centre', lat: 38.71, lng: -9.14 }, { kind: 'stop', place_name: 'Far', lat: 38.79, lng: -9.39 }],
    parked: [], legs: [],
    trip: { name: 'Lisbon' },
  } as unknown as CityContent
  const rows = await buildOfflineAreas('valle', content, { buildUrl: 'https://build.protomaps.com/20260901.pmtiles', outDir: '/tmp/x', splitAreas: true,
    exec: async (cmd, args) => { cmds.push([cmd, ...args]) }, upload: async () => 1234, statImpl: async () => ({ size: 1234 }) })
  expect(rows).toHaveLength(2); expect(rows[0]).toMatchObject({ trip: 'valle', seq: 0, name: 'Centre', pmtiles_path: 'valle/0.pmtiles', size_bytes: 1234 })
  expect(cmds[0][0]).toBe('pmtiles'); expect(cmds[0]).toContain('extract'); expect(cmds[0].some(a => a.startsWith('--bbox='))).toBe(true); expect(cmds[0]).toContain('--maxzoom=15')
})
test('buildOfflineAreas rejects when the extracted file is missing', async () => {
  const content = { items: [{ kind: 'stop', place_name: 'Centre', lat: 38.71, lng: -9.14 }], parked: [], legs: [], trip: { name: 'Valle' } } as unknown as CityContent
  await expect(buildOfflineAreas('valle', content, { buildUrl: 'https://build.protomaps.com/20260901.pmtiles', outDir: '/tmp/x',
    exec: async () => {}, upload: async () => 1234, statImpl: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) } }))
    .rejects.toThrow(/produced no file/)
})
test('buildOfflineAreas rejects when the extracted file is empty', async () => {
  const content = { items: [{ kind: 'stop', place_name: 'Centre', lat: 38.71, lng: -9.14 }], parked: [], legs: [], trip: { name: 'Valle' } } as unknown as CityContent
  await expect(buildOfflineAreas('valle', content, { buildUrl: 'https://build.protomaps.com/20260901.pmtiles', outDir: '/tmp/x',
    exec: async () => {}, upload: async () => 1234, statImpl: async () => ({ size: 0 }) }))
    .rejects.toThrow(/produced no file/)
})

test('buildOfflineAreas retries a failed extract with backoff', async () => {
  let calls = 0
  const content = { items: [{ kind: 'stop', place_name: 'Centre', lat: 38.71, lng: -9.14 }], parked: [], legs: [], trip: { name: 'Valle' } } as unknown as CityContent
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const rows = await buildOfflineAreas('valle', content, { buildUrl: 'u', outDir: '/tmp/x', retryDelaysMs: [0, 0],
    exec: async () => { calls++; if (calls < 3) throw new Error('HTTP error: 429') },
    upload: async () => 10, statImpl: async () => ({ size: 10 }) })
  expect(calls).toBe(3); expect(rows).toHaveLength(1); expect(warn).toHaveBeenCalledTimes(2)
  warn.mockRestore()
})
test('buildOfflineAreas gives up after the last retry', async () => {
  const content = { items: [{ kind: 'stop', place_name: 'Centre', lat: 38.71, lng: -9.14 }], parked: [], legs: [], trip: { name: 'Valle' } } as unknown as CityContent
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await expect(buildOfflineAreas('valle', content, { buildUrl: 'u', outDir: '/tmp/x', retryDelaysMs: [0],
    exec: async () => { throw new Error('HTTP error: 429') }, upload: async () => 10, statImpl: async () => ({ size: 10 }) })).rejects.toThrow(/429/)
})
test('buildOfflineAreas prints the extracted file size in MB per area', async () => {
  const content = { items: [{ kind: 'stop', place_name: 'Centre', lat: 38.71, lng: -9.14 }], parked: [], legs: [], trip: { name: 'Lisbon' } } as unknown as CityContent
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await buildOfflineAreas('valle', content, { buildUrl: 'u', outDir: '/tmp/x',
    exec: async () => {}, upload: async () => 21_000_000, statImpl: async () => ({ size: 21_000_000 }) })
  expect(log.mock.calls.some(args => /Lisbon.*20\.0\s*MB/.test(args.join(' ')))).toBe(true)
  log.mockRestore()
})
