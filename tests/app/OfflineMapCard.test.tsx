import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { OfflineMapCard } from '../../src/components/OfflineMapCard'
import type { OfflineAreaRow } from '../../src/lib/types'

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
    return [...this.store.keys()]
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

const areas: OfflineAreaRow[] = [
  {
    trip: 'valle', seq: 1, name: 'Valle centre', min_lng: 0, min_lat: 0, max_lng: 1, max_lat: 1,
    pmtiles_path: 'valle/1.pmtiles', size_bytes: 1_048_576, built_at: '2026-01-01',
  },
  {
    trip: 'valle', seq: 2, name: 'Valle outskirts', min_lng: 0, min_lat: 0, max_lng: 1, max_lat: 1,
    pmtiles_path: 'valle/2.pmtiles', size_bytes: 2_097_152, built_at: '2026-01-01',
  },
]

let cacheStorage: FakeCacheStorage
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  cacheStorage = new FakeCacheStorage()
  fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('renders "0 of 2 areas" and a Download button', async () => {
  render(<OfflineMapCard trip="valle" areas={areas} cacheStorage={cacheStorage as unknown as CacheStorage} />)
  expect(await screen.findByText(/0 of 2 areas/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
})

test('clicking Download calls the injected signer for both paths and ends at "2 of 2"', async () => {
  const signer = vi.fn(async (path: string) => `https://signed.example/${path}`)
  render(
    <OfflineMapCard
      trip="valle"
      areas={areas}
      signer={signer}
      cacheStorage={cacheStorage as unknown as CacheStorage}
    />,
  )
  await screen.findByText(/0 of 2 areas/)

  fireEvent.click(screen.getByRole('button', { name: 'Download' }))

  await waitFor(() => expect(screen.getByText(/2 of 2 areas/)).toBeInTheDocument())

  expect(signer).toHaveBeenCalledWith('valle/1.pmtiles')
  expect(signer).toHaveBeenCalledWith('valle/2.pmtiles')
})
