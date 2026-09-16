import { describe, test, expect, beforeEach, vi } from 'vitest'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'
import { photoTargets, findPlacePhoto, downloadPhoto, attachPhotos } from '../../scripts/import/photos'
import type { PhotoStore, PlacesPhoto } from '../../scripts/import/photos'

let content: CityContent
beforeEach(async () => { content = await loadValle() })

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
function fakeFetch(opts: { searchStatus?: number; noPlaces?: boolean; mediaStatus?: number } = {}): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('places:searchText')) return new Response(JSON.stringify(opts.noPlaces ? { places: [] } : searchJson), { status: opts.searchStatus ?? 200 })
    if (url.includes('/media')) return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { status: opts.mediaStatus ?? 200, headers: { 'content-type': 'image/jpeg' } })
    throw new Error(`unexpected fetch ${url}`)
  }) as unknown as typeof fetch
}

describe('photoTargets', () => {
  test('one target per named stop/option and per non-walk-in booking, path <trip>/<id>.jpg', () => {
    const t = photoTargets(content, 'Valle')
    const paths = t.map(x => x.path)
    expect(paths.every(p => /^valle\/[^/]+\.jpg$/.test(p))).toBe(true)
    expect(t.some(x => x.query.startsWith('Piazza Grande'))).toBe(true)
    expect(t.some(x => x.query.startsWith('Train south'))).toBe(true)
    expect(t.some(x => x.query.startsWith('Walk to the belvedere'))).toBe(false)   // no place name → no photo
    const walkins = content.bookings.filter(b => b.kind === 'walkin').map(b => `valle/${b.id}.jpg`)
    expect(paths.some(p => walkins.includes(p))).toBe(false)
  })
  test('set() writes back onto the row', () => {
    const t = photoTargets(content, 'Valle').find(x => x.query.startsWith('Piazza Grande'))!
    t.set('valle/x.jpg', 'Someone')
    const row = content.items.find(i => i.place_name === 'Piazza Grande')!
    expect(row.photo_path).toBe('valle/x.jpg'); expect(row.photo_credit).toBe('Someone')
  })
})

describe('findPlacePhoto / downloadPhoto', () => {
  test('text search returns id, first photo name and credit; bias is sent when given', async () => {
    const f = fakeFetch()
    const r = await findPlacePhoto('Piazza Grande, Valle', { lat: 45, lng: 7 }, 'KEY', f)
    expect(r).toEqual({ placeId: 'ChIJabc', photoName: 'places/ChIJabc/photos/p1', credit: 'Ana Photographer' })
    const body = JSON.parse((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
    expect(body.textQuery).toBe('Piazza Grande, Valle'); expect(body.locationBias.circle.center).toEqual({ latitude: 45, longitude: 7 })
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].headers['X-Goog-FieldMask']).toContain('places.photos.authorAttributions')
  })
  test('no places → null; HTTP error → throws with status', async () => {
    expect(await findPlacePhoto('Nowhere', null, 'KEY', fakeFetch({ noPlaces: true }))).toBeNull()
    await expect(findPlacePhoto('X', null, 'KEY', fakeFetch({ searchStatus: 403 }))).rejects.toThrow(/403/)
  })
  test('downloadPhoto asks for 800px and returns the bytes', async () => {
    const f = fakeFetch()
    const bytes = await downloadPhoto('places/ChIJabc/photos/p1', 'KEY', f)
    expect(bytes.length).toBe(7)
    expect(String((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('maxWidthPx=800')
  })
})

describe('attachPhotos', () => {
  test('fetches, uploads, caches and sets the row', async () => {
    const store = memStore()
    const targets = photoTargets(content, 'Valle').slice(0, 2)
    const r = await attachPhotos(targets, store, 'KEY', fakeFetch())
    expect(r.attached).toBe(2); expect(r.skipped).toBe(0); expect(r.warnings).toEqual([])
    expect(store.uploads).toEqual(targets.map(t => t.path))
    expect(store.cache[targets[0].path].credit).toBe('Ana Photographer')
    expect(content.items.concat(content.bookings as never[]).some(r => (r as { photo_credit: string | null }).photo_credit === 'Ana Photographer')).toBe(true)
  })
  test('skips a target whose object and cache row exist, with no Google call, but still sets the row', async () => {
    const targets = photoTargets(content, 'Valle').slice(0, 1)
    const store = memStore({ objects: [targets[0].path], cache: { [targets[0].path]: { placeId: 'x', photoName: 'y', credit: 'Old Credit' } } })
    const f = fakeFetch()
    const r = await attachPhotos(targets, store, 'KEY', f)
    expect(r.skipped).toBe(1); expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
    expect(targets[0].path).toBe(content.items.find(i => i.photo_credit === 'Old Credit')?.photo_path ?? content.bookings.find(b => b.photo_credit === 'Old Credit')?.photo_path)
  })
  test('a failure is a warning naming the path, and the row stays null', async () => {
    const targets = photoTargets(content, 'Valle').slice(0, 1)
    const r = await attachPhotos(targets, memStore(), 'KEY', fakeFetch({ mediaStatus: 500 }))
    expect(r.attached).toBe(0); expect(r.warnings).toHaveLength(1); expect(r.warnings[0]).toContain(targets[0].path)
  })
  test('no match is a warning too, not an error', async () => {
    const targets = photoTargets(content, 'Valle').slice(0, 1)
    const r = await attachPhotos(targets, memStore(), 'KEY', fakeFetch({ noPlaces: true }))
    expect(r.attached).toBe(0); expect(r.warnings[0]).toMatch(/no place found/)
  })
})
