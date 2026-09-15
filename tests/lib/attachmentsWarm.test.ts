import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { warmTripAttachments, resetWarmForTests } from '../../src/lib/attachmentsWarm'
import { CACHE_NAME, cacheKey, cacheAttachment } from '../../src/lib/attachmentsCache'
import { FakeCacheStorage } from '../helpers/fakeCaches'

type Row = { id: string; trip: string; booking_id: string; storage_path: string; size: number; uploaded_at: string }

function row(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    trip: 'valle',
    booking_id: 'B1',
    storage_path: `owner/valle/B1/${id}.pdf`,
    size: 10,
    uploaded_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** Records what the warm pass asked for: one select per trip, one signed URL per row. */
function fakeClient(rows: Row[], calls: { trips: string[]; signed: string[] }, opts: { selectError?: boolean } = {}) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const q: Record<string, unknown> = {
        select() { return q },
        eq(col: string, val: unknown) { filters.push([col, val]); return q },
        then(resolve: (r: { data: unknown; error: unknown }) => void) {
          const trip = filters.find(([c]) => c === 'trip')?.[1] as string
          calls.trips.push(`${table}:${trip}`)
          if (opts.selectError) { resolve({ data: null, error: { message: 'no signal' } }); return }
          resolve({ data: rows.filter(r => r.trip === trip), error: null })
        },
      }
      return q
    },
    storage: {
      from: () => ({
        async createSignedUrl(path: string) {
          calls.signed.push(path)
          return { data: { signedUrl: `https://signed.example/${path}` }, error: null }
        },
      }),
    },
  } as unknown as SupabaseClient
}

describe('warmTripAttachments', () => {
  let cacheStorage: FakeCacheStorage
  let calls: { trips: string[]; signed: string[] }

  beforeEach(() => {
    resetWarmForTests()
    cacheStorage = new FakeCacheStorage()
    calls = { trips: [], signed: [] }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 })))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  test('caches every ticket in the trip, not just one booking, and reports N of M', async () => {
    const rows = [row('a1'), row('a2', { booking_id: 'B2', storage_path: 'owner/valle/B2/a2.pdf' })]
    const result = await warmTripAttachments('valle', fakeClient(rows, calls), cacheStorage as unknown as CacheStorage)

    expect(result).toEqual({ cached: 2, total: 2 })
    expect(calls.signed).toEqual(['owner/valle/B1/a1.pdf', 'owner/valle/B2/a2.pdf'])
    const cache = await cacheStorage.open(CACHE_NAME)
    expect(await cache.match(cacheKey('a1'))).toBeDefined()
    expect(await cache.match(cacheKey('a2'))).toBeDefined()
  })

  test('a ticket already on the phone is counted, not fetched again', async () => {
    await cacheAttachment('a1', 'https://signed.example/a1.pdf', undefined, cacheStorage as unknown as CacheStorage)
    const result = await warmTripAttachments('valle', fakeClient([row('a1')], calls), cacheStorage as unknown as CacheStorage)

    expect(result).toEqual({ cached: 1, total: 1 })
    expect(calls.signed).toEqual([])
  })

  test('one unreachable ticket does not cost the others', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let first = true
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (first) { first = false; return new Response(null, { status: 403 }) }
      return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 })
    }))

    const result = await warmTripAttachments('valle', fakeClient([row('a1'), row('a2')], calls), cacheStorage as unknown as CacheStorage)

    expect(result).toEqual({ cached: 1, total: 2 })
    const cache = await cacheStorage.open(CACHE_NAME)
    expect(await cache.match(cacheKey('a2'))).toBeDefined()
    warn.mockRestore()
  })

  test('the cache cap counts across bookings, not within one (fix I4)', async () => {
    const MB = 1024 * 1024
    // 150 MB in one booking and 150 MB in another: neither booking breaks the 200 MB cap on
    // its own, and the pair plainly does. The older ticket is the one that goes.
    const rows = [
      row('old', { size: 150 * MB, uploaded_at: '2026-01-01T00:00:00.000Z' }),
      row('new', { size: 150 * MB, uploaded_at: '2026-02-01T00:00:00.000Z', booking_id: 'B2', storage_path: 'owner/valle/B2/new.pdf' }),
    ]

    const result = await warmTripAttachments('valle', fakeClient(rows, calls), cacheStorage as unknown as CacheStorage)

    expect(result).toEqual({ cached: 1, total: 2 })
    const cache = await cacheStorage.open(CACHE_NAME)
    expect(await cache.match(cacheKey('old'))).toBeUndefined()
    expect(await cache.match(cacheKey('new'))).toBeDefined()
  })

  test('runs at most once per trip per session and hands back the same answer', async () => {
    const client = fakeClient([row('a1')], calls)
    const first = await warmTripAttachments('valle', client, cacheStorage as unknown as CacheStorage)
    const second = await warmTripAttachments('valle', client, cacheStorage as unknown as CacheStorage)

    expect(second).toEqual(first)
    expect(calls.trips).toEqual(['attachments:valle'])
  })

  test('does nothing offline, and does not spend the session\'s one run', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    try {
      expect(await warmTripAttachments('valle', fakeClient([row('a1')], calls), cacheStorage as unknown as CacheStorage))
        .toEqual({ cached: 0, total: 0 })
      expect(calls.trips).toEqual([])
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    }
    expect(await warmTripAttachments('valle', fakeClient([row('a1')], calls), cacheStorage as unknown as CacheStorage))
      .toEqual({ cached: 1, total: 1 })
  })

  test('a failed select warns and reports nothing rather than throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await warmTripAttachments('valle', fakeClient([row('a1')], calls, { selectError: true }), cacheStorage as unknown as CacheStorage)
    expect(result).toEqual({ cached: 0, total: 0 })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
