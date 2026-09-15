import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { OfflineMapCard } from '../../src/components/OfflineMapCard'
import { downloadCityMaps } from '../../src/lib/offlineMaps'
import type { OfflineAreaRow } from '../../src/lib/types'
import { FakeCacheStorage } from '../helpers/fakeCaches'

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
  localStorage.clear()
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

test('a partial failure still refreshes status and shows the error alongside "1 of 2 areas"', async () => {
  let call = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    call += 1
    if (call === 1) return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 })
    return new Response(null, { status: 403 })
  }))
  render(
    <OfflineMapCard
      trip="valle"
      areas={areas}
      signer={async p => `https://signed.example/${p}`}
      cacheStorage={cacheStorage as unknown as CacheStorage}
    />,
  )
  await screen.findByText(/0 of 2 areas/)

  fireEvent.click(screen.getByRole('button', { name: 'Download' }))

  await waitFor(() => expect(screen.getByText(/1 of 2 areas/)).toBeInTheDocument())
  expect(screen.getByText(/area 2/)).toHaveClass('form__msg--error')
})

test('clicking Delete (after confirm) clears the cache and shows "0 of N"', async () => {
  await downloadCityMaps(
    'valle',
    areas,
    async p => `https://signed.example/${p}`,
    undefined,
    fetchMock as unknown as typeof fetch,
    cacheStorage as unknown as CacheStorage,
  )
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

  render(<OfflineMapCard trip="valle" areas={areas} cacheStorage={cacheStorage as unknown as CacheStorage} />)
  await screen.findByText(/2 of 2 areas/)

  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

  await waitFor(() => expect(screen.getByText(/0 of 2 areas/)).toBeInTheDocument())
  expect(confirmSpy).toHaveBeenCalled()

  const cache = await cacheStorage.open('europe-guide-maps')
  expect(await cache.match('/__maps/valle/1.pmtiles')).toBeUndefined()
  expect(await cache.match('/__maps/valle/2.pmtiles')).toBeUndefined()

  confirmSpy.mockRestore()
})

const EVICTED = 'Map data was cleared by iOS — re-download'

test('a remembered full download that is no longer in the cache blames the eviction', async () => {
  localStorage.setItem('europe-guide.mapsDownloaded.valle', '2')
  const signer = vi.fn(async (path: string) => `https://signed.example/${path}`)

  render(<OfflineMapCard trip="valle" areas={areas} signer={signer} cacheStorage={cacheStorage as unknown as CacheStorage} />)

  expect(await screen.findByText(EVICTED)).toBeInTheDocument()
})

test('a completed download records the watermark and says nothing about eviction', async () => {
  const signer = vi.fn(async (path: string) => `https://signed.example/${path}`)
  render(<OfflineMapCard trip="valle" areas={areas} signer={signer} cacheStorage={cacheStorage as unknown as CacheStorage} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Download' }))

  await waitFor(() => expect(localStorage.getItem('europe-guide.mapsDownloaded.valle')).toBe('2'))
  expect(screen.queryByText(EVICTED)).toBeNull()
})

const STALE = 'Update needed — map data changed'

test('cached bytes that no longer match size_bytes offer an Update, not a Download', async () => {
  // Both areas present, but the city has been re-cut since: what is on the phone is a
  // different map than the one the rows describe.
  const cache = await cacheStorage.open('europe-guide-maps')
  await cache.put('/__maps/valle/1.pmtiles', new Response(new Uint8Array(16).buffer, { status: 200 }))
  await cache.put('/__maps/valle/2.pmtiles', new Response(new Uint8Array(16).buffer, { status: 200 }))

  render(<OfflineMapCard trip="valle" areas={areas} cacheStorage={cacheStorage as unknown as CacheStorage} />)

  expect(await screen.findByText(STALE)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument()
})

test('a freshly downloaded map says nothing about stale data', async () => {
  const signer = vi.fn(async (path: string) => `https://signed.example/${path}`)
  const sized = areas.map(a => ({ ...a, size_bytes: 3 }))
  render(<OfflineMapCard trip="valle" areas={sized} signer={signer} cacheStorage={cacheStorage as unknown as CacheStorage} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Download' }))

  await waitFor(() => expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument())
  expect(screen.queryByText(STALE)).toBeNull()
})
