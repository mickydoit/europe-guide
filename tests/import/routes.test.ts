import { readFileSync } from 'node:fs'
import { parseRoutes } from '../../scripts/import/parse/routes'
const src = readFileSync('tests/fixtures/valle/Valle-Walking-Routes.md', 'utf8')
test('routes with fields, mode, covers and dates', () => {
  const r = parseRoutes('r.md', src, { trip: 'valle', year: 2026 })
  expect(r.routes.map(x => x.id)).toEqual(['V1', 'V2'])
  expect(r.routes[0]).toMatchObject({ date: '2026-11-02', mode: 'walking', distance_text: expect.stringMatching(/km|m/), google_url: expect.stringMatching(/^https:\/\/www\.google\.com\/maps\/dir/) })
  expect(r.routes[0].covers.length).toBeGreaterThanOrEqual(2)
  expect(r.routes[1].mode).toBe('driving')
  expect(r.notes.some(n => n.section === 'routes' && /Not walking/.test(n.text))).toBe(true)
})
test('missing url fails', () => {
  expect(() => parseRoutes('r.md', '## Monday 2 November\n\n### V9 — x\n- **distance:** 1 km\n', { trip: 'valle', year: 2026 })).toThrow(/url/)
})
