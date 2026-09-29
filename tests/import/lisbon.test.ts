import { existsSync } from 'node:fs'
import { assembleCity } from '../../scripts/import/write'
const dir = 'content/lisbon'
const t = existsSync(dir) ? test : test.skip
t('real Lisbon files parse without error', async () => {
  const { content } = await assembleCity(dir, 'lisbon')
  expect(content.days.map(d => d.date)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
  expect(content.bookings.filter(b => b.kind === 'booked')).toHaveLength(5)   // B05: the airport Bolt, 29 Sep
  expect(content.bookings.filter(b => b.kind === 'todo')).toHaveLength(6)
  // A1/W0/W4/T0/T6/F0/F2/S0/S4/D1 are the to-and-from-the-flat legs added 29 Sep.
  expect(content.routes.map(r => r.id)).toEqual(['A1', 'W0', 'W1', 'W2', 'W3', 'W4', 'T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'F0', 'F1', 'F2', 'S0', 'S1', 'S2', 'S3', 'S4', 'D1'])
  expect(content.legs.filter(l => l.route_id === 'W2')).toHaveLength(10)
  expect(content.alerts.length).toBeGreaterThan(30)
  expect(content.items.filter(i => i.kind === 'option')).toHaveLength(6)
})
