import { openDB, type IDBPDatabase } from 'idb'
import type { CityContent, TripRow } from './types'
import type { OutboxOp } from './outbox'
let dbp: Promise<IDBPDatabase> | null = null
export function openDb() {
  dbp ??= openDB('europe-guide', 3, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('content')) db.createObjectStore('content')
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
      if (!db.objectStoreNames.contains('weather')) db.createObjectStore('weather')
      if (!db.objectStoreNames.contains('outbox')) {
        // Queued writes waiting for a network. `key` dedupes last-write-wins; `nextAt` is the backoff schedule.
        const outbox = db.createObjectStore('outbox', { keyPath: 'id' })
        outbox.createIndex('key', 'key')
        outbox.createIndex('nextAt', 'nextAt')
      }
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
export async function getOutboxAll() { return (await (await openDb()).getAll('outbox')) as OutboxOp[] }
/** Ops whose backoff has elapsed, via the `nextAt` index — the flush never scans parked ops. */
export async function getOutboxDue(now: number) { return (await (await openDb()).getAllFromIndex('outbox', 'nextAt', IDBKeyRange.upperBound(now))) as OutboxOp[] }
/** Ids of the ops already queued under a dedupe key, via the `key` index. */
export async function getOutboxIdsByKey(key: string) { return (await (await openDb()).getAllKeysFromIndex('outbox', 'key', key)) as string[] }
export async function putOutbox(op: OutboxOp) { await (await openDb()).put('outbox', op) }
export async function deleteOutbox(id: string) { await (await openDb()).delete('outbox', id) }
export async function clearOutbox() { await (await openDb()).clear('outbox') }
