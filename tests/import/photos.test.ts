import { describe, test, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'
import { photoTargets, describeTargets, findPlacePhoto, downloadPhoto, attachPhotos, supabasePhotoStore } from '../../scripts/import/photos'
import type { PhotoStore, PlacesPhoto } from '../../scripts/import/photos'

let content: CityContent
beforeEach(async () => { content = geocoded(await loadValle()) })

/**
 * The fixture is parsed, not imported, so nothing has coordinates — and a target now requires
 * one. Stand in for the geocode pass on the five stops that name a real venue, and leave the
 * two aperitivo options without a point so the "no geocode, no photo" rule is exercised too.
 */
const GEOCODED = ['Piazza Grande', 'Caffè Nord', 'Belvedere', 'Castello Alto', 'Trattoria Alba']
function geocoded(c: CityContent): CityContent {
  for (const i of c.items) if (i.place_name && GEOCODED.includes(i.place_name)) { i.lat = 45.1; i.lng = 7.2 }
  return c
}
const queriesOf = (c: CityContent) => photoTargets(c, 'Valle').targets.map(t => t.query)

function memStore(seed: { objects?: string[]; cache?: Record<string, PlacesPhoto> } = {}): PhotoStore & { uploads: string[]; cache: Record<string, PlacesPhoto> } {
  const objects = new Set(seed.objects ?? []); const cache = { ...(seed.cache ?? {}) }; const uploads: string[] = []
  return {
    uploads, cache,
    async exists(p) { return objects.has(p) },
    async upload(p) { uploads.push(p); objects.add(p) },
    async cacheGet(p) { return cache[p] ?? null },
    async cacheSet(p, v) { cache[p] = v },
  }
}
const searchJson = { places: [{ id: 'ChIJabc', photos: [{ name: 'places/ChIJabc/photos/p1', authorAttributions: [{ displayName: 'Ana Photographer' }] }] }] }
function fakeFetch(opts: { searchStatus?: number; noPlaces?: boolean; mediaStatus?: number; firstMediaStatus?: number } = {}): typeof fetch {
  let media = 0
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('places:searchText')) return new Response(JSON.stringify(opts.noPlaces ? { places: [] } : searchJson), { status: opts.searchStatus ?? 200 })
    if (url.includes('/media')) {
      media += 1
      const status = media === 1 && opts.firstMediaStatus ? opts.firstMediaStatus : opts.mediaStatus ?? 200
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { status, headers: { 'content-type': 'image/jpeg' } })
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as unknown as typeof fetch
}
const calls = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls

