/**
 * Trip photos available offline. Cache Storage keyed by storage path, mirroring
 * attachmentsCache.ts's shape exactly (same injectable `cacheStorage` pattern so tests can
 * run against the FakeCacheStorage polyfill jsdom lacks).
 */

export const PHOTO_CACHE_NAME = 'europe-guide-photos'

export function photoKey(path: string): string {
  return `/__photo/${path}`
}

export async function cachePhoto(
  path: string,
  signedUrl: string,
  fetchImpl: typeof fetch = fetch,
  cacheStorage: CacheStorage = globalThis.caches,
): Promise<void> {
  const cache = await cacheStorage.open(PHOTO_CACHE_NAME)
  const res = await fetchImpl(signedUrl)
  if (!res.ok) throw new Error(`photo cache failed for ${path}: HTTP ${res.status}`)
  await cache.put(photoKey(path), res)
}

export async function getCachedPhotoBlob(
  path: string,
  cacheStorage: CacheStorage = globalThis.caches,
): Promise<Blob | null> {
  const cache = await cacheStorage.open(PHOTO_CACHE_NAME)
  const res = await cache.match(photoKey(path))
  if (!res) return null
  return res.blob()
}

export async function hasCachedPhoto(
  path: string,
  cacheStorage: CacheStorage = globalThis.caches,
): Promise<boolean> {
  const cache = await cacheStorage.open(PHOTO_CACHE_NAME)
  return (await cache.match(photoKey(path))) !== undefined
}
