import { existsSync } from 'node:fs'
import { assembleCity } from '../../scripts/import/write'
const dir = 'content/lisbon'
const t = existsSync(dir) ? test : test.skip
t('real Lisbon files parse without error', async () => {
  const { content } = await assembleCity(dir, 'lisbon')
  expect(content.days.map(d => d.date)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
  expect(content.bookings.filter(b => b.kind === 'booked')).toHaveLength(4)
  expect(content.bookings.filter(b => b.kind === 'todo')).toHaveLength(7)
  expect(content.routes.map(r => r.id)).toEqual(['W1', 'W2', 'W3', 'T1', 'T2', 'T3', 'T4', 'T5', 'F1', 'S1', 'S2', 'S3'])
  expect(content.legs.filter(l => l.route_id === 'W2')).toHaveLength(10)
  expect(content.alerts.length).toBeGreaterThan(30)
  expect(content.items.filter(i => i.kind === 'option')).toHaveLength(6)
})