describe('photoTargets', () => {
  test('one target per geocoded named stop/option, path <trip>/<id>.jpg without repeating the slug', () => {
    const { targets } = photoTargets(content, 'Valle')
    const paths = targets.map(x => x.path)
    expect(paths.every(p => /^valle\/[^/]+\.jpg$/.test(p))).toBe(true)
    expect(paths).toContain('valle/2026-11-02_0830_piazza-grande.jpg')
    for (const name of GEOCODED) expect(targets.some(x => x.query.startsWith(name))).toBe(true)
    expect(targets.some(x => x.query.startsWith('Walk to the belvedere'))).toBe(false)   // no place name → no photo
    expect(targets.some(x => x.query.startsWith('Bar Sole'))).toBe(false)                // no geocode → no photo
    const walkins = content.bookings.filter(b => b.kind === 'walkin').map(b => `valle/${b.id}.jpg`)
    expect(paths.some(p => walkins.includes(p))).toBe(false)
  })
  test('a booking that is a journey, an undecided choice or a chore is never searched', () => {
    const { targets, shared } = photoTargets(content, 'Valle')
    const bookingIds = [...targets.map(t => t.id), ...shared.map(s => s.booking.id)]
    expect(bookingIds).not.toContain('B02')   // "Train south" — transport
    expect(bookingIds).not.toContain('T02')   // "Saturday dinner — decide, then book" — options, no venue yet
    expect(queriesOf(content).some(q => q.startsWith('Train south'))).toBe(false)
    expect(queriesOf(content).some(q => q.startsWith('Saturday dinner'))).toBe(false)
  })
  test('a geocoded stop that names a journey is not a venue either', () => {
    // The itinerary bolds "Ryanair FR3628" like a place, and it geocodes to the airport.
    const flight = content.items.find(i => i.place_name === 'Piazza Grande')!
    flight.place_name = 'Ryanair FR3628'
    expect(queriesOf(content).some(q => q.startsWith('Ryanair'))).toBe(false)
  })

  test('a booking that names a geocoded stop shares it instead of searching again', () => {
    const { targets, shared } = photoTargets(content, 'Valle')
    const stop = content.items.find(i => i.place_name === 'Trattoria Alba')!
    expect(shared.map(s => s.booking.id).sort()).toEqual(['B01', 'T01'])
    expect(shared.every(s => s.stopId === stop.id)).toBe(true)
    expect(targets.filter(t => t.query.startsWith('Trattoria Alba'))).toHaveLength(1)
  })
  test('set() writes back onto the row', () => {
    const t = photoTargets(content, 'Valle').targets.find(x => x.query.startsWith('Piazza Grande'))!
    t.set('valle/x.jpg', 'Someone')
    const row = content.items.find(i => i.place_name === 'Piazza Grande')!
    expect(row.photo_path).toBe('valle/x.jpg'); expect(row.photo_credit).toBe('Someone')
  })
  test('describeTargets is the query list an operator can eyeball', () => {
    expect(describeTargets(content, 'Valle')).toEqual(queriesOf(content))
    expect(describeTargets(content, 'Valle')).toContain('Caffè Nord, Via Roma 12, Valle')
  })
})

describe('findPlacePhoto / downloadPhoto', () => {
  test('text search returns id, first photo name and credit; bias is sent when given', async () => {
    const f = fakeFetch()
    const r = await findPlacePhoto('Piazza Grande, Valle', { lat: 45, lng: 7 }, 'KEY', f)
    expect(r).toEqual({ placeId: 'ChIJabc', photoName: 'places/ChIJabc/photos/p1', credit: 'Ana Photographer' })
    const body = JSON.parse(calls(f)[0][1].body as string)
    expect(body.textQuery).toBe('Piazza Grande, Valle'); expect(body.locationBias.circle.center).toEqual({ latitude: 45, longitude: 7 })
    expect(body.pageSize).toBe(1); expect(body.maxResultCount).toBeUndefined()
    expect(calls(f)[0][1].headers['X-Goog-FieldMask']).toContain('places.photos.authorAttributions')
  })
  test('no places → null; HTTP error → throws with status', async () => {
    expect(await findPlacePhoto('Nowhere', null, 'KEY', fakeFetch({ noPlaces: true }))).toBeNull()
    await expect(findPlacePhoto('X', null, 'KEY', fakeFetch({ searchStatus: 403 }))).rejects.toThrow(/403/)
  })
  test('downloadPhoto asks for 800px and returns the bytes', async () => {
    const f = fakeFetch()
    const bytes = await downloadPhoto('places/ChIJabc/photos/p1', 'KEY', f)
    expect(bytes.length).toBe(7)
    expect(String(calls(f)[0][0])).toContain('maxWidthPx=800')
  })
})

