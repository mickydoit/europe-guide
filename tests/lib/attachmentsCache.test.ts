import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  CACHE_NAME,
  cacheKey,
  cacheAttachment,
  getCachedAttachmentBlob,
  hasCachedAttachment,
  deleteCachedAttachment,
  enforceCacheLimit,
} from '../../src/lib/attachmentsCache'
import { FakeCacheStorage } from '../helpers/fakeCaches'

describe('attachmentsCache', () => {
  let cacheStorage: FakeCacheStorage
  beforeEach(() => {
    cacheStorage = new FakeCacheStorage()
  })

  test('cacheKey namespaces by attachment id', () => {
    expect(cacheKey('a1')).toBe('/__att/a1')
  })

  test('cacheAttachment fetches the signed url and puts it under cacheKey(id)', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }))

    await cacheAttachment('a1', 'https://signed.example/a1.pdf', fetchImpl as unknown as typeof fetch, cacheStorage as unknown as CacheStorage)

    expect(fetchImpl).toHaveBeenCalledWith('https://signed.example/a1.pdf')
    const cache = await cacheStorage.open(CACHE_NAME)
    expect(await cache.match(cacheKey('a1'))).toBeDefined()
  })

  test('cacheAttachment throws on a non-OK response and caches nothing', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 403 }))

    await expect(
      cacheAttachment('a1', 'https://signed.example/a1.pdf', fetchImpl as unknown as typeof fetch, cacheStorage as unknown as CacheStorage),
    ).rejects.toThrow()

    expect(await hasCachedAttachment('a1', cacheStorage as unknown as CacheStorage)).toBe(false)
  })

  test('getCachedAttachmentBlob returns the stored bytes, null when absent', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([9, 8, 7]).buffer, { status: 200 }))
    await cacheAttachment('a1', 'https://signed.example/a1.pdf', fetchImpl as unknown as typeof fetch, cacheStorage as unknown as CacheStorage)

    const blob = await getCachedAttachmentBlob('a1', cacheStorage as unknown as CacheStorage)
    expect(blob).not.toBeNull()
    expect(new Uint8Array(await (blob as Blob).arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]))

    expect(await getCachedAttachmentBlob('missing', cacheStorage as unknown as CacheStorage)).toBeNull()
  })

  test('hasCachedAttachment reflects put/delete', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1]).buffer, { status: 200 }))
    expect(await hasCachedAttachment('a1', cacheStorage as unknown as CacheStorage)).toBe(false)

    await cacheAttachment('a1', 'https://signed.example/a1.pdf', fetchImpl as unknown as typeof fetch, cacheStorage as unknown as CacheStorage)
    expect(await hasCachedAttachment('a1', cacheStorage as unknown as CacheStorage)).toBe(true)

    await deleteCachedAttachment('a1', cacheStorage as unknown as CacheStorage)
    expect(await hasCachedAttachment('a1', cacheStorage as unknown as CacheStorage)).toBe(false)
  })

  test('enforceCacheLimit evicts the oldest cached rows until under the max, keeps the newest', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(10).buffer, { status: 200 }))
    for (const id of ['old', 'mid', 'new']) {
      await cacheAttachment(id, `https://signed.example/${id}`, fetchImpl as unknown as typeof fetch, cacheStorage as unknown as CacheStorage)
    }
    const rows = [
      { id: 'old', size: 40, uploaded_at: '2026-01-01T00:00:00.000Z' },
      { id: 'mid', size: 40, uploaded_at: '2026-01-02T00:00:00.000Z' },
      { id: 'new', size: 40, uploaded_at: '2026-01-03T00:00:00.000Z' },
    ]

    const evicted = await enforceCacheLimit(rows, 50, cacheStorage as unknown as CacheStorage)

    expect(evicted).toEqual(['old', 'mid'])
    expect(await hasCachedAttachment('old', cacheStorage as unknown as CacheStorage)).toBe(false)
    expect(await hasCachedAttachment('mid', cacheStorage as unknown as CacheStorage)).toBe(false)
    expect(await hasCachedAttachment('new', cacheStorage as unknown as CacheStorage)).toBe(true)
  })

  test('enforceCacheLimit evicts nothing when the total is already under the max', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(10).buffer, { status: 200 }))
    await cacheAttachment('a1', 'https://signed.example/a1', fetchImpl as unknown as typeof fetch, cacheStorage as unknown as CacheStorage)
    const rows = [{ id: 'a1', size: 10, uploaded_at: '2026-01-01T00:00:00.000Z' }]

    const evicted = await enforceCacheLimit(rows, 200 * 1024 * 1024, cacheStorage as unknown as CacheStorage)

    expect(evicted).toEqual([])
    expect(await hasCachedAttachment('a1', cacheStorage as unknown as CacheStorage)).toBe(true)
  })

  test('enforceCacheLimit ignores rows that are not actually cached', async () => {
    const rows = [
      { id: 'not-cached-1', size: 1000, uploaded_at: '2026-01-01T00:00:00.000Z' },
      { id: 'not-cached-2', size: 1000, uploaded_at: '2026-01-02T00:00:00.000Z' },
    ]
    const evicted = await enforceCacheLimit(rows, 100, cacheStorage as unknown as CacheStorage)
    expect(evicted).toEqual([])
  })
})
