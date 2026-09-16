import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  PHOTO_CACHE_NAME,
  photoKey,
  cachePhoto,
  getCachedPhotoBlob,
  hasCachedPhoto,
} from '../../src/lib/photosCache'
import { FakeCacheStorage } from '../helpers/fakeCaches'

describe('photosCache', () => {
  let cacheStorage: FakeCacheStorage
  beforeEach(() => {
    cacheStorage = new FakeCacheStorage()
  })

  test('photoKey namespaces by storage path', () => {
    expect(photoKey('valle/a.jpg')).toBe('/__photo/valle/a.jpg')
  })

  test('cachePhoto fetches the signed url and puts it under photoKey(path)', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }))

    await cachePhoto('valle/a.jpg', 'https://signed.example/valle/a.jpg', fetchImpl as unknown as typeof fetch, cacheStorage as unknown as CacheStorage)

    expect(fetchImpl).toHaveBeenCalledWith('https://signed.example/valle/a.jpg')
    const cache = await cacheStorage.open(PHOTO_CACHE_NAME)
    expect(await cache.match(photoKey('valle/a.jpg'))).toBeDefined()
  })

  test('cachePhoto throws on a non-OK response and caches nothing', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 403 }))

    await expect(
      cachePhoto('valle/a.jpg', 'https://signed.example/valle/a.jpg', fetchImpl as unknown as typeof fetch, cacheStorage as unknown as CacheStorage),
    ).rejects.toThrow()

    expect(await hasCachedPhoto('valle/a.jpg', cacheStorage as unknown as CacheStorage)).toBe(false)
  })

  test('getCachedPhotoBlob returns the stored bytes, null when absent', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([9, 8, 7]).buffer, { status: 200 }))
    await cachePhoto('valle/a.jpg', 'https://signed.example/valle/a.jpg', fetchImpl as unknown as typeof fetch, cacheStorage as unknown as CacheStorage)

    const blob = await getCachedPhotoBlob('valle/a.jpg', cacheStorage as unknown as CacheStorage)
    expect(blob).not.toBeNull()
    expect(new Uint8Array(await (blob as Blob).arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]))

    expect(await getCachedPhotoBlob('missing/x.jpg', cacheStorage as unknown as CacheStorage)).toBeNull()
  })

  test('hasCachedPhoto reflects whether the photo has been cached', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1]).buffer, { status: 200 }))
    expect(await hasCachedPhoto('valle/a.jpg', cacheStorage as unknown as CacheStorage)).toBe(false)

    await cachePhoto('valle/a.jpg', 'https://signed.example/valle/a.jpg', fetchImpl as unknown as typeof fetch, cacheStorage as unknown as CacheStorage)
    expect(await hasCachedPhoto('valle/a.jpg', cacheStorage as unknown as CacheStorage)).toBe(true)
  })
})
