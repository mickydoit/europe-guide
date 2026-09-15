import type { RangeResponse, Source } from 'pmtiles'
import { supabase } from './supabase'
import type { OfflineAreaRow } from './types'

export type Signer = (path: string) => Promise<string>

export const defaultSigner: Signer = async path => {
  const { data, error } = await supabase.storage.from('maps').createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

const CACHE_NAME = 'europe-guide-maps'

// Bumped whenever the bytes behind a cache key change. Callers that hold a decoded copy
// of an archive (the Map screen hands PMTiles a MemorySource, which never re-reads the
// Cache API) compare this against the generation they last built from, so an Update that
// replaces the cached entry cannot go on being served from the old buffer.
let mapsGeneration = 0
export function getMapsGeneration(): number { return mapsGeneration }

export function cacheKey(trip: string, seq: number): string {
  return `/__maps/${trip}/${seq}.pmtiles`
}

function tripPrefix(trip: string): string { return `/__maps/${trip}/` }

/** Cache.keys() hands back Requests carrying absolute URLs; our keys are paths. */
function pathOf(req: Request | string): string {
  const raw = typeof req === 'string' ? req : req.url
  try { return new URL(raw, 'http://localhost').pathname } catch { return raw }
}

/**
 * Delete every cached archive for this trip that the current `areas` no longer name.
 *
 * Re-cutting a city's tiles renumbers or drops areas, and the old entries are then bytes
 * nothing will ever read again — invisible to `cachedMapStatus` (which only looks at the
 * areas it was given) and to Delete (same). On a phone that is tens of megabytes of dead
 * weight per re-cut. Returns how many went.
 */
export async function purgeUnknownMaps(
  trip: string,
  areas: OfflineAreaRow[],
  cacheStorage: CacheStorage = globalThis.caches,
): Promise<number> {
  const cache = await cacheStorage.open(CACHE_NAME)
  const wanted = new Set(areas.map(a => cacheKey(trip, a.seq)))
  const prefix = tripPrefix(trip)
  let removed = 0
  for (const req of await cache.keys()) {
    const path = pathOf(req)
    if (!path.startsWith(prefix) || wanted.has(path)) continue
    await cache.delete(path)
    removed += 1
  }
  if (removed) mapsGeneration += 1
  return removed
}

export async function downloadCityMaps(
  trip: string,
  areas: OfflineAreaRow[],
  signer: Signer,
  onProgress?: (done: number, total: number) => void,
  fetchImpl: typeof fetch = fetch,
  cacheStorage: CacheStorage = globalThis.caches,
): Promise<void> {
  // Clear out archives from a previous cut of this city first, so a re-download replaces
  // the map rather than stacking a second copy of it beside the old one.
  await purgeUnknownMaps(trip, areas, cacheStorage)
  const cache = await cacheStorage.open(CACHE_NAME)
  const total = areas.length
  let done = 0
  for (const area of areas) {
    const url = await signer(area.pmtiles_path)
    const res = await fetchImpl(url)
    if (!res.ok) throw new Error(`map download failed for area ${area.seq}: HTTP ${res.status}`)
    await cache.put(cacheKey(trip, area.seq), res)
    done += 1
    onProgress?.(done, total)
  }
  mapsGeneration += 1
}

export async function getCachedMap(
  trip: string,
  seq: number,
  cacheStorage: CacheStorage = globalThis.caches,
): Promise<ArrayBuffer | null> {
  const cache = await cacheStorage.open(CACHE_NAME)
  const res = await cache.match(cacheKey(trip, seq))
  if (!res) return null
  return res.arrayBuffer()
}

/** Cached bytes within a percent of what the row claims count as the same archive. */
const SIZE_TOLERANCE = 0.01

/**
 * What is on the phone for this trip. `stale` means at least one cached area's bytes no
 * longer match the `size_bytes` its row advertises (beyond 1%), i.e. the city was re-cut
 * since it was downloaded and the saved map is a different map than the one on the server.
 */
export async function cachedMapStatus(
  trip: string,
  areas: OfflineAreaRow[],
  cacheStorage: CacheStorage = globalThis.caches,
): Promise<{ downloaded: number; total: number; bytes: number; stale: boolean }> {
  const cache = await cacheStorage.open(CACHE_NAME)
  let downloaded = 0
  let bytes = 0
  let stale = false
  for (const area of areas) {
    const res = await cache.match(cacheKey(trip, area.seq))
    if (!res) continue
    downloaded += 1
    const len = res.headers.get('content-length')
    const size = len ? Number(len) : (await res.clone().blob()).size
    bytes += size
    if (area.size_bytes > 0 && Math.abs(size - area.size_bytes) > area.size_bytes * SIZE_TOLERANCE) stale = true
  }
  return { downloaded, total: areas.length, bytes, stale }
}

export async function deleteCityMaps(
  trip: string,
  areas: OfflineAreaRow[],
  cacheStorage: CacheStorage = globalThis.caches,
): Promise<void> {
  const cache = await cacheStorage.open(CACHE_NAME)
  for (const area of areas) {
    await cache.delete(cacheKey(trip, area.seq))
  }
  // Delete means delete: anything cached for this trip under an area that no longer exists
  // would otherwise survive a Delete and keep occupying the phone.
  await purgeUnknownMaps(trip, areas, cacheStorage)
  mapsGeneration += 1
}

export class MemorySource implements Source {
  private buf: ArrayBuffer
  private key: string

  constructor(buf: ArrayBuffer, key: string) {
    this.buf = buf
    this.key = key
  }

  async getBytes(offset: number, length: number, _signal?: AbortSignal, _etag?: string): Promise<RangeResponse> {
    return {
      data: this.buf.slice(offset, offset + length),
      etag: undefined,
      expires: undefined,
      cacheControl: undefined,
    }
  }

  getKey(): string {
    return this.key
  }
}
