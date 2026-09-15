import { openDB, type IDBPDatabase } from 'idb'
import type { CityContent, TripRow } from './types'
let dbp: Promise<IDBPDatabase> | null = null
export function openDb() {
  dbp ??= openDB('europe-guide', 1, { upgrade(db) { db.createObjectStore('content'); db.createObjectStore('meta') } })
  return dbp
}
export async function getCachedCity(slug: string) { return ((await (await openDb()).get('content', slug)) as CityContent | undefined) ?? null }
export async function putCachedCity(c: CityContent) { await (await openDb()).put('content', c, c.trip.slug) }
export async function getCachedTrips() { return ((await (await openDb()).get('meta', 'trips')) as TripRow[] | undefined) ?? [] }
export async function putCachedTrips(t: TripRow[]) { await (await openDb()).put('meta', t, 'trips') }
