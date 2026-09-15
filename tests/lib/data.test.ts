import { loadValle } from '../helpers/content'
import { mockSupabaseContent } from '../helpers/supabaseMock'
import { fetchCityWith, fetchTripsWith } from '../../src/lib/data'

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