describe('attachPhotos', () => {
  test('fetches, uploads, caches and sets the row', async () => {
    const store = memStore()
    const targets = photoTargets(content, 'Valle').targets.slice(0, 2)
    const r = await attachPhotos(targets, store, 'KEY', fakeFetch())
    expect(r.attached).toBe(2); expect(r.skipped).toBe(0); expect(r.warnings).toEqual([])
    expect(store.uploads).toEqual(targets.map(t => t.path))
    expect(store.cache[targets[0].path].credit).toBe('Ana Photographer')
    expect(content.items.some(i => i.photo_credit === 'Ana Photographer')).toBe(true)
  })
  test('skips a target whose object and cache row exist, with no Google call, but still sets the row', async () => {
    const targets = photoTargets(content, 'Valle').targets.slice(0, 1)
    const store = memStore({ objects: [targets[0].path], cache: { [targets[0].path]: { placeId: 'x', photoName: 'y', credit: 'Old Credit' } } })
    const f = fakeFetch()
    const r = await attachPhotos(targets, store, 'KEY', f)
    expect(r.skipped).toBe(1); expect(calls(f)).toHaveLength(0)
    expect(content.items.find(i => i.photo_credit === 'Old Credit')!.photo_path).toBe(targets[0].path)
  })
  test('a failure is a warning naming the path, and the row stays null', async () => {
    const targets = photoTargets(content, 'Valle').targets.slice(0, 1)
    const r = await attachPhotos(targets, memStore(), 'KEY', fakeFetch({ mediaStatus: 500 }))
    expect(r.attached).toBe(0); expect(r.warnings).toHaveLength(1); expect(r.warnings[0]).toContain(targets[0].path)
  })
  test('no match is a warning too, not an error', async () => {
    const targets = photoTargets(content, 'Valle').targets.slice(0, 1)
    const r = await attachPhotos(targets, memStore(), 'KEY', fakeFetch({ noPlaces: true }))
    expect(r.attached).toBe(0); expect(r.warnings[0]).toMatch(/no place found/)
  })
  test('a stale cached photoName is re-searched once and re-downloaded, not warned away', async () => {
    const targets = photoTargets(content, 'Valle').targets.slice(0, 1)
    const path = targets[0].path
    // Cache row survives, object does not, and the cached name 404s: Google rotated it.
    const store = memStore({ cache: { [path]: { placeId: 'old', photoName: 'places/old/photos/gone', credit: 'Old Credit' } } })
    const f = fakeFetch({ firstMediaStatus: 404 })
    const r = await attachPhotos(targets, store, 'KEY', f)
    expect(r.attached).toBe(1); expect(r.warnings).toEqual([])
    expect(store.uploads).toEqual([path])
    expect(store.cache[path]).toEqual({ placeId: 'ChIJabc', photoName: 'places/ChIJabc/photos/p1', credit: 'Ana Photographer' })
    expect(targets[0].get()).toEqual({ path, credit: 'Ana Photographer' })
    expect(calls(f).filter(c => String(c[0]).includes('places:searchText'))).toHaveLength(1)
  })
  test('three refusals in a row abort the run before anything is rewritten', async () => {
    const { targets } = photoTargets(content, 'Valle')
    expect(targets.length).toBeGreaterThan(3)
    await expect(attachPhotos(targets, memStore(), 'KEY', fakeFetch({ searchStatus: 429 })))
      .rejects.toThrow('photos: Google refused 3 requests in a row (HTTP 403/429) — check the server key / quota')
  })
  test('shared bookings copy the stop photo: one search, both rows set', async () => {
    const { targets, shared } = photoTargets(content, 'Valle')
    const f = fakeFetch()
    const r = await attachPhotos(targets, memStore(), 'KEY', f, shared)
    expect(r.shared).toBe(2)
    const stop = content.items.find(i => i.place_name === 'Trattoria Alba')!
    for (const id of ['B01', 'T01']) {
      const b = content.bookings.find(x => x.id === id)!
      expect(b.photo_path).toBe(stop.photo_path)
      expect(b.photo_credit).toBe(stop.photo_credit)
    }
    const trattoria = calls(f).filter(c => String(c[0]).includes('places:searchText') && String(c[1].body).includes('Trattoria Alba'))
    expect(trattoria).toHaveLength(1)
  })
})

