import { readFileSync } from 'node:fs'
import { parseParked } from '../../scripts/import/parse/parked'
test('parked venues table', () => {
  const r = parseParked('p.md', readFileSync('tests/fixtures/valle/Valle-Parked-Venues.md', 'utf8'), { trip: 'valle' })
  expect(r).toHaveLength(3)
  expect(r[0]).toMatchObject({ seq: 0, name: expect.any(String), what: expect.any(String), why: expect.any(String) })
  expect(r[0].address).toBeTruthy()
})
