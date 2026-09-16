# Europe Guide — Plan 6: Photos at import, offline in the app

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every stop and booking a photo, fetched once by the import script from Google Places into a private bucket, cached on the phone like ticket PDFs, and shown as the hero on the place and event screens and in the card photo slots, with the photographer credit Google requires.

**Architecture:** A new import step after geocoding (`scripts/import/photos.ts`) runs a Places Text Search per named stop and per booking, downloads the first photo at 800 px, uploads it to the `photos` bucket at `<trip>/<id>.jpg`, and writes `photo_path` + `photo_credit` onto the row; a `photo_cache` table keyed by storage path stores the Places answer so re-imports cost nothing. In the app, `src/lib/photosCache.ts` mirrors the attachments cache (Cache Storage, keyed by path), `usePhoto(path)` resolves a cached blob URL or a signed URL online, `PhotoImg` renders it, `warmTripPhotos` prefetches every photo of the trip once per session after the tickets pass, and the existing `photoSrc` slots on `TicketCard`/`PlaceCard` plus the two hero blocks consume it. No runtime Google calls; every surface keeps its colour-block fallback.

**Tech Stack:** unchanged. Supabase CLI (`supabase db push`, project linked) for the migration. Places API (New) Text Search + Photo Media via the server key.

**Spec:** `docs/superpowers/specs/2026-09-16-figma-redesign-design.md` §6 (amended: migration `20260916000007_photos.sql`; no `kind_hint`), §5.5 hero, §9, §10 step 6.

## Global Constraints

