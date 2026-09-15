import { openDB, type IDBPDatabase } from 'idb'
import type { CityContent, TripRow } from './types'
let dbp: Promise<IDBPDatabase> | null = null
export function openDb() {
  dbp ??= openDB('europe-guide', 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('content')) db.createObjectStore('content')
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
      if (!db.objectStoreNames.contains('weather')) db.createObjectStore('weather')
    },
  })
  return dbp
}
/** Test-only: close and forget the memoised connection so a subsequent indexedDB.deleteDatabase() doesn't block on it, and the next openDb() reopens fresh. */
export async function resetDbForTests() {
  if (dbp) { try { (await dbp).close() } catch { /* already closed */ } }
  dbp = null
}
export async function getCachedCity(slug: string) { return ((await (await openDb()).get('content', slug)) as CityContent | undefined) ?? null }
export async function putCachedCity(c: CityContent) { await (await openDb()).put('content', c, c.trip.slug) }
export async function getCachedTrips() { return ((await (await openDb()).get('meta', 'trips')) as TripRow[] | undefined) ?? [] }
export async function putCachedTrips(t: TripRow[]) { await (await openDb()).put('meta', t, 'trips') }
export async function getWeatherCache<T>(key: string) { return ((await (await openDb()).get('weather', key)) as T | undefined) ?? null }
export async function putWeatherCache<T>(key: string, value: T) { await (await openDb()).put('weather', value, key) }
