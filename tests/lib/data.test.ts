import { loadValle } from '../helpers/content'
import { mockSupabaseContent } from '../helpers/supabaseMock'
import { fetchAllAreasWith, fetchAllPlaceMetaWith, fetchCityWith, fetchTripsWith } from '../../src/lib/data'
import type { SupabaseClient } from '@supabase/supabase-js'

test('fetchCity assembles all ten tables for a slug', async () => {
  const content = await loadValle()
  const mock = mockSupabaseContent(content)
  const c = await fetchCityWith(mock.client, 'valle')
  expect(c.trip.slug).toBe('valle'); expect(c.days.length).toBe(content.days.length); expect(c.items.length).toBe(content.items.length)
  expect(c.legs.length).toBe(content.legs.length); expect(c.alerts.length).toBe(content.alerts.length)
  expect(new Set(mock.calls)).toEqual(new Set(['trips', 'days', 'items', 'bookings', 'routes', 'legs', 'alerts', 'parked_venues', 'standing_notes', 'offline_areas']))
})

test('fetchTrips returns trips', async () => {
  const content = await loadValle()
  const mock = mockSupabaseContent(content)
  expect((await fetchTripsWith(mock.client)).map(t => t.slug)).toEqual(['valle'])
})

test('a failing table throws with its name', async () => {
  const content = await loadValle()
  const bad = mockSupabaseContent(content, { failTable: 'legs' })
  await expect(fetchCityWith(bad.client, 'valle')).rejects.toThrow(/legs/)
})

test('normalises a Postgres HH:MM:SS alert time to HH:MM', async () => {
  const content = await loadValle()
  const alert = content.alerts.find(a => a.time === '09:15')!
  alert.time = '09:15:00'
  const mock = mockSupabaseContent(content)
  const c = await fetchCityWith(mock.client, 'valle')
  const found = c.alerts.find(a => a.date === alert.date && a.seq === alert.seq)
  expect(found?.time).toBe('09:15')
})

test('fetchAllAreas returns the offline areas for every trip, not just one', async () => {
  const content = await loadValle()
  const mock = mockSupabaseContent(content)
  const areas = await fetchAllAreasWith(mock.client)
  expect(areas.map(a => a.seq)).toEqual(content.areas.map(a => a.seq))
  expect(mock.calls).toEqual(['offline_areas'])
})

test('fetchAllPlaceMetaWith reads the five columns from items and parked_venues where primary_type is set, across trips', async () => {
  const calls: { table: string; select: string; filter: unknown }[] = []
  const answer = (table: string) => table === 'items'
    ? [{ primary_type: 'cafe', types: ['cafe'], price_level: null, rating: 4.9, rating_count: 198 }]
    : [{ primary_type: 'castle', types: ['castle'], price_level: null, rating: 4.4, rating_count: 5000 }]
  const client = {
    from: (table: string) => ({
      select: (select: string) => ({
        not: (col: string, op: string, v: unknown) => { calls.push({ table, select, filter: [col, op, v] }); return Promise.resolve({ data: answer(table), error: null }) },
      }),
    }),
  } as unknown as SupabaseClient
  const rows = await fetchAllPlaceMetaWith(client)
  expect(rows).toHaveLength(2)
  expect(rows[0].primary_type).toBe('cafe'); expect(rows[1].primary_type).toBe('castle')
  expect(calls.map(c => c.table).sort()).toEqual(['items', 'parked_venues'])
  for (const c of calls) { expect(c.select).toBe('primary_type,types,price_level,rating,rating_count'); expect(c.filter).toEqual(['primary_type', 'is', null]) }
})
