import { render, screen, waitFor } from '@testing-library/react'
import { test, expect, vi } from 'vitest'
import { FakeCacheStorage } from '../helpers/fakeCaches'
import { cachePhoto, getCachedPhotoBlob } from '../../src/lib/photosCache'
import { PhotoImg } from '../../src/components/PhotoImg'

vi.mock('../../src/lib/photosCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/photosCache')>()
  // Wrap (not replace) getCachedPhotoBlob so every test keeps the real cache behaviour by
  // default; a single test below overrides one call with `mockImplementationOnce` to control
  // exactly when that read resolves, relative to unmount.
  return { ...actual, getCachedPhotoBlob: vi.fn(actual.getCachedPhotoBlob) }
})

test('renders nothing for a null path', () => {
  const { container } = render(<PhotoImg path={null} className="x" />)
  expect(container.querySelector('img')).toBeNull()
})
test('renders the caller\'s fallback whenever there is nothing to show', () => {
  // Not just a null path: a path whose bytes are not on the phone resolves to null too.
  const { container, rerender } = render(<PhotoImg path={null} fallback={<span className="glyph" />} />)
  expect(container.querySelector('.glyph')).not.toBeNull()
  rerender(<PhotoImg path="valle/missing.jpg" fallback={<span className="glyph" />} />)
  expect(container.querySelector('.glyph')).not.toBeNull()
  expect(container.querySelector('img')).toBeNull()
})
test('renders the cached blob as an object URL', async () => {
  const cs = new FakeCacheStorage()
  vi.stubGlobal('caches', cs)
  // Spy on just the two static methods instead of replacing the global URL object:
  // FakeCache.norm() calls `new URL(...)` on every put/match (both the setup write below
  // and PhotoImg's own read), and a `{ ...URL, ... }` stand-in is not a constructor.
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  await cachePhoto('valle/a.jpg', 'https://x/a.jpg', vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })) as unknown as typeof fetch, cs as unknown as CacheStorage)
  render(<PhotoImg path="valle/a.jpg" className="hero" alt="" />)
  await waitFor(() => expect(screen.getByRole('presentation')).toHaveAttribute('src', 'blob:fake'))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('does not leak a blob URL when unmounted before a pending cache read resolves', async () => {
  vi.stubGlobal('caches', new FakeCacheStorage() as unknown as CacheStorage)
  let resolveBlob!: (b: Blob | null) => void
  const pending = new Promise<Blob | null>(r => { resolveBlob = r })
  vi.mocked(getCachedPhotoBlob).mockImplementationOnce(() => pending)
  const createSpy = vi.spyOn(URL, 'createObjectURL')
  const revokeSpy = vi.spyOn(URL, 'revokeObjectURL')
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  const { unmount } = render(<PhotoImg path="valle/a.jpg" alt="" />)
  unmount()
  resolveBlob(new Blob([new Uint8Array([1])]))
  // Flush the microtask queue past the effect's now-resolved `await getCachedPhotoBlob(...)`.
  await pending
  await Promise.resolve()
  await Promise.resolve()

  expect(createSpy).not.toHaveBeenCalled()
  expect(revokeSpy).not.toHaveBeenCalled()
  expect(errorSpy).not.toHaveBeenCalled()

  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
