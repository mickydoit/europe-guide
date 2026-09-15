/**
 * Ticket attachments (PDFs/photos) available offline. Cache Storage keyed by attachment id
 * rather than storage path — an id is stable and short, and never needs URL-escaping.
 *
 * Mirrors offlineMaps.ts: every function takes an injectable `cacheStorage` (default
 * `globalThis.caches`) so tests can run against the FakeCacheStorage polyfill jsdom lacks.
 */

export const CACHE_NAME = 'europe-guide-attachments'

export function cacheKey(id: string): string {
  return `/__att/${id}`
}

export async function cacheAttachment(
  id: string,
  signedUrl: string,
  fetchImpl: typeof fetch = fetch,
  cacheStorage: CacheStorage = globalThis.caches,
): Promise<void> {
  const cache = await cacheStorage.open(CACHE_NAME)
  const res = await fetchImpl(signedUrl)
  if (!res.ok) throw new Error(`attachment cache failed for ${id}: HTTP ${res.status}`)
  await cache.put(cacheKey(id), res)
}

export async function getCachedAttachmentBlob(
  id: string,
  cacheStorage: CacheStorage = globalThis.caches,
): Promise<Blob | null> {
  const cache = await cacheStorage.open(CACHE_NAME)
  const res = await cache.match(cacheKey(id))
  if (!res) return null
  return res.blob()
}

export async function hasCachedAttachment(
  id: string,
  cacheStorage: CacheStorage = globalThis.caches,
): Promise<boolean> {
  const cache = await cacheStorage.open(CACHE_NAME)
  return (await cache.match(cacheKey(id))) !== undefined
}

export async function deleteCachedAttachment(
  id: string,
  cacheStorage: CacheStorage = globalThis.caches,
): Promise<void> {
  const cache = await cacheStorage.open(CACHE_NAME)
  await cache.delete(cacheKey(id))
}

export interface CacheableAttachmentRow {
  id: string
  size: number
  uploaded_at: string
}

/**
 * Evict the oldest cached rows (by `uploaded_at`) until the cached rows' `size` sums to at
 * most `maxBytes`. Rows not actually in the cache are ignored — only cached bytes count
 * against the budget. Returns the ids evicted, oldest first.
 */
export async function enforceCacheLimit(
  rows: CacheableAttachmentRow[],
  maxBytes = 200 * 1024 * 1024,
  cacheStorage: CacheStorage = globalThis.caches,
): Promise<string[]> {
  const cache = await cacheStorage.open(CACHE_NAME)
  const cached: CacheableAttachmentRow[] = []
  for (const row of rows) {
    if ((await cache.match(cacheKey(row.id))) !== undefined) cached.push(row)
  }
  cached.sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))

  let total = cached.reduce((sum, r) => sum + r.size, 0)
  const evicted: string[] = []
  for (const row of cached) {
    if (total <= maxBytes) break
    await cache.delete(cacheKey(row.id))
    total -= row.size
    evicted.push(row.id)
  }
  return evicted
}