- The app never calls Google for photos at runtime; photos come from the `photos` bucket via signed URLs and are cached in Cache Storage. Cards and heroes render their existing fallback when `photo_path` is null or the photo is not yet cached.
- Photo path convention `<trip>/<id>.jpg`, JPEG, 800 px wide (`maxWidthPx=800`). Credit = first `authorAttributions[].displayName`.
- Import: failures are per-row warnings, never fatal; rows with an existing object in the bucket AND a `photo_cache` row are skipped with no Google call; `--skip-photos` mirrors `--skip-maps` and, like it, keeps existing `photo_path`/`photo_credit` values from the current DB rows.
- Bucket `photos` is private; owner-only read via `auth.role() = 'authenticated'` (same as `maps`); uploads come only from the import (service key).
- Cache budget: photos share the 200 MB whole-trip cap conceptually but live in their own Cache Storage bucket `europe-guide-photos`; the warm pass is sequential and stops (not fails) when offline.
- Every task ends with `npx vitest run` green and `npm run build` succeeding; the suite is 533 at the start.
- Commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (or the implementer model's own line if a system reminder says so); never commit `content/`, `.env`, `.cache/`. Work on branch `feat/figma-redesign` (already checked out).
- The owner must add **Places API (New)** to the server key's API restrictions before Task 5 runs; Tasks 1–4 do not need it.

## File structure

```
supabase/migrations/20260916000007_photos.sql   columns, photo_cache table + RLS, photos bucket + policy
scripts/import/types.ts                          ItemRow/BookingRow gain photo_path, photo_credit
scripts/import/parse/{bookings,itinerary}.ts     row constructors default the two new fields to null
scripts/import/photos.ts                         photoTargets, fetchPlacePhoto (Text Search + media), attachPhotos (skip/cache/upload), supabasePhotoStore
scripts/import/cli.ts                            --skip-photos flag; photo step after polylines; count in report
src/lib/photosCache.ts                           cachePhoto, getCachedPhotoBlob, hasCachedPhoto (Cache Storage 'europe-guide-photos')
src/lib/photos.ts                                signedPhotoUrl, usePhoto(path) hook, warmTripPhotos(trip, paths)
src/components/PhotoImg.tsx                      <PhotoImg path className alt /> → <img> or null
src/components/{TicketCard,PlaceCard}.tsx        use PhotoImg when the row has a photo_path
src/screens/{PlaceDetail,TicketDetail,Home}.tsx  hero photo + credit; Home starts the photo warm pass
src/styles/base.css                              hero photo, gradient, credit
tests/import/photos.test.ts, tests/lib/{photosCache,photos}.test.ts, tests/app/{PhotoImg,PlaceDetail,TicketDetail,TicketCard}.test.tsx (additions)
```

---

### Task 1: Migration, bucket, types

**Files:**
- Create: `supabase/migrations/20260916000007_photos.sql`
- Modify: `scripts/import/types.ts`, `scripts/import/parse/bookings.ts:31`, `scripts/import/parse/itinerary.ts` (both `push({ kind: 'stop' …})` and `push({ kind: 'option' …})` and the `note`/`route_link` pushes), `tests/lib/tickets.test.ts` (the `b()` factory gains the two fields), any other test factory that builds `ItemRow`/`BookingRow` literals (`grep -rn "status_from_file:" tests`)
- Test: `tests/import/write.test.ts` (add one assertion), `tests/import/migration.test.ts` (new)

**Interfaces:**
- Produces `ItemRow.photo_path: string | null`, `ItemRow.photo_credit: string | null`, same on `BookingRow`.
- Produces table `photo_cache(path text primary key, owner uuid, place_id text, photo_name text, credit text, fetched_at timestamptz)` and bucket `photos`.

- [ ] **Step 1: Failing tests**

`tests/import/migration.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { test, expect } from 'vitest'
const sql = readFileSync('supabase/migrations/20260916000007_photos.sql', 'utf8')
test('photo columns, cache table, bucket and policies', () => {
  expect(sql).toMatch(/alter table items add column if not exists photo_path text/)
  expect(sql).toMatch(/alter table items add column if not exists photo_credit text/)
  expect(sql).toMatch(/alter table bookings add column if not exists photo_path text/)
  expect(sql).toMatch(/alter table bookings add column if not exists photo_credit text/)
  expect(sql).toMatch(/create table if not exists photo_cache/)
  expect(sql).toMatch(/enable row level security/)
  expect(sql).toMatch(/'photos','photos',false/)
  expect(sql).toMatch(/bucket_id = 'photos' and auth.role\(\) = 'authenticated'/)
})
```
Append to `tests/import/write.test.ts`:
```ts
test('assembled rows carry null photo fields until the photo step fills them', async () => {
  const { content } = await assembleCity('tests/fixtures/valle', 'valle')
  expect(content.items.every(i => i.photo_path === null && i.photo_credit === null)).toBe(true)
  expect(content.bookings.every(b => b.photo_path === null && b.photo_credit === null)).toBe(true)
})
```
(Use the file's existing `assembleCity` import; add it if absent.)

- [ ] **Step 2: Run to fail** — `npx vitest run tests/import/migration.test.ts tests/import/write.test.ts`.

- [ ] **Step 3: Migration**

`supabase/migrations/20260916000007_photos.sql`:
```sql
-- Photos fetched at import: one per stop/booking, stored in the private `photos` bucket.
alter table items add column if not exists photo_path text;
alter table items add column if not exists photo_credit text;
alter table bookings add column if not exists photo_path text;
alter table bookings add column if not exists photo_credit text;

-- What Places answered for a given storage path, so a re-import never asks Google twice.
create table if not exists photo_cache (
  path text primary key,
  owner uuid not null default auth.uid(),
  place_id text, photo_name text, credit text,
  fetched_at timestamptz not null default now()
);
alter table photo_cache enable row level security;
create policy owner_all on photo_cache for all using (owner = auth.uid()) with check (owner = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit)
values ('photos','photos',false, 5242880)
on conflict (id) do nothing;
create policy photos_read on storage.objects for select
  using (bucket_id = 'photos' and auth.role() = 'authenticated');
```
`import_city` needs no change: `jsonb_populate_recordset(null::items, …)` picks up the new columns and leaves them null when the JSON lacks them.

- [ ] **Step 4: Types and constructors**

In `scripts/import/types.ts` add `photo_path: string | null; photo_credit: string | null` to `ItemRow` (after `route_id`) and `BookingRow` (after `sort`). In `scripts/import/parse/bookings.ts` `blank()` add `photo_path: null, photo_credit: null`. In `scripts/import/parse/itinerary.ts` every `push({ … })` literal gains `photo_path: null, photo_credit: null` (four sites: stop, option, route_link, note). Fix every test factory the compiler flags (`npm run build` runs `tsc --noEmit`): `tests/lib/tickets.test.ts` `b()`, `tests/app/TicketCard.test.tsx` `booking`, and any other literal.

- [ ] **Step 5: Apply the migration**

```bash
supabase db push
supabase migration list --linked | grep -c 20260916000007
```
Expected: the second command prints `1`. If `db push` asks for confirmation, answer yes.

- [ ] **Step 6: Suite + build, commit**

```bash
npx vitest run && npm run build
git add supabase/migrations/20260916000007_photos.sql scripts/import/types.ts scripts/import/parse tests
git commit -m "feat(photos): photo columns, photo_cache table, photos bucket

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Import photo step

**Files:**
- Create: `scripts/import/photos.ts`
- Modify: `scripts/import/cli.ts` (flag, step, report count), `scripts/import/report.ts` (only if it enumerates count keys)
- Test: `tests/import/photos.test.ts`, `tests/import/cli.test.ts` (flag)

**Interfaces:**
```ts
export interface PhotoTarget { path: string; query: string; lat: number | null; lng: number | null; set(pathOrNull: string | null, credit: string | null): void }
export function photoTargets(content: CityContent, cityHint: string): PhotoTarget[]
export interface PlacesPhoto { placeId: string; photoName: string; credit: string | null }
export async function findPlacePhoto(query: string, bias: { lat: number; lng: number } | null, key: string, fetchImpl?: typeof fetch): Promise<PlacesPhoto | null>
export async function downloadPhoto(photoName: string, key: string, fetchImpl?: typeof fetch): Promise<Uint8Array>
export interface PhotoStore {
  exists(path: string): Promise<boolean>
  upload(path: string, bytes: Uint8Array): Promise<void>
  cacheGet(path: string): Promise<PlacesPhoto | null>
  cacheSet(path: string, v: PlacesPhoto): Promise<void>
}
export async function attachPhotos(targets: PhotoTarget[], store: PhotoStore, key: string, fetchImpl?: typeof fetch): Promise<{ attached: number; skipped: number; warnings: string[] }>
export function supabasePhotoStore(client: SupabaseClient, ownerId: string): PhotoStore
```

- [ ] **Step 1: Failing tests**

`tests/import/photos.test.ts`:
```ts
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
```
Append to `tests/import/cli.test.ts`:
```ts
test('--skip-photos', () => {
  expect(parseFlags(['--skip-photos'])).toEqual({ dryRun: false, skipMaps: false, skipPhotos: true, maxzoom: 15, splitAreas: false })
})
```
and add `skipPhotos: false` to the expected objects of the existing `parseFlags` tests.

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement `scripts/import/photos.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CityContent } from './types'

export interface PhotoTarget { path: string; query: string; lat: number | null; lng: number | null; set(path: string | null, credit: string | null): void }
export interface PlacesPhoto { placeId: string; photoName: string; credit: string | null }
export interface PhotoStore {
  exists(path: string): Promise<boolean>
  upload(path: string, bytes: Uint8Array): Promise<void>
  cacheGet(path: string): Promise<PlacesPhoto | null>
  cacheSet(path: string, v: PlacesPhoto): Promise<void>
}

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
const FIELD_MASK = 'places.id,places.photos.name,places.photos.authorAttributions.displayName'
const WIDTH = 800

function safeId(id: string): string { return id.replace(/[^A-Za-z0-9_-]/g, '_') }

/** One photo per named stop/option and per booking that is not a walk-in. */
export function photoTargets(content: CityContent, cityHint: string): PhotoTarget[] {
  const slug = content.trip.slug
  const out: PhotoTarget[] = []
  for (const item of content.items) {
    if ((item.kind !== 'stop' && item.kind !== 'option') || !item.place_name) continue
    out.push({
      path: `${slug}/${safeId(item.id)}.jpg`,
      query: [item.place_name, item.address, cityHint].filter(Boolean).join(', '),
      lat: item.lat, lng: item.lng,
      set: (p, c) => { item.photo_path = p; item.photo_credit = c },
    })
  }
  for (const b of content.bookings) {
    if (b.kind === 'walkin') continue
    const name = b.title.split(/ — | - /)[0].trim()
    out.push({
      path: `${slug}/${safeId(b.id)}.jpg`,
      query: [name, b.address, cityHint].filter(Boolean).join(', '),
      lat: null, lng: null,
      set: (p, c) => { b.photo_path = p; b.photo_credit = c },
    })
  }
  return out
}

export async function findPlacePhoto(query: string, bias: { lat: number; lng: number } | null, key: string, fetchImpl: typeof fetch = fetch): Promise<PlacesPhoto | null> {
  const body: Record<string, unknown> = { textQuery: query, maxResultCount: 1 }
  if (bias) body.locationBias = { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 2000 } }
  const res = await fetchImpl(SEARCH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`places searchText HTTP ${res.status}`)
  const json = await res.json() as { places?: { id: string; photos?: { name: string; authorAttributions?: { displayName?: string }[] }[] }[] }
  const place = json.places?.[0]
  const photo = place?.photos?.[0]
  if (!place || !photo) return null
  return { placeId: place.id, photoName: photo.name, credit: photo.authorAttributions?.[0]?.displayName ?? null }
}

