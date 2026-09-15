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

export function cacheKey(trip: string, seq: number): string {
  return `/__maps/${trip}/${seq}.pmtiles`
}

export async function downloadCityMaps(
  trip: string,
  areas: OfflineAreaRow[],
  signer: Signer,
  onProgress?: (done: number, total: number) => void,
  fetchImpl: typeof fetch = fetch,
  cacheStorage: CacheStorage = globalThis.caches,
): Promise<void> {
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

export async function cachedMapStatus(
  trip: string,
  areas: OfflineAreaRow[],
  cacheStorage: CacheStorage = globalThis.caches,
): Promise<{ downloaded: number; total: number; bytes: number }> {
  const cache = await cacheStorage.open(CACHE_NAME)
  let downloaded = 0
  let bytes = 0
  for (const area of areas) {
    const res = await cache.match(cacheKey(trip, area.seq))
    if (!res) continue
    downloaded += 1
    const len = res.headers.get('content-length')
    if (len) bytes += Number(len)
    else bytes += (await res.clone().blob()).size
  }
  return { downloaded, total: areas.length, bytes }
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
