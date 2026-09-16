import { render, screen, waitFor } from '@testing-library/react'
import { test, expect, vi } from 'vitest'
import { FakeCacheStorage } from '../helpers/fakeCaches'
import { cachePhoto } from '../../src/lib/photosCache'
import { PhotoImg } from '../../src/components/PhotoImg'

test('renders nothing for a null path', () => {
  const { container } = render(<PhotoImg path={null} className="x" />)
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