export async function downloadPhoto(photoName: string, key: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const res = await fetchImpl(`https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${WIDTH}&key=${key}`)
  if (!res.ok) throw new Error(`photo media HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Sequential on purpose (a burst is how the trial key hits per-minute quota). A target whose
 * object and cache row both exist costs nothing; anything else that fails becomes a warning
 * and leaves the row's photo fields null — a missing photo is a fallback, never a failed import.
 */
export async function attachPhotos(targets: PhotoTarget[], store: PhotoStore, key: string, fetchImpl: typeof fetch = fetch) {
  let attached = 0, skipped = 0
  const warnings: string[] = []
  for (const t of targets) {
    try {
      const cached = await store.cacheGet(t.path)
      if (cached && await store.exists(t.path)) { t.set(t.path, cached.credit); skipped += 1; continue }
      const found = cached ?? await findPlacePhoto(t.query, t.lat != null && t.lng != null ? { lat: t.lat, lng: t.lng } : null, key, fetchImpl)
      if (!found) { warnings.push(`photo ${t.path}: no place found for "${t.query}"`); t.set(null, null); continue }
      const bytes = await downloadPhoto(found.photoName, key, fetchImpl)
      await store.upload(t.path, bytes)
      await store.cacheSet(t.path, found)
      t.set(t.path, found.credit)
      attached += 1
    } catch (e) {
      warnings.push(`photo ${t.path}: ${(e as Error).message}`)
      t.set(null, null)
    }
  }
  return { attached, skipped, warnings }
}

export function supabasePhotoStore(client: SupabaseClient, ownerId: string): PhotoStore {
  return {
    async exists(path) {
      const [dir, file] = [path.slice(0, path.lastIndexOf('/')), path.slice(path.lastIndexOf('/') + 1)]
      const { data, error } = await client.storage.from('photos').list(dir, { search: file, limit: 1 })
      if (error) throw new Error(`photos list: ${error.message}`)
      return (data ?? []).some(o => o.name === file)
    },
    async upload(path, bytes) {
      const { error } = await client.storage.from('photos').upload(path, bytes, { upsert: true, contentType: 'image/jpeg' })
      if (error) throw new Error(`photos upload ${path}: ${error.message}`)
    },
    async cacheGet(path) {
      const { data, error } = await client.from('photo_cache').select('place_id,photo_name,credit').eq('path', path).maybeSingle()
      if (error) { console.warn(`photo_cache get failed: ${error.message}`); return null }
      return data?.photo_name ? { placeId: data.place_id, photoName: data.photo_name, credit: data.credit } : null
    },
    async cacheSet(path, v) {
      const { error } = await client.from('photo_cache').upsert({ path, owner: ownerId, place_id: v.placeId, photo_name: v.photoName, credit: v.credit })
      if (error) console.warn(`photo_cache set failed: ${error.message}`)
    },
  }
}
```

- [ ] **Step 4: Wire the CLI**

In `scripts/import/cli.ts`: `USAGE` and `ALLOWED_FLAGS` gain `--skip-photos`; `parseFlags` returns `skipPhotos`; after the polyline loop and before the offline-areas block add:
```ts
  let photoCounts = { attached: 0, skipped: 0 }
  if (!skipPhotos && !dryRun) {
    const store = supabasePhotoStore(client, env.ownerId)
    const r = await attachPhotos(photoTargets(content, cityHint), store, env.googleServerKey)
    photoCounts = { attached: r.attached, skipped: r.skipped }
    warnings.push(...r.warnings)
  } else if (skipPhotos && !dryRun) {
    // Keep what the last import attached: the rows are rewritten wholesale below.
    const { data, error } = await client.from('items').select('id,photo_path,photo_credit').eq('trip', slug)
    if (error) throw new Error(`items photo fetch: ${error.message}`)
    for (const row of data ?? []) { const it = content.items.find(i => i.id === row.id); if (it) { it.photo_path = row.photo_path; it.photo_credit = row.photo_credit } }
    const { data: bk, error: bErr } = await client.from('bookings').select('id,photo_path,photo_credit').eq('trip', slug)
    if (bErr) throw new Error(`bookings photo fetch: ${bErr.message}`)
    for (const row of bk ?? []) { const b = content.bookings.find(x => x.id === row.id); if (b) { b.photo_path = row.photo_path; b.photo_credit = row.photo_credit } }
    warnings.push('photos skipped — kept existing photo paths')
  } else if (skipPhotos) {
    warnings.push('photos skipped (--skip-photos)')
  }
```
and add `photos: photoCounts.attached + photoCounts.skipped` to the counts passed to `printReport` (for the dry run, `photos: photoTargets(content, cityHint).length`). Import `photoTargets, attachPhotos, supabasePhotoStore` from `./photos`.

- [ ] **Step 5: Tests, build, commit**

`npx vitest run && npm run build`, then commit `feat(import): Places photos per stop and booking into the photos bucket, --skip-photos`.

---

### Task 3: App cache, hook, warm pass

**Files:**
- Create: `src/lib/photosCache.ts`, `src/lib/photos.ts`, `src/components/PhotoImg.tsx`
- Test: `tests/lib/photosCache.test.ts`, `tests/lib/photos.test.ts`, `tests/app/PhotoImg.test.tsx`

**Interfaces:**
```ts
// photosCache.ts
export const PHOTO_CACHE_NAME = 'europe-guide-photos'
export function photoKey(path: string): string                       // `/__photo/${path}`
export async function cachePhoto(path: string, signedUrl: string, fetchImpl?: typeof fetch, cacheStorage?: CacheStorage): Promise<void>
export async function getCachedPhotoBlob(path: string, cacheStorage?: CacheStorage): Promise<Blob | null>
export async function hasCachedPhoto(path: string, cacheStorage?: CacheStorage): Promise<boolean>
// photos.ts
export async function signedPhotoUrl(path: string, client?: SupabaseClient): Promise<string>
export function usePhoto(path: string | null | undefined, client?: SupabaseClient): string | null   // blob: URL or signed URL, null while unknown/missing
export function warmTripPhotos(trip: string, paths: string[], client?: SupabaseClient, cacheStorage?: CacheStorage): Promise<{ cached: number; total: number }>
export function resetPhotoWarmForTests(): void
// PhotoImg.tsx
export function PhotoImg({ path, className, alt }: { path: string | null | undefined; className?: string; alt?: string }): JSX.Element | null
```

- [ ] **Step 1: Failing tests**

`tests/lib/photosCache.test.ts` — copy the structure of `tests/lib/attachmentsCache.test.ts` (it uses `FakeCacheStorage` from `../helpers/fakeCaches`) for `cachePhoto`/`getCachedPhotoBlob`/`hasCachedPhoto`, asserting the cache name `europe-guide-photos`, the key `/__photo/<path>`, and that a non-OK fetch throws and caches nothing.

`tests/lib/photos.test.ts`:
```ts
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
```

`tests/app/PhotoImg.test.tsx`:
```tsx
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
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() })
  await cachePhoto('valle/a.jpg', 'https://x/a.jpg', vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })) as unknown as typeof fetch, cs as unknown as CacheStorage)
  render(<PhotoImg path="valle/a.jpg" className="hero" alt="" />)
  await waitFor(() => expect(screen.getByRole('presentation')).toHaveAttribute('src', 'blob:fake'))
  vi.unstubAllGlobals()
})
```
(`alt=""` gives the `img` the `presentation` role.)

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement**

`src/lib/photosCache.ts` — mirror `attachmentsCache.ts` exactly with `PHOTO_CACHE_NAME = 'europe-guide-photos'`, `photoKey(path) = `/__photo/${path}``, and the three functions (`cachePhoto`, `getCachedPhotoBlob`, `hasCachedPhoto`), each taking `cacheStorage: CacheStorage = globalThis.caches`.

`src/lib/photos.ts`:
```ts
import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { cachePhoto, getCachedPhotoBlob, hasCachedPhoto } from './photosCache'

export async function signedPhotoUrl(path: string, client: SupabaseClient = supabase): Promise<string> {
  const { data, error } = await client.storage.from('photos').createSignedUrl(path, 3600)
  if (error) throw error
  return (data as { signedUrl: string }).signedUrl
}

/**
 * The photo at `path` as something an <img> can show: the cached bytes when the phone has
 * them, else a signed URL while online (and the bytes are cached in the background for next
 * time). Null until known, and null when neither is possible — the caller draws its fallback.
 */
export function usePhoto(path: string | null | undefined, client: SupabaseClient = supabase): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true; let objectUrl: string | null = null
    setSrc(null)
    if (!path) return
    void (async () => {
      try {
        const store = typeof caches === 'undefined' ? undefined : caches
        const blob = store ? await getCachedPhotoBlob(path, store) : null
        if (blob) { objectUrl = URL.createObjectURL(blob); if (alive) setSrc(objectUrl); return }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return
        const url = await signedPhotoUrl(path, client)
        if (alive) setSrc(url)
        if (store) void cachePhoto(path, url, fetch, store).catch(() => {})
      } catch { /* fallback stays */ }
    })()
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [path, client])
  return src
}

const runs = new Map<string, Promise<{ cached: number; total: number }>>()
export function resetPhotoWarmForTests() { runs.clear() }

/** Put every photo of the trip on the phone, once per trip per session, after the tickets pass. */
export function warmTripPhotos(trip: string, paths: string[], client: SupabaseClient = supabase, cacheStorage?: CacheStorage): Promise<{ cached: number; total: number }> {
  const NOTHING = { cached: 0, total: 0 }
  if (!trip || paths.length === 0) return Promise.resolve(NOTHING)
  const existing = runs.get(trip); if (existing) return existing
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(NOTHING)
  const store = cacheStorage ?? (typeof caches === 'undefined' ? undefined : caches)
  if (!store) return Promise.resolve(NOTHING)
  const run = (async () => {
    let cached = 0
    for (const path of paths) {
      try {
        if (await hasCachedPhoto(path, store)) { cached += 1; continue }
        await cachePhoto(path, await signedPhotoUrl(path, client), fetch, store)
        cached += 1
      } catch (e) { console.warn(e instanceof Error ? e.message : String(e)) }
    }
    return { cached, total: paths.length }
  })()
  runs.set(trip, run)
  return run
}
```

`src/components/PhotoImg.tsx`:
```tsx
import { usePhoto } from '../lib/photos'

/** An <img> for a stored photo path, or nothing while it is unknown or missing so the parent's fallback shows through. */
export function PhotoImg({ path, className, alt = '' }: { path: string | null | undefined; className?: string; alt?: string }) {
  const src = usePhoto(path)
  if (!src) return null
  return <img className={className} src={src} alt={alt} loading="lazy" />
}
```

- [ ] **Step 4: Suite, build, commit** — `feat(photos): offline photo cache, usePhoto, PhotoImg, trip warm pass`.

---

### Task 4: Wire photos into heroes, cards and the warm pass

**Files:**
- Modify: `src/components/TicketCard.tsx`, `src/components/PlaceCard.tsx`, `src/screens/PlaceDetail.tsx`, `src/screens/TicketDetail.tsx`, `src/screens/Home.tsx`, `src/styles/base.css`
- Test: additions to `tests/app/PlaceDetail.test.tsx`, `tests/app/TicketDetail.test.tsx`, `tests/app/TicketCard.test.tsx`, `tests/app/Home.test.tsx`

**Interfaces:** consumes `PhotoImg`, `warmTripPhotos`; rows' `photo_path`/`photo_credit`.

- [ ] **Step 1: Failing tests**

Mock `../../src/lib/photos` in each test file: `vi.mock('../../src/lib/photos', () => ({ usePhoto: (p: string | null) => (p ? `blob:${p}` : null), warmTripPhotos: warmPhotosMock }))` (declare `warmPhotosMock` with `vi.hoisted` where Home is tested).

- PlaceDetail: a stop with `photo_path: 'valle/x.jpg', photo_credit: 'Ana P.'` renders `.place-detail__hero img[src="blob:valle/x.jpg"]`, the credit text `Photo: Ana P.`, and no `.place-detail__glyph`; a stop without a path renders the glyph and no img.
- TicketDetail (event layout): same for B01 given a `photo_path`.
- TicketCard: with `booking.photo_path` set (and no `photoSrc` prop) the card renders `.ticket-card__photo[src="blob:…"]`; without, no `.ticket-card__art`.
- Home: after content loads, `warmPhotosMock` is called with `'valle'` and the list of every non-null `photo_path` across items and bookings (assert `toHaveBeenCalledWith('valle', expect.any(Array))` and that the array equals the expected list).

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement**

- `TicketCard`: replace the `photoSrc` prop handling with `const path = photoSrc ?? booking.photo_path` … render `{path && <span className="ticket-card__art"><PhotoImg path={path} className="ticket-card__photo" /></span>}`; keep the `photoSrc` prop for callers that already pass one.
- `PlaceCard`: `const path = photoSrc ?? item.photo_path`; render `<PhotoImg path={path} className="place-card__photo" />` and the glyph only when `!path`.
- `PlaceDetail` hero:
  ```tsx
  <div className={`place-detail__hero${item.photo_path ? ' place-detail__hero--photo' : ''}`}>
    {item.photo_path ? <PhotoImg path={item.photo_path} className="place-detail__photo" /> : <Icon set="kind" name="event" size={64} className="place-detail__glyph" />}
    <h1 className="place-detail__title">{name}</h1>
    {item.photo_path && item.photo_credit && <span className="place-detail__credit">Photo: {item.photo_credit}</span>}
  </div>
  ```
  Same in `TicketDetail`'s event branch with `booking.photo_path`/`booking.photo_credit`.
- `Home`: after the attachments warm effect add
  ```tsx
  useEffect(() => {
    if (!content) return
    const paths = [...content.items, ...content.bookings].map(r => r.photo_path).filter((p): p is string => !!p)
    void warmTripPhotos(content.trip.slug, paths).catch(() => {})
  }, [content])
  ```
- CSS:
  ```css
  .place-detail__hero--photo { background: var(--surface); }
  .place-detail__photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .place-detail__hero--photo::after { content: ''; position: absolute; inset: 0; background: linear-gradient(to top, rgba(7,6,6,.85) 0%, rgba(7,6,6,.25) 55%, rgba(7,6,6,0) 100%); }
  .place-detail__hero--photo .place-detail__title { position: relative; z-index: 1; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.4); }
  .place-detail__credit { position: absolute; top: 12px; right: 14px; z-index: 1; font-size: 11px; font-weight: 600; color: rgba(255,255,255,.8); background: rgba(7,6,6,.35); padding: 3px 8px; border-radius: var(--radius-pill); }
  ```

- [ ] **Step 4: Suite, build, commit** — `feat(photos): hero photos with credit, card photos, Home warms the trip's photos`.

---

### Task 5: Re-import both cities, screenshots, push

**Precondition:** the owner has added Places API (New) to `europe-guide-server`. Verify before importing:
```bash
KEY=$(grep '^GOOGLE_SERVER_KEY=' .env | cut -d= -f2- | tr -d '\r"'"'"' ')
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Content-Type: application/json" -H "X-Goog-Api-Key: $KEY" -H "X-Goog-FieldMask: places.id" -d '{"textQuery":"Real Alcázar de Sevilla","maxResultCount":1}' https://places.googleapis.com/v1/places:searchText
```
Expected `200`. A `403` means the key is not yet enabled — stop and report NEEDS_CONTEXT.

- [ ] **Step 1:** `npm run import -- lisbon --skip-maps` then `npm run import -- seville --skip-maps`. Expected report lines: `photos N` with N ≈ 90 (Lisbon) / 60 (Seville) and a short warnings list (a handful of "no place found" is normal for generic names).
- [ ] **Step 2:** Verify a few rows: `node .cache/check-b04.mjs`-style query showing `photo_path` and `photo_credit` set on B04 and on the Piazza-like stops; `supabase storage ls` is not available — instead list via the client: count objects under `photos/lisbon` and `photos/seville`.
- [ ] **Step 3:** Build, `vite preview`, run `tools/probe-screens.mjs` for seville 2026-10-05 and lisbon 2026-10-01 into `docs/superpowers/plans/2026-09-16-plan-5-shots/` (overwrite), plus the ticket for B04 (`lisbon-ticket-flight.png`). Read `place.png`, `home.png`, `tickets.png`: heroes and cards must show photographs with the credit pill; note any card whose photo looks wrong (a photo of the wrong venue is possible for generic names).
- [ ] **Step 4:** Append a "Plan 6" section to `docs/superpowers/plans/2026-09-16-plan-5-notes.md` (counts, warnings, cost estimate from the Google console if visible), commit, push. Do not merge.

---

## Self-review

**Spec coverage.** §6.1 storage + schema → Task 1 (columns, `photo_cache`, bucket + policy; `import_city` unchanged by design). §6.2 import step → Task 2 (Text Search with locationBias instead of Details-by-place_id: the geocode cache key is not recoverable per row, and Text Search with the geocoded point as bias is one call instead of two; skip-if-exists via object + cache row; `--skip-photos` keeps existing values; failures as warnings). §6.3 app → Tasks 3–4 (warm pass after tickets, `PhotoImg` fallback). §5.5 hero with credit → Task 4. §9 tests → every task. Step 6 of §10 → Task 5.

**Placeholders.** None; every code step has its code.

**Type consistency.** `PhotoTarget`, `PlacesPhoto`, `PhotoStore`, `attachPhotos`, `photoTargets`, `findPlacePhoto`, `downloadPhoto`, `supabasePhotoStore` (Task 2) match the CLI wiring; `cachePhoto`/`getCachedPhotoBlob`/`hasCachedPhoto`, `usePhoto`, `warmTripPhotos`, `signedPhotoUrl`, `PhotoImg` (Task 3) match their use in Task 4 and the tests.
