import { openDB, type IDBPDatabase } from 'idb'
import type { CityContent, TripRow } from './types'
import type { OutboxOp } from './outbox'
let dbp: Promise<IDBPDatabase> | null = null
export function openDb() {
  dbp ??= openDB('europe-guide', 4, {
    upgrade(db, _oldVersion, _newVersion, tx) {
      if (!db.objectStoreNames.contains('content')) db.createObjectStore('content')
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
      if (!db.objectStoreNames.contains('weather')) db.createObjectStore('weather')
      // Queued writes waiting for a network. `key` dedupes last-write-wins; `nextAt` is the
      // backoff schedule; `status` lets the badge count pending/failed without reading every
      // op (an attachment op carries its whole Blob, so a count must never load them).
      const outbox = db.objectStoreNames.contains('outbox')
        ? tx.objectStore('outbox')
        : db.createObjectStore('outbox', { keyPath: 'id' })
      if (!outbox.indexNames.contains('key')) outbox.createIndex('key', 'key')
      if (!outbox.indexNames.contains('nextAt')) outbox.createIndex('nextAt', 'nextAt')
      if (!outbox.indexNames.contains('status')) outbox.createIndex('status', 'status')
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
/** The ops queued under a dedupe key, via the `key` index — the whole op, `createdAt` included. */
export async function getOutboxByKey(key: string) { return (await (await openDb()).getAllFromIndex('outbox', 'key', key)) as OutboxOp[] }
/** One op by id, without reading (and structured-cloning) every other op's payload. */
export async function getOutbox(id: string) { return (await (await openDb()).get('outbox', id)) as OutboxOp | undefined }
/** How many ops sit at one status, counted in the `status` index — no payloads are read. */
export async function countOutboxByStatus(status: OutboxOp['status']) { return (await openDb()).countFromIndex('outbox', 'status', status) }
export async function putOutbox(op: OutboxOp) { await (await openDb()).put('outbox', op) }
export async function deleteOutbox(id: string) { await (await openDb()).delete('outbox', id) }
export async function clearOutbox() { await (await openDb()).clear('outbox') }
