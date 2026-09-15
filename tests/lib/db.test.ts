import { getCachedCity, putCachedCity, getCachedTrips, putCachedTrips } from '../../src/lib/db'
import { loadValle } from '../helpers/content'
test('round-trips a city through IndexedDB', async () => {
  const c = await loadValle()
  expect(await getCachedCity('valle')).toBeNull()
  await putCachedCity(c)
  const back = await getCachedCity('valle')
  expect(back?.trip.slug).toBe('valle'); expect(back?.items.length).toBe(c.items.length)
})
test('round-trips the trip list', async () => {
  const c = await loadValle()
  await putCachedTrips([c.trip]); expect((await getCachedTrips()).map(t => t.slug)).toEqual(['valle'])
})
