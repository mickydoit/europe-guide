import { describe, test, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { FakeCacheStorage } from '../helpers/fakeCaches'
import { warmTripPhotos, resetPhotoWarmForTests, signedPhotoUrl, usePhoto } from '../../src/lib/photos'
import { cachePhoto, hasCachedPhoto } from '../../src/lib/photosCache'

function client(paths: string[]) {
  return {
    storage: { from: (bucket: string) => ({ createSignedUrl: vi.fn(async (p: string) => ({ data: { signedUrl: `https://signed.example/${bucket}/${p}` }, error: null })) }) },
  } as never
}
beforeEach(() => { resetPhotoWarmForTests(); vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } }))) })

describe('warmTripPhotos', () => {
  test('caches every path once, sequentially, and reports the count', async () => {
    const cs = new FakeCacheStorage()
    const r = await warmTripPhotos('valle', ['valle/a.jpg', 'valle/b.jpg'], client([]), cs as unknown as CacheStorage)
    expect(r).toEqual({ cached: 2, total: 2 })
    expect(await hasCachedPhoto('valle/a.jpg', cs as unknown as CacheStorage)).toBe(true)
    const again = await warmTripPhotos('valle', ['valle/a.jpg', 'valle/b.jpg'], client([]), cs as unknown as CacheStorage)
    expect(again).toEqual({ cached: 2, total: 2 })
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)   // memoised per trip per session
  })
  test('one failing photo does not stop the rest', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => new Response(new Uint8Array([1]), { status: String(u).includes('/a.jpg') ? 500 : 200 })))
    const cs = new FakeCacheStorage()
    const r = await warmTripPhotos('valle', ['valle/a.jpg', 'valle/b.jpg'], client([]), cs as unknown as CacheStorage)
    expect(r).toEqual({ cached: 1, total: 2 })
  })
  test('offline: does nothing and does not mark the trip warmed', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const r = await warmTripPhotos('valle', ['valle/a.jpg'], client([]), new FakeCacheStorage() as unknown as CacheStorage)
    expect(r).toEqual({ cached: 0, total: 0 })
    vi.unstubAllGlobals()
  })
})
test('signedPhotoUrl asks the photos bucket', async () => {
  expect(await signedPhotoUrl('valle/a.jpg', client([]))).toBe('https://signed.example/photos/valle/a.jpg')
})

describe('usePhoto', () => {
  // One stable client object: it is an effect dependency, so a fresh one per render would
  // re-run the effect forever.
  const c = client([])

  test('a cache miss downloads the photo once: cache it, then show the cached bytes', async () => {
    const cs = new FakeCacheStorage()
    vi.stubGlobal('caches', cs)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fresh')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const { result } = renderHook(() => usePhoto('valle/a.jpg', c))
    await waitFor(() => expect(result.current).toBe('blob:fresh'))
    // One network request for the bytes — not one for the <img> and another for the cache.
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
    expect(await hasCachedPhoto('valle/a.jpg', cs as unknown as CacheStorage)).toBe(true)

    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('the signed URL is the fallback when caching the bytes fails', async () => {
    vi.stubGlobal('caches', new FakeCacheStorage())
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const createSpy = vi.spyOn(URL, 'createObjectURL')

    const { result } = renderHook(() => usePhoto('valle/a.jpg', c))
    await waitFor(() => expect(result.current).toBe('https://signed.example/photos/valle/a.jpg'))
    expect(createSpy).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('already-cached bytes are shown without asking the network at all', async () => {
    const cs = new FakeCacheStorage()
    vi.stubGlobal('caches', cs)
    await cachePhoto('valle/a.jpg', 'https://x/a.jpg', vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })) as unknown as typeof fetch, cs as unknown as CacheStorage)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cached')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const { result } = renderHook(() => usePhoto('valle/a.jpg', c))
    await waitFor(() => expect(result.current).toBe('blob:cached'))
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)

    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
})
