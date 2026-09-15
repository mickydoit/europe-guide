import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  cacheKey,
  downloadCityMaps,
  getCachedMap,
  cachedMapStatus,
  deleteCityMaps,
  MemorySource,
} from '../../src/lib/offlineMaps'
import type { OfflineAreaRow } from '../../src/lib/types'

// jsdom has no `caches`; this is a minimal in-memory CacheStorage/Cache polyfill
// injected via the `cacheStorage` parameter of every offlineMaps function.
class FakeCache {
  store = new Map<string, Response>()
  async put(req: Request | string, res: Response) {
    this.store.set(typeof req === 'string' ? req : req.url, res.clone())
  }
  async match(req: Request | string) {
    return this.store.get(typeof req === 'string' ? req : req.url)
  }
  async delete(req: Request | string) {
    return this.store.delete(typeof req === 'string' ? req : req.url)
  }
  async keys() {
    return [...this.store.keys()].map(k => new Request(k))
  }
}
class FakeCacheStorage {
  caches = new Map<string, FakeCache>()
  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache())
    return this.caches.get(name) as unknown as Cache
  }
  async delete(name: string) {
    return this.caches.delete(name)
  }
  async has(name: string) {
    return this.caches.has(name)
  }
  async keys() {
    return [...this.caches.keys()]
  }
  async match() {
    return undefined
  }
}

function area(seq: number, overrides: Partial<OfflineAreaRow> = {}): OfflineAreaRow {
  return {
    trip: 'valle',
    seq,
    name: `Area ${seq}`,
    min_lng: 0,
    min_lat: 0,
    max_lng: 1,
    max_lat: 1,
    pmtiles_path: `valle/${seq}.pmtiles`,
    size_bytes: 1000,
    built_at: '2026-01-01',
    ...overrides,
  }
}

describe('offlineMaps', () => {
  let cacheStorage: FakeCacheStorage
  beforeEach(() => {
    cacheStorage = new FakeCacheStorage()
  })

  test('downloadCityMaps stores 2 areas and reports progress', async () => {
    const areas = [area(1), area(2)]
    const signer = vi.fn(async (path: string) => `https://signed.example/${path}`)
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }))
    const progress: Array<[number, number]> = []

    await downloadCityMaps(
      'valle',
      areas,
      signer,
      (done, total) => progress.push([done, total]),
      fetchImpl as unknown as typeof fetch,
      cacheStorage as unknown as CacheStorage,
    )

    expect(progress).toEqual([[1, 2], [2, 2]])
    expect(signer).toHaveBeenCalledWith('valle/1.pmtiles')
    expect(signer).toHaveBeenCalledWith('valle/2.pmtiles')

    const c = await cacheStorage.open('europe-guide-maps')
    expect(await c.match(cacheKey('valle', 1))).toBeDefined()
    expect(await c.match(cacheKey('valle', 2))).toBeDefined()
  })

  test('getCachedMap returns the stored bytes', async () => {
    const areas = [area(1)]
    const bytes = new Uint8Array([9, 8, 7, 6])
    const fetchImpl = vi.fn(async () => new Response(bytes.buffer.slice(0), { status: 200 }))

    await downloadCityMaps(
      'valle',
      areas,
      async p => `https://signed.example/${p}`,
      undefined,
      fetchImpl as unknown as typeof fetch,
      cacheStorage as unknown as CacheStorage,
    )

    const got = await getCachedMap('valle', 1, cacheStorage as unknown as CacheStorage)
    expect(got).not.toBeNull()
    expect(new Uint8Array(got as ArrayBuffer)).toEqual(bytes)

    expect(await getCachedMap('valle', 999, cacheStorage as unknown as CacheStorage)).toBeNull()
  })

  test('MemorySource.getBytes(2, 3) on a 6-byte buffer returns bytes 2..4', async () => {
    const buf = new Uint8Array([0, 1, 2, 3, 4, 5]).buffer
    const src = new MemorySource(buf, 'key-1')
    const { data } = await src.getBytes(2, 3)
    expect(new Uint8Array(data)).toEqual(new Uint8Array([2, 3, 4]))
    expect(src.getKey()).toBe('key-1')
  })

  test('a 403 on the second area rejects with /area 1/ and the first area stays cached', async () => {
    const areas = [area(0), area(1)]
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call += 1
      if (call === 1) return new Response(new Uint8Array([1, 2]).buffer, { status: 200 })
      return new Response(null, { status: 403 })
    })

    await expect(
      downloadCityMaps(
        'valle',
        areas,
        async p => `https://signed.example/${p}`,
        undefined,
        fetchImpl as unknown as typeof fetch,
        cacheStorage as unknown as CacheStorage,
      ),
    ).rejects.toThrow(/area 1/)

    expect(await getCachedMap('valle', 0, cacheStorage as unknown as CacheStorage)).not.toBeNull()
    expect(await getCachedMap('valle', 1, cacheStorage as unknown as CacheStorage)).toBeNull()
  })

  test('cachedMapStatus counts downloaded areas and bytes', async () => {
    const areas = [area(1), area(2)]
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 }))

    let status = await cachedMapStatus('valle', areas, cacheStorage as unknown as CacheStorage)
    expect(status).toEqual({ downloaded: 0, total: 2, bytes: 0 })

    await downloadCityMaps(
      'valle',
      [areas[0]],
      async p => `https://signed.example/${p}`,
      undefined,
      fetchImpl as unknown as typeof fetch,
      cacheStorage as unknown as CacheStorage,
    )

    status = await cachedMapStatus('valle', areas, cacheStorage as unknown as CacheStorage)
    expect(status.downloaded).toBe(1)
    expect(status.total).toBe(2)
    expect(status.bytes).toBe(4)
  })

  test('deleteCityMaps clears cached areas', async () => {
    const areas = [area(1), area(2)]
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2]).buffer, { status: 200 }))
    await downloadCityMaps(
      'valle',
      areas,
      async p => `https://signed.example/${p}`,
      undefined,
      fetchImpl as unknown as typeof fetch,
      cacheStorage as unknown as CacheStorage,
    )

    await deleteCityMaps('valle', areas, cacheStorage as unknown as CacheStorage)

    const status = await cachedMapStatus('valle', areas, cacheStorage as unknown as CacheStorage)
    expect(status).toEqual({ downloaded: 0, total: 2, bytes: 0 })
  })
})