describe('supabasePhotoStore', () => {
  function fakeClient(seed: {
    list?: { data?: { name: string }[]; error?: { message: string } | null }
    upload?: { error?: { message: string } | null }
    row?: { data?: Record<string, unknown> | null; error?: { message: string } | null }
    upsert?: { error?: { message: string } | null }
  }) {
    const listArgs: unknown[][] = []
    const upserts: Record<string, unknown>[] = []
    const client = {
      storage: {
        from: () => ({
          list: async (dir: string, opts: unknown) => { listArgs.push([dir, opts]); return { data: seed.list?.data ?? [], error: seed.list?.error ?? null } },
          upload: async () => ({ error: seed.upload?.error ?? null }),
        }),
      },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: seed.row?.data ?? null, error: seed.row?.error ?? null }) }) }),
        upsert: async (v: Record<string, unknown>) => { upserts.push(v); return { error: seed.upsert?.error ?? null } },
      }),
    } as unknown as SupabaseClient
    return { store: supabasePhotoStore(client, 'owner-1'), listArgs, upserts }
  }

  test('exists asks for a page of names and matches the file exactly', async () => {
    const { store, listArgs } = fakeClient({ list: { data: [{ name: 'a.jpg' }, { name: 'a.jpg.bak' }] } })
    expect(await store.exists('valle/a.jpg')).toBe(true)
    expect(listArgs[0]).toEqual(['valle', { search: 'a.jpg', limit: 100 }])
  })
  test('exists is false when the page holds only near-misses', async () => {
    const { store } = fakeClient({ list: { data: [{ name: 'a.jpg.bak' }] } })
    expect(await store.exists('valle/a.jpg')).toBe(false)
  })
  test('upload throws on error', async () => {
    const { store } = fakeClient({ upload: { error: { message: 'boom' } } })
    await expect(store.upload('valle/a.jpg', new Uint8Array([1]))).rejects.toThrow(/photos upload valle\/a\.jpg: boom/)
  })
  test('cacheGet maps a row, and is null without a photo_name', async () => {
    const hit = fakeClient({ row: { data: { place_id: 'p', photo_name: 'n', credit: 'c' } } })
    expect(await hit.store.cacheGet('valle/a.jpg')).toEqual({ placeId: 'p', photoName: 'n', credit: 'c' })
    const empty = fakeClient({ row: { data: { place_id: 'p', photo_name: null, credit: null } } })
    expect(await empty.store.cacheGet('valle/a.jpg')).toBeNull()
    const none = fakeClient({ row: { data: null } })
    expect(await none.store.cacheGet('valle/a.jpg')).toBeNull()
  })
  test('cacheSet warns rather than throwing: the photo is already uploaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { store, upserts } = fakeClient({ upsert: { error: { message: 'nope' } } })
    await expect(store.cacheSet('valle/a.jpg', { placeId: 'p', photoName: 'n', credit: 'c' })).resolves.toBeUndefined()
    expect(upserts[0]).toEqual({ path: 'valle/a.jpg', owner: 'owner-1', place_id: 'p', photo_name: 'n', credit: 'c' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('photo_cache set failed: nope'))
    warn.mockRestore()
  })
})

describe('looksGeneric', () => {
  test('multi-word phrases with no inner capital or digit are descriptions, not venues', () => {
    for (const n of ['At the meeting point', 'decision needed', 'Alfama wander', 'Sintra day tour departs', 'Triana ceramic streets', 'Belém guided tour']) expect(looksGeneric(n)).toBe(true)
  })
  test('single words, inner capitals and digits are kept', () => {
    for (const n of ['Prado', 'Miolo', 'Time Out Market', 'Mesa de Frades', 'MAAT', 'Cathedral + Giralda', 'Setas de Sevilla', 'LX Factory', 'Cerámica 1920']) expect(looksGeneric(n)).toBe(false)
  })
  test('a generic-looking stop without an address is not a target; with an address it is', () => {
    const c = structuredClone(content)
    const stop = c.items.find(i => i.kind === 'stop' && i.place_name === 'Piazza Grande')!
    stop.place_name = 'At the meeting point'; stop.address = null; stop.lat = 45; stop.lng = 7
    expect(photoTargets(c, 'Valle').targets.some(t => t.query.startsWith('At the meeting point'))).toBe(false)
    stop.address = 'Via Roma 1'
    expect(photoTargets(c, 'Valle').targets.some(t => t.query.startsWith('At the meeting point'))).toBe(true)
  })
})
