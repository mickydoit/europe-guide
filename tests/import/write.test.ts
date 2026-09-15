import { assembleCity, stampOwner } from '../../scripts/import/write'
test('assembleCity parses the Valle fixture into a CityContent', async () => {
  const { content, cityHint, year } = await assembleCity('tests/fixtures/valle', 'valle')
  expect(cityHint).toBe('Valle'); expect(year).toBe(2026)
  expect(content.trip).toMatchObject({ slug: 'valle', name: 'Valle', start_date: '2026-11-01', end_date: '2026-11-03', timezone: 'Europe/Rome', country_code: 'it' })
  expect(content.days.length).toBeGreaterThanOrEqual(2); expect(content.legs.length).toBeGreaterThanOrEqual(3)
  const rl = content.items.find(i => i.kind === 'route_link')!; expect(rl.route_id).toBe('V1')
})
test('stampOwner sets owner on every row', async () => {
  const { content } = await assembleCity('tests/fixtures/valle', 'valle')
  const p = stampOwner(content, 'uuid-1') as Record<string, unknown>
  expect((p.trip as { owner: string }).owner).toBe('uuid-1')
  expect((p.items as { owner: string }[]).every(r => r.owner === 'uuid-1')).toBe(true)
  expect(Object.keys(p).sort()).toEqual(['alerts','areas','bookings','days','items','legs','notes','parked','routes','trip'])
})
