import { describe, test, expect, beforeEach, vi } from 'vitest'
import { FakeCacheStorage } from '../helpers/fakeCaches'
import { warmTripPhotos, resetPhotoWarmForTests, signedPhotoUrl } from '../../src/lib/photos'
import { hasCachedPhoto } from '../../src/lib/photosCache'

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
