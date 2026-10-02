# Taste Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The map's "!" discoveries are filtered by a taste profile built from the owner's own itineraries, so tourist-trap restaurants stop earning a marker and neighbourhood tascas start to.

**Architecture:** The importer asks Google Place Details for five metadata fields per stop and stores them on `items`, `parked_venues` and the geocode cache. The app fetches those fields for every trip, builds a per-category profile (eat / shop / see) with a pure function in `src/lib/taste.ts`, and scores each nearby Places result against it before drawing a "!". A "Not for us" button on the place sheet records a vote through the existing offline outbox and dampens the profile.

**Tech Stack:** TypeScript, React 18, Vite, vitest + @testing-library/react (jsdom), Supabase (PostgREST, RLS), Google Places API (New), MapLibre GL. Node scripts run with `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-29-taste-profile-design.md`

## Global Constraints

- Branch: all work on `feat/taste-profile` (already created; the spec is committed there). Never commit to `main`.
- Run tests with `npx vitest run <file>`; the whole suite is `npm test`. Type-check with `npx tsc --noEmit` before every commit.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Nothing in `content/` is committed (gitignored, private). The Lisbon fixture in this plan holds venue names and Google metadata only.
- Migration is applied with `supabase db push` from the repo root (the project is linked; see plan-1). Apply it before re-importing.
- With no metadata rows (nothing re-imported yet) the map must behave exactly as today. Spec §5.
- Constants (one place each, exported, commented): `THRESHOLD = 0.45`, `TYPE_SATURATION = 3`, `CROWD_MULTIPLE = 3`, `RATING_RAMP = 0.5`, `RATING_OFFSET = 0.2`, `MIN_RATING_FLOOR = 4.0`, `THIN_N = 5`, `THIN_WEIGHT = 0.6`, `DOWNVOTE_FACTOR = 0.7`, `UPVOTE_FACTOR = 1.3`.
- Copy rules: the sheet button reads exactly `Not for us`; the Diagnostics heading reads exactly `Taste`.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/20260929000008_taste.sql` | New nullable metadata columns on `items`, `parked_venues`, `geocode_cache`; table `place_votes` with owner RLS |
| `scripts/import/types.ts` | `PlaceMeta` fields added (optional) to `ItemRow` and `ParkedRow`; `PlaceMeta`, `PlaceVoteRow` types |
| `scripts/import/placeMeta.ts` (new) | `fetchPlaceMeta` (Place Details), `supabaseMetaCache`, `enrichPlaceMeta` (fills items/parked) |
| `scripts/import/cli.ts` | Calls `enrichPlaceMeta` after `geocodeContent` |
| `src/lib/taste.ts` (new) | Pure: `categoryOf`, `buildProfile`, `scorePlace`, constants |
| `src/lib/places.ts` | Wider `INCLUDED_TYPES`; `nearbyPlaces` takes an optional profile and keeps by score |
| `src/lib/data.ts`, `src/lib/db.ts`, `src/lib/trip.tsx` | `fetchAllPlaceMeta`, IndexedDB cache under `meta/placeMeta`, `placeMeta` on the Trip context |
| `src/lib/outbox.ts`, `src/lib/sync.ts`, `src/lib/state.ts` | Outbox kind `place_vote`, replay as upsert, `usePlaceVotes` hook |
| `src/components/MapSheet.tsx`, `src/screens/Map.tsx` | "Not for us" button; profile passed to the search; hide + vote |
| `src/screens/More.tsx` | Diagnostics "Taste" block |
| `tests/fixtures/lisbon-place-meta.json` (new) | 27 Lisbon rows from the 29 Sep spike |

---

### Task 1: Migration and shared types

**Files:**
- Create: `supabase/migrations/20260929000008_taste.sql`
- Modify: `scripts/import/types.ts` (ItemRow, ParkedRow; add PlaceMeta, PlaceVoteRow)

**Interfaces:**
- Produces:
  ```ts
  export interface PlaceMeta { primary_type: string | null; types: string[] | null; price_level: string | null; rating: number | null; rating_count: number | null }
  export interface ItemRow extends /* existing fields */ Partial<PlaceMeta> {}
  export interface ParkedRow extends /* existing fields */ Partial<PlaceMeta> {}
  export interface PlaceVoteRow { place_id: string; primary_type: string | null; vote: 1 | -1; voted_at: string }
  ```
  (Written as intersections in practice — see step 2.)

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260929000008_taste.sql
-- Google Place Details metadata for the owner's chosen places (spec 2026-09-29 taste profile).
-- Nullable everywhere: content imported before this migration simply has none.
alter table items add column if not exists primary_type text;
alter table items add column if not exists types text[];
alter table items add column if not exists price_level text;
alter table items add column if not exists rating numeric;
alter table items add column if not exists rating_count integer;

alter table parked_venues add column if not exists primary_type text;
alter table parked_venues add column if not exists types text[];
alter table parked_venues add column if not exists price_level text;
alter table parked_venues add column if not exists rating numeric;
alter table parked_venues add column if not exists rating_count integer;

-- Details is billed per call, so the answer is kept beside the geocode it belongs to.
alter table geocode_cache add column if not exists primary_type text;
alter table geocode_cache add column if not exists types text[];
alter table geocode_cache add column if not exists price_level text;
alter table geocode_cache add column if not exists rating numeric;
alter table geocode_cache add column if not exists rating_count integer;
alter table geocode_cache add column if not exists meta_fetched_at timestamptz;

-- One vote per Google place: +1 (saved to notes) or -1 (Not for us). Last vote wins.
create table if not exists place_votes (
  place_id text primary key,
  owner uuid not null default auth.uid(),
  primary_type text,
  vote smallint not null check (vote in (-1, 1)),
  voted_at timestamptz not null default now()
);
alter table place_votes enable row level security;
create policy owner_all on place_votes for all using (owner = auth.uid()) with check (owner = auth.uid());
```

- [ ] **Step 2: Add the types**

In `scripts/import/types.ts`, add after `ItemKind`:

```ts
/** Google Place Details fields kept for the taste profile. All nullable: older imports have none. */
export interface PlaceMeta { primary_type: string | null; types: string[] | null; price_level: string | null; rating: number | null; rating_count: number | null }
/** One owner vote on a Google place. `vote` +1 = saved to notes, -1 = "Not for us". */
export interface PlaceVoteRow { place_id: string; primary_type: string | null; vote: 1 | -1; voted_at: string }
```

Change the `ItemRow` and `ParkedRow` declarations to intersect with `Partial<PlaceMeta>`:

```ts
export interface ItemRow extends Partial<PlaceMeta> { id: string; trip: string; /* …existing fields unchanged… */ photo_credit: string | null }
export interface ParkedRow extends Partial<PlaceMeta> { trip: string; seq: number; name: string; what: string | null; why: string | null; address: string | null; lat: number | null; lng: number | null }
```

(`interface X extends Partial<PlaceMeta>` is valid TypeScript: `Partial<PlaceMeta>` is an object type with statically known members.)

- [ ] **Step 3: Type-check and run the parse tests**

Run: `npx tsc --noEmit && npx vitest run tests/import`
Expected: clean type-check; all import tests PASS (no behaviour changed).

- [ ] **Step 4: Apply the migration**

Run: `supabase db push`
Expected: `Applying migration 20260929000008_taste.sql...` then `Finished supabase db push.` Verify:

```bash
set -a; source .env; set +a
curl -s "$VITE_SUPABASE_URL/rest/v1/place_votes?select=*" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
```
Expected: `[]` (empty table, no error).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260929000008_taste.sql scripts/import/types.ts
git commit -m "feat(taste): metadata columns, place_votes table and shared types

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Importer fetches Place Details metadata

**Files:**
- Create: `scripts/import/placeMeta.ts`
- Test: `tests/import/placeMeta.test.ts`
- Modify: `scripts/import/cli.ts` (after `geocodeContent`)

**Interfaces:**
- Consumes: `Geocoder` and `GeoPoint` from `scripts/import/geocode.ts` (`GeoPoint.place_id`), `PlaceMeta`, `CityContent` from `scripts/import/types.ts`.
- Produces:
  ```ts
  export type MetaFetcher = (placeId: string) => Promise<PlaceMeta | null>
  export function makeGoogleMetaFetcher(key: string, fetchImpl?: typeof fetch): MetaFetcher
  export function makeCachedMetaFetcher(inner: MetaFetcher, cache: { get(id: string): Promise<PlaceMeta | null>; set(id: string, v: PlaceMeta): Promise<void> }): MetaFetcher
  export function supabaseMetaCache(client: SupabaseClient): { get(id: string): Promise<PlaceMeta | null>; set(id: string, v: PlaceMeta): Promise<void> }
  export async function enrichPlaceMeta(c: CityContent, geocode: Geocoder, fetchMeta: MetaFetcher, cityHint: string): Promise<{ fetched: number; missing: string[] }>
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/import/placeMeta.test.ts
import { makeGoogleMetaFetcher, makeCachedMetaFetcher, enrichPlaceMeta, supabaseMetaCache } from '../../scripts/import/placeMeta'
import type { CityContent, PlaceMeta } from '../../scripts/import/types'
import type { SupabaseClient } from '@supabase/supabase-js'

const details = { primaryType: 'cafe', types: ['cafe', 'food', 'point_of_interest'], priceLevel: 'PRICE_LEVEL_MODERATE', rating: 4.9, userRatingCount: 198 }

test('google meta fetcher GETs Place Details with the five-field mask and maps the answer', async () => {
  let captured: { url: string; init: RequestInit } | null = null
  const fetchImpl = (async (url: string, init: RequestInit) => { captured = { url, init }; return new Response(JSON.stringify(details), { status: 200 }) }) as unknown as typeof fetch
  const f = makeGoogleMetaFetcher('K', fetchImpl)
  const r = await f('ChIJabc')
  expect(captured!.url).toBe('https://places.googleapis.com/v1/places/ChIJabc')
  expect((captured!.init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe('primaryType,types,priceLevel,rating,userRatingCount')
  expect((captured!.init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('K')
  expect(r).toEqual({ primary_type: 'cafe', types: ['cafe', 'food', 'point_of_interest'], price_level: 'PRICE_LEVEL_MODERATE', rating: 4.9, rating_count: 198 })
})

test('google meta fetcher accepts an id that already carries the places/ prefix and leaves absent fields null', async () => {
  let url = ''
  const fetchImpl = (async (u: string) => { url = u; return new Response(JSON.stringify({ types: ['museum'] }), { status: 200 }) }) as unknown as typeof fetch
  const r = await makeGoogleMetaFetcher('K', fetchImpl)('places/ChIJxyz')
  expect(url).toBe('https://places.googleapis.com/v1/places/ChIJxyz')
  expect(r).toEqual({ primary_type: null, types: ['museum'], price_level: null, rating: null, rating_count: null })
})

test('google meta fetcher returns null on 404 and throws on other HTTP errors', async () => {
  const f404 = makeGoogleMetaFetcher('K', (async () => new Response('gone', { status: 404 })) as unknown as typeof fetch)
  expect(await f404('ChIJ1')).toBeNull()
  const f500 = makeGoogleMetaFetcher('K', (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch)
  await expect(f500('ChIJ1')).rejects.toThrow(/place details HTTP 500/)
})

test('cached meta fetcher hits the cache first and writes on miss', async () => {
  const store = new Map<string, PlaceMeta>()
  let calls = 0
  const inner = async () => { calls++; return { primary_type: 'cafe', types: ['cafe'], price_level: null, rating: 4.5, rating_count: 10 } }
  const f = makeCachedMetaFetcher(inner, { get: async id => store.get(id) ?? null, set: async (id, v) => { store.set(id, v) } })
  await f('a'); await f('a'); await f('b')
  expect(calls).toBe(2); expect(store.size).toBe(2)
})

test('enrichPlaceMeta fills items and parked from the geocoder place_id, skips rows without a place, reports misses', async () => {
  const geocode = async (q: string) => (q.startsWith('Miss') ? null : { lat: 1, lng: 2, formatted: q, place_id: `pid:${q}` })
  const metaFor: Record<string, PlaceMeta | null> = {
    'pid:Falta Café, R. das Fontaínhas 6, Lisboa': { primary_type: 'cafe', types: ['cafe'], price_level: null, rating: 4.9, rating_count: 198 },
    'pid:Castle, Lisboa': { primary_type: 'castle', types: ['castle'], price_level: null, rating: 4.4, rating_count: 5000 },
  }
  let fetched = 0
  const fetchMeta = async (id: string) => { fetched++; return metaFor[id] ?? null }
  const c = {
    items: [
      { kind: 'stop', place_name: 'Falta Café', address: 'R. das Fontaínhas 6', lat: 1, lng: 2 },
      { kind: 'stop', place_name: 'Miss Me', address: null, lat: null, lng: null },
      { kind: 'note', place_name: null },
      { kind: 'stop', place_name: 'Already', address: null, lat: 1, lng: 2, primary_type: 'bar', types: ['bar'], price_level: null, rating: 4, rating_count: 1 },
    ],
    parked: [{ name: 'Castle', address: null, lat: 1, lng: 2 }],
  } as unknown as CityContent
  const r = await enrichPlaceMeta(c, geocode, fetchMeta, 'Lisboa')
  expect(c.items[0]).toMatchObject({ primary_type: 'cafe', rating_count: 198 })
  expect(c.items[3]).toMatchObject({ primary_type: 'bar' })          // already had metadata: untouched
  expect(c.parked[0]).toMatchObject({ primary_type: 'castle' })
  expect(fetched).toBe(2)                                             // 'Already' and the note cost nothing
  expect(r).toEqual({ fetched: 2, missing: ['Miss Me, Lisboa'] })
})

test('supabaseMetaCache reads the geocode_cache row by place_id and upserts the five fields', async () => {
  const calls: { op: string; payload?: unknown; filter?: unknown }[] = []
  const fakeClient = {
    from: () => ({
      select: () => ({ eq: (col: string, v: string) => ({ maybeSingle: async () => { calls.push({ op: 'select', filter: [col, v] }); return { data: { primary_type: 'cafe', types: ['cafe'], price_level: null, rating: 4.5, rating_count: 20, meta_fetched_at: '2026-09-29T00:00:00Z' }, error: null } } }) }),
      update: (payload: unknown) => ({ eq: async (col: string, v: string) => { calls.push({ op: 'update', payload, filter: [col, v] }); return { error: null } } }),
    }),
  } as unknown as SupabaseClient
  const cache = supabaseMetaCache(fakeClient)
  expect(await cache.get('ChIJ1')).toEqual({ primary_type: 'cafe', types: ['cafe'], price_level: null, rating: 4.5, rating_count: 20 })
  expect(calls[0]).toEqual({ op: 'select', filter: ['place_id', 'ChIJ1'] })
  await cache.set('ChIJ1', { primary_type: 'bar', types: ['bar'], price_level: null, rating: 4, rating_count: 1 })
  expect(calls[1].op).toBe('update')
  expect(calls[1].payload).toMatchObject({ primary_type: 'bar', types: ['bar'], rating: 4, rating_count: 1 })
  expect((calls[1].payload as { meta_fetched_at: string }).meta_fetched_at).toMatch(/^\d{4}-/)
})

test('supabaseMetaCache treats a row without meta_fetched_at as a miss', async () => {
  const fakeClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { primary_type: null, types: null, price_level: null, rating: null, rating_count: null, meta_fetched_at: null }, error: null }) }) }) }) } as unknown as SupabaseClient
  expect(await supabaseMetaCache(fakeClient).get('ChIJ1')).toBeNull()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/import/placeMeta.test.ts`
Expected: FAIL — `Cannot find module '../../scripts/import/placeMeta'`.

- [ ] **Step 3: Implement `scripts/import/placeMeta.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Geocoder } from './geocode'
import type { CityContent, PlaceMeta } from './types'

export type MetaFetcher = (placeId: string) => Promise<PlaceMeta | null>

const FIELD_MASK = 'primaryType,types,priceLevel,rating,userRatingCount'

function detailsUrl(placeId: string) {
  const id = placeId.startsWith('places/') ? placeId.slice('places/'.length) : placeId
  return `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`
}

/** Place Details (New) for the five fields the taste profile needs. 404 → null (the place is gone). */
export function makeGoogleMetaFetcher(key: string, fetchImpl: typeof fetch = fetch): MetaFetcher {
  return async placeId => {
    const res = await fetchImpl(detailsUrl(placeId), { method: 'GET', headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK } })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`place details HTTP ${res.status} for "${placeId}": ${(await res.text()).slice(0, 200)}`)
    const j = await res.json() as { primaryType?: string; types?: string[]; priceLevel?: string; rating?: number; userRatingCount?: number }
    return { primary_type: j.primaryType ?? null, types: j.types ?? null, price_level: j.priceLevel ?? null, rating: j.rating ?? null, rating_count: j.userRatingCount ?? null }
  }
}

export function makeCachedMetaFetcher(inner: MetaFetcher, cache: { get(id: string): Promise<PlaceMeta | null>; set(id: string, v: PlaceMeta): Promise<void> }): MetaFetcher {
  return async id => { const hit = await cache.get(id); if (hit) return hit; const v = await inner(id); if (v) await cache.set(id, v); return v }
}

/** The metadata lives on the geocode_cache row that already holds this place_id. */
export function supabaseMetaCache(client: SupabaseClient) {
  const cols = 'primary_type,types,price_level,rating,rating_count,meta_fetched_at'
  return {
    async get(placeId: string): Promise<PlaceMeta | null> {
      const { data, error } = await client.from('geocode_cache').select(cols).eq('place_id', placeId).maybeSingle()
      if (error) { console.warn(`geocode_cache meta get failed: ${error.message}`); return null }
      if (!data || !data.meta_fetched_at) return null
      return { primary_type: data.primary_type, types: data.types, price_level: data.price_level, rating: data.rating, rating_count: data.rating_count }
    },
    async set(placeId: string, v: PlaceMeta) {
      const { error } = await client.from('geocode_cache').update({ ...v, meta_fetched_at: new Date().toISOString() }).eq('place_id', placeId)
      if (error) console.warn(`geocode_cache meta set failed: ${error.message}`)
    },
  }
}

const hasMeta = (r: Partial<PlaceMeta>) => r.primary_type != null || (r.types != null && r.types.length > 0)

/**
 * Fill the five metadata fields on every geocoded item and parked venue that lacks them.
 * Re-asks the (cached) geocoder for the place_id — a cache hit, so free — then the meta fetcher.
 */
export async function enrichPlaceMeta(c: CityContent, geocode: Geocoder, fetchMeta: MetaFetcher, cityHint: string) {
  let fetched = 0; const missing: string[] = []
  const fill = async (row: Partial<PlaceMeta>, query: string) => {
    if (hasMeta(row)) return
    const g = await geocode(query)
    if (!g) { missing.push(query); return }
    const m = await fetchMeta(g.place_id); fetched++
    if (m) Object.assign(row, m)
  }
  for (const it of c.items) if (it.place_name) await fill(it, `${it.place_name}${it.address ? ', ' + it.address : ''}, ${cityHint}`)
  for (const p of c.parked) await fill(p, `${p.name}${p.address ? ', ' + p.address : ''}, ${cityHint}`)
  return { fetched, missing: [...new Set(missing)] }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/import/placeMeta.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Wire it into the CLI**

In `scripts/import/cli.ts`, add the import at the top:

```ts
import { makeGoogleMetaFetcher, makeCachedMetaFetcher, supabaseMetaCache, enrichPlaceMeta } from './placeMeta'
```

Immediately after the line `const { misses } = await geocodeContent(content, geocoder, cityHint)`, add:

```ts
  // Taste profile metadata (spec 2026-09-29). One Place Details call per place, ever: the cache row is the geocode row.
  const metaFetcher = makeCachedMetaFetcher(makeGoogleMetaFetcher(env.googleServerKey), supabaseMetaCache(client))
  const meta = await enrichPlaceMeta(content, geocoder, metaFetcher, cityHint)
  if (meta.fetched) warnings.push(`place metadata: ${meta.fetched} Details call(s)`)
```

Also add `'meta'` to the dry-run report so a dry run shows how many rows carry metadata: in the `counts` for `dryRun`, add `meta: content.items.filter(i => i.primary_type).length + content.parked.filter(p => p.primary_type).length`.

- [ ] **Step 6: Type-check, then dry-run Lisbon**

Run: `npx tsc --noEmit && npm run import -- lisbon --dry-run --skip-maps --skip-photos`
Expected: report shows `meta` ≥ 30 and a warning `place metadata: N Details call(s)` on the first run (N ≈ 35), 0 on a second dry run (cache hit).

- [ ] **Step 7: Commit**

```bash
git add scripts/import/placeMeta.ts scripts/import/cli.ts tests/import/placeMeta.test.ts
git commit -m "feat(import): fetch and cache Place Details metadata for every stop and parked venue

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The taste module (pure)

**Files:**
- Create: `src/lib/taste.ts`, `tests/fixtures/lisbon-place-meta.json`
- Test: `tests/lib/taste.test.ts`

**Interfaces:**
- Consumes: `PlaceMeta`, `PlaceVoteRow` from `src/lib/types.ts` (re-exported from the import types); `Place` from `src/lib/places.ts` (`{ id, types, rating, ratingCount, … }`).
- Produces:
  ```ts
  export type Category = 'eat' | 'shop' | 'see'
  export interface CategoryProfile { typeWeight: Record<string, number>; countP75: number | null; minRating: number | null; n: number; thin: boolean }
  export interface TasteProfile { eat: CategoryProfile; shop: CategoryProfile; see: CategoryProfile; hidden: Set<string>; votes: number; empty: boolean }
  export function categoryOf(primaryType: string | null | undefined, types: readonly string[] | null | undefined): Category | null
  export function buildProfile(rows: readonly Partial<PlaceMeta>[], votes?: readonly PlaceVoteRow[]): TasteProfile
  export function scorePlace(place: { id: string; types: readonly string[]; primaryType?: string | null; rating: number | null; ratingCount: number | null }, profile: TasteProfile): { score: number; category: Category | null }
  export const THRESHOLD = 0.45
  ```

- [ ] **Step 1: Write the fixture**

Create `tests/fixtures/lisbon-place-meta.json` with exactly this content (27 rows from the 29 Sep spike):

```json
[{"name":"Senzi","primary_type":"breakfast_restaurant","types":["breakfast_restaurant","brunch_restaurant","coffee_shop","cafe","food_store","store","restaurant","food","point_of_interest","establishment"],"price_level":"PRICE_LEVEL_EXPENSIVE","rating":4.9,"rating_count":1855},
{"name":"Manteigaria","primary_type":"pastry_shop","types":["pastry_shop","dessert_shop","confectionery","bakery","food_store","store","food","point_of_interest","establishment"],"price_level":null,"rating":4.8,"rating_count":10923},
{"name":"Claus Porto","primary_type":"clothing_store","types":["cosmetics_store","gift_shop","clothing_store","store","service","point_of_interest","establishment"],"price_level":null,"rating":4.6,"rating_count":220},
{"name":"Carmo Archaeological Museum","primary_type":"museum","types":["historical_landmark","tourist_attraction","historical_place","history_museum","museum","point_of_interest","establishment"],"price_level":null,"rating":4.5,"rating_count":21585},
{"name":"Luvaria Ulisses","primary_type":"store","types":["store","manufacturer","point_of_interest","establishment"],"price_level":null,"rating":4.6,"rating_count":251},
{"name":"Livraria Bertrand","primary_type":"book_store","types":["book_store","store","point_of_interest","establishment"],"price_level":null,"rating":4.6,"rating_count":7926},
{"name":"A Brasileira","primary_type":"cafe","types":["cafe","coffee_shop","food_store","store","food","point_of_interest","establishment"],"price_level":"PRICE_LEVEL_MODERATE","rating":4.2,"rating_count":10535},
{"name":"A Vida Portuguesa","primary_type":"home_goods_store","types":["home_goods_store","store","service","point_of_interest","establishment"],"price_level":null,"rating":4.6,"rating_count":1172},
{"name":"Sant'Anna","primary_type":"manufacturer","types":["store","manufacturer","point_of_interest","establishment"],"price_level":null,"rating":4.1,"rating_count":99},
{"name":"Park Rooftop","primary_type":"bar","types":["bar","point_of_interest","establishment"],"price_level":"PRICE_LEVEL_MODERATE","rating":4,"rating_count":3371},
{"name":"Mesa de Frades","primary_type":"portuguese_restaurant","types":["portuguese_restaurant","european_restaurant","restaurant","food","point_of_interest","establishment"],"price_level":"PRICE_LEVEL_VERY_EXPENSIVE","rating":4.1,"rating_count":1213},
{"name":"Falta Café","primary_type":"cafe","types":["cafe","food","point_of_interest","establishment"],"price_level":"PRICE_LEVEL_MODERATE","rating":4.9,"rating_count":198},
{"name":"WISH Concept Store","primary_type":"store","types":["store","clothing_store","service","point_of_interest","establishment"],"price_level":null,"rating":4,"rating_count":406},
{"name":"Miolo","primary_type":"restaurant","types":["restaurant","food","point_of_interest","establishment"],"price_level":"PRICE_LEVEL_EXPENSIVE","rating":4.8,"rating_count":1995},
{"name":"MAAT","primary_type":"museum","types":["museum","tourist_attraction","point_of_interest","establishment"],"price_level":null,"rating":4.3,"rating_count":25856},
{"name":"Monument to the Discoveries","primary_type":"monument","types":["monument","tourist_attraction","point_of_interest","establishment"],"price_level":null,"rating":4.6,"rating_count":66260},
{"name":"Belém Tower","primary_type":"monument","types":["monument","tourist_attraction","point_of_interest","establishment"],"price_level":null,"rating":4.5,"rating_count":117345},
{"name":"Isco Casa de Petisco","primary_type":"restaurant","types":["restaurant","food","point_of_interest","establishment"],"price_level":"PRICE_LEVEL_EXPENSIVE","rating":4.8,"rating_count":553},
{"name":"Taberna Sal Grosso","primary_type":"portuguese_restaurant","types":["portuguese_restaurant","european_restaurant","bar","restaurant","food","point_of_interest","establishment"],"price_level":"PRICE_LEVEL_EXPENSIVE","rating":4.7,"rating_count":4046},
{"name":"The Folks Alfama","primary_type":"coffee_shop","types":["coffee_shop","brunch_restaurant","breakfast_restaurant","halal_restaurant","cafe","food_store","store","restaurant","food","point_of_interest","establishment"],"price_level":"PRICE_LEVEL_MODERATE","rating":4.6,"rating_count":1371},
{"name":"Alfama Doce","primary_type":"pastry_shop","types":["pastry_shop","dessert_shop","confectionery","bakery","food_store","store","food","point_of_interest","establishment"],"price_level":null,"rating":4.9,"rating_count":2233},
{"name":"Feira da Ladra","primary_type":"flea_market","types":["flea_market","market","point_of_interest","establishment"],"price_level":null,"rating":4.3,"rating_count":2366},
{"name":"National Pantheon","primary_type":"museum","types":["museum","historical_landmark","tourist_attraction","historical_place","point_of_interest","establishment"],"price_level":null,"rating":4.5,"rating_count":12779},
{"name":"Prado","primary_type":"restaurant","types":["restaurant","food","point_of_interest","establishment"],"price_level":"PRICE_LEVEL_VERY_EXPENSIVE","rating":4.3,"rating_count":1566},
{"name":"wetheknot","primary_type":"clothing_store","types":["clothing_store","store","service","point_of_interest","establishment"],"price_level":null,"rating":4.9,"rating_count":210},
{"name":"Lisbon Cathedral","primary_type":"church","types":["tourist_attraction","church","place_of_worship","association_or_organization","point_of_interest","establishment"],"price_level":null,"rating":4.4,"rating_count":36092},
{"name":"Alfama Cellar","primary_type":"restaurant","types":["restaurant","food","point_of_interest","establishment"],"price_level":"PRICE_LEVEL_EXPENSIVE","rating":4.5,"rating_count":1834}]
```

- [ ] **Step 2: Write the failing tests**

```ts
// tests/lib/taste.test.ts
import fixture from '../fixtures/lisbon-place-meta.json'
import { buildProfile, scorePlace, categoryOf, THRESHOLD, THIN_WEIGHT } from '../../src/lib/taste'
import type { PlaceMeta, PlaceVoteRow } from '../../src/lib/types'

const rows = fixture as PlaceMeta[]
const P = buildProfile(rows)
const place = (primaryType: string, types: string[], rating: number | null, ratingCount: number | null, id = 'x') => ({ id, primaryType, types, rating, ratingCount })

describe('categoryOf', () => {
  test('primary type decides first, then any listed type', () => {
    expect(categoryOf('cafe', ['cafe', 'store'])).toBe('eat')
    expect(categoryOf('store', ['store', 'clothing_store'])).toBe('shop')
    expect(categoryOf('monument', ['monument', 'tourist_attraction'])).toBe('see')
    expect(categoryOf(null, ['point_of_interest', 'establishment'])).toBeNull()
    expect(categoryOf('lodging', ['lodging'])).toBeNull()
  })
})

describe('buildProfile on the Lisbon spike rows', () => {
  test('counts 13 eat, 8 shop and 6 see places', () => {
    expect(P.eat.n).toBe(13); expect(P.shop.n).toBe(8); expect(P.see.n).toBe(6)
    expect(P.empty).toBe(false)
    expect(P.eat.thin).toBe(false); expect(P.shop.thin).toBe(false); expect(P.see.thin).toBe(false)
  })
  test('type weights saturate at three choices and ignore generic types', () => {
    expect(P.eat.typeWeight.restaurant).toBe(1)
    expect(P.eat.typeWeight.cafe).toBe(1)                       // 6 chosen cafés → capped at 1
    expect(P.eat.typeWeight.portuguese_restaurant).toBeCloseTo(2 / 3)
    expect(P.eat.typeWeight.halal_restaurant).toBeCloseTo(1 / 3)
    expect(P.eat.typeWeight.point_of_interest).toBeUndefined()
    expect(P.eat.typeWeight.store).toBeUndefined()              // a café's "store" type is not an eat type
    expect(P.shop.typeWeight.store).toBe(1)
    expect(P.shop.typeWeight.gift_shop).toBeCloseTo(1 / 3)
    expect(P.see.typeWeight.museum).toBe(1)
    expect(P.see.typeWeight.church).toBeCloseTo(1 / 3)
  })
  test('crowd band is the nearest-rank 75th percentile of review counts, rating floor the 25th percentile of ratings', () => {
    expect(P.eat.countP75).toBe(3371)
    expect(P.eat.minRating).toBe(4.3)
    expect(P.shop.countP75).toBe(1172)
    expect(P.shop.minRating).toBe(4.1)
    expect(P.see.minRating).toBeNull()
  })
  test('an empty input is an empty, all-thin profile', () => {
    const e = buildProfile([])
    expect(e.empty).toBe(true)
    expect(e.eat.thin && e.shop.thin && e.see.thin).toBe(true)
  })
})

describe('scorePlace', () => {
  const pass = (s: { score: number }) => s.score >= THRESHOLD
  test('a specialty café and a petiscos place pass', () => {
    expect(pass(scorePlace(place('cafe', ['cafe', 'food'], 4.9, 198), P))).toBe(true)
    expect(pass(scorePlace(place('restaurant', ['restaurant', 'food'], 4.8, 553), P))).toBe(true)
    expect(scorePlace(place('portuguese_restaurant', ['portuguese_restaurant', 'restaurant', 'food'], 4.6, 300), P).score).toBe(1)
  })
  test('a 4.2 café with 10,500 reviews and a 4.3 restaurant with 8,000 reviews fail', () => {
    expect(pass(scorePlace(place('cafe', ['cafe', 'coffee_shop', 'food_store', 'store'], 4.2, 10535), P))).toBe(false)
    expect(pass(scorePlace(place('restaurant', ['restaurant', 'food'], 4.3, 8000), P))).toBe(false)
  })
  test('a 4.4 café with 600 reviews passes at 0.6', () => {
    expect(scorePlace(place('cafe', ['cafe', 'food'], 4.4, 600), P).score).toBeCloseTo(0.6)
  })
  test('independent stores pass, a gift shop with 5,000 reviews fails', () => {
    expect(pass(scorePlace(place('clothing_store', ['clothing_store', 'store'], 4.9, 210), P))).toBe(true)
    expect(pass(scorePlace(place('store', ['store'], 4.5, 300), P))).toBe(true)
    expect(pass(scorePlace(place('gift_shop', ['gift_shop', 'store'], 4.3, 5000), P))).toBe(false)
  })
  test('sights ignore review counts; a monument with 117k reviews passes, a park unseen in the profile fails', () => {
    expect(scorePlace(place('monument', ['monument', 'tourist_attraction'], 4.5, 117345), P).score).toBe(1)
    expect(pass(scorePlace(place('park', ['park'], 4.6, 3000), P))).toBe(false)
  })
  test('unrated: a landmark-type sight passes at 0.5, an unrated café scores 0', () => {
    expect(scorePlace(place('church', ['church', 'place_of_worship'], null, null), P).score).toBe(0.5)
    expect(scorePlace(place('cafe', ['cafe'], null, null), P).score).toBe(0)
  })
  test('hard-avoid types and uncategorised places score 0', () => {
    expect(scorePlace(place('fast_food_restaurant', ['fast_food_restaurant', 'restaurant', 'food'], 4.6, 100), P).score).toBe(0)
    expect(scorePlace(place('lodging', ['lodging'], 4.9, 10), P)).toEqual({ score: 0, category: null })
  })
  test('votes: a down-voted id is hidden, a down-voted type is dampened, a saved type is boosted', () => {
    const votes: PlaceVoteRow[] = [
      { place_id: 'bad', primary_type: 'bar', vote: -1, voted_at: '2026-09-29T00:00:00Z' },
      { place_id: 'good', primary_type: 'gift_shop', vote: 1, voted_at: '2026-09-29T00:00:00Z' },
    ]
    const V = buildProfile(rows, votes)
    expect(V.votes).toBe(2)
    expect(scorePlace(place('bar', ['bar'], 4.8, 100, 'bad'), V).score).toBe(0)
    expect(V.eat.typeWeight.bar).toBeCloseTo((2 / 3) * 0.7)
    expect(V.shop.typeWeight.gift_shop).toBeCloseTo((1 / 3) * 1.3)
    expect(buildProfile(rows, [votes[1], votes[1], votes[1], votes[1], votes[1]]).shop.typeWeight.gift_shop).toBe(1) // (1/3)·1.3⁵ = 1.24 → capped at 1
  })
  test('thin category: any type in the category lookup counts as THIN_WEIGHT', () => {
    const T = buildProfile(rows.filter(r => r.primary_type !== 'clothing_store' && r.primary_type !== 'store' && r.primary_type !== 'manufacturer' && r.primary_type !== 'home_goods_store'))
    expect(T.shop.n).toBeLessThan(5); expect(T.shop.thin).toBe(true)
    expect(scorePlace(place('jewelry_store', ['jewelry_store', 'store'], 4.7, 80), T).score).toBeCloseTo(THIN_WEIGHT)
  })
  test('empty profile falls back to the legacy rule: rating ≥ 4.2 with ≥ 50 reviews, or an unrated landmark', () => {
    const E = buildProfile([])
    expect(scorePlace(place('cafe', ['cafe'], 4.5, 200), E).score).toBe(1)
    expect(scorePlace(place('cafe', ['cafe'], 4.0, 200), E).score).toBe(0)
    expect(scorePlace(place('cafe', ['cafe'], 4.5, 20), E).score).toBe(0)
    expect(scorePlace(place('church', ['church'], null, null), E).score).toBe(1)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/taste.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/taste'`. (`tsconfig.json` already has `resolveJsonModule: true`, so the fixture import compiles.)

- [ ] **Step 4: Implement `src/lib/taste.ts`**

```ts
import type { PlaceMeta, PlaceVoteRow } from './types'

/** Spec 2026-09-29 §2–3. Every constant here is a knob; tune from More → Diagnostics → Taste. */
export const THRESHOLD = 0.45          // a discovery needs this score for a "!"
export const TYPE_SATURATION = 3       // a type chosen this many times is fully trusted (weight 1)
export const CROWD_MULTIPLE = 3        // penalty reaches 1 at p75 + CROWD_MULTIPLE × p75 (= 4 × p75)
export const RATING_RAMP = 0.5         // rating term climbs from 0 to 1 over this many stars…
export const RATING_OFFSET = 0.2       // …starting RATING_OFFSET below the owner's floor
export const MIN_RATING_FLOOR = 4.0
export const THIN_N = 5                // fewer chosen places than this → category is "thin"
export const THIN_WEIGHT = 0.6         // affinity granted to any in-category type when thin
export const DOWNVOTE_FACTOR = 0.7
export const UPVOTE_FACTOR = 1.3

export type Category = 'eat' | 'shop' | 'see'

export const EAT_TYPES = new Set(['restaurant', 'cafe', 'coffee_shop', 'bar', 'wine_bar', 'pub', 'cocktail_bar', 'bakery', 'pastry_shop', 'dessert_shop', 'confectionery', 'ice_cream_shop', 'tea_house', 'juice_shop', 'sandwich_shop', 'deli', 'breakfast_restaurant', 'brunch_restaurant', 'portuguese_restaurant', 'spanish_restaurant', 'turkish_restaurant', 'european_restaurant', 'mediterranean_restaurant', 'seafood_restaurant', 'tapas_bar', 'vegetarian_restaurant', 'vegan_restaurant', 'halal_restaurant', 'pizza_restaurant', 'hamburger_restaurant', 'fast_food_restaurant', 'meal_takeaway', 'steak_house'])
export const SHOP_TYPES = new Set(['store', 'clothing_store', 'home_goods_store', 'book_store', 'gift_shop', 'cosmetics_store', 'manufacturer', 'flea_market', 'market', 'shopping_mall', 'jewelry_store', 'shoe_store', 'furniture_store', 'department_store', 'grocery_store', 'supermarket', 'souvenir_store', 'antique_store', 'perfume_store', 'stationery_store'])
export const SEE_TYPES = new Set(['museum', 'monument', 'church', 'tourist_attraction', 'historical_landmark', 'historical_place', 'history_museum', 'art_gallery', 'park', 'garden', 'botanical_garden', 'national_park', 'place_of_worship', 'mosque', 'synagogue', 'cultural_landmark', 'plaza', 'observation_deck', 'castle', 'palace', 'scenic_spot', 'cemetery', 'aquarium', 'zoo', 'performing_arts_theater', 'concert_hall'])
const SETS: Record<Category, Set<string>> = { eat: EAT_TYPES, shop: SHOP_TYPES, see: SEE_TYPES }
/** Never a "!", whatever the profile says. */
export const HARD_AVOID = new Set(['fast_food_restaurant', 'meal_takeaway', 'steak_house', 'night_club', 'amusement_center', 'casino'])
/** Unrated sights of these types still earn a "!" (the pre-profile rule, kept). */
const UNRATED_LANDMARKS = new Set(['tourist_attraction', 'historical_landmark', 'church', 'museum'])
const UNRATED_SEE_SCORE = 0.5

export interface CategoryProfile { typeWeight: Record<string, number>; countP75: number | null; minRating: number | null; n: number; thin: boolean }
export interface TasteProfile { eat: CategoryProfile; shop: CategoryProfile; see: CategoryProfile; hidden: Set<string>; votes: number; empty: boolean }

export function categoryOf(primaryType: string | null | undefined, types: readonly string[] | null | undefined): Category | null {
  for (const t of [primaryType, ...(types ?? [])]) {
    if (!t) continue
    for (const c of ['eat', 'shop', 'see'] as const) if (SETS[c].has(t)) return c
  }
  return null
}

/** Nearest-rank percentile: the value at ceil(q·n) in the sorted list. Stable, no interpolation. */
function nearestRank(xs: number[], q: number): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.max(0, Math.ceil(q * s.length) - 1)]
}

function buildCategory(c: Category, rows: readonly Partial<PlaceMeta>[]): CategoryProfile {
  const counts: Record<string, number> = {}
  const ratingCounts: number[] = []; const ratings: number[] = []
  for (const r of rows) {
    for (const t of new Set([r.primary_type, ...(r.types ?? [])])) if (t && SETS[c].has(t)) counts[t] = (counts[t] ?? 0) + 1
    if (r.rating_count != null) ratingCounts.push(r.rating_count)
    if (r.rating != null) ratings.push(r.rating)
  }
  const typeWeight: Record<string, number> = {}
  for (const [t, n] of Object.entries(counts)) typeWeight[t] = Math.min(1, n / TYPE_SATURATION)
  const p25 = nearestRank(ratings, 0.25)
  return {
    typeWeight,
    countP75: c === 'see' ? null : nearestRank(ratingCounts, 0.75),
    minRating: c === 'see' || p25 == null ? null : Math.max(MIN_RATING_FLOOR, p25),
    n: rows.length,
    thin: rows.length < THIN_N,
  }
}

export function buildProfile(rows: readonly Partial<PlaceMeta>[], votes: readonly PlaceVoteRow[] = []): TasteProfile {
  const by: Record<Category, Partial<PlaceMeta>[]> = { eat: [], shop: [], see: [] }
  for (const r of rows) { const c = categoryOf(r.primary_type, r.types); if (c) by[c].push(r) }
  const profile: TasteProfile = {
    eat: buildCategory('eat', by.eat), shop: buildCategory('shop', by.shop), see: buildCategory('see', by.see),
    hidden: new Set(), votes: votes.length, empty: rows.length === 0,
  }
  for (const v of votes) {
    if (v.vote < 0) profile.hidden.add(v.place_id)
    const c = categoryOf(v.primary_type, null)
    if (!c || !v.primary_type) continue
    const cat = profile[c]
    const current = cat.typeWeight[v.primary_type] ?? (cat.thin ? THIN_WEIGHT : 0)
    cat.typeWeight[v.primary_type] = Math.min(1, current * (v.vote < 0 ? DOWNVOTE_FACTOR : UPVOTE_FACTOR))
  }
  return profile
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** The rule the map used before the profile existed. Applied only when no trip has metadata yet. */
function legacyScore(p: { types: readonly string[]; rating: number | null; ratingCount: number | null }): number {
  if ((p.rating ?? 0) >= 4.2 && (p.ratingCount ?? 0) >= 50) return 1
  if (p.rating == null && p.types.some(t => UNRATED_LANDMARKS.has(t))) return 1
  return 0
}

export function scorePlace(
  place: { id: string; types: readonly string[]; primaryType?: string | null; rating: number | null; ratingCount: number | null },
  profile: TasteProfile,
): { score: number; category: Category | null } {
  const types = [place.primaryType ?? null, ...place.types].filter((t): t is string => !!t)
  const category = categoryOf(place.primaryType, place.types)
  if (profile.hidden.has(place.id)) return { score: 0, category }
  if (types.some(t => HARD_AVOID.has(t))) return { score: 0, category }
  if (profile.empty) return { score: legacyScore(place), category }
  if (!category) return { score: 0, category: null }
  const cat = profile[category]
  const weights = types.filter(t => SETS[category].has(t)).map(t => cat.typeWeight[t] ?? (cat.thin ? THIN_WEIGHT : 0))
  const affinity = weights.length ? Math.max(...weights) : 0
  if (category === 'see') {
    if (place.rating == null) return { score: types.some(t => UNRATED_LANDMARKS.has(t)) ? Math.max(affinity, UNRATED_SEE_SCORE) : affinity, category }
    return { score: affinity, category }
  }
  if (place.rating == null) return { score: 0, category }
  const minRating = cat.minRating ?? MIN_RATING_FLOOR
  const ratingTerm = clamp01((place.rating - minRating + RATING_OFFSET) / RATING_RAMP)
  const p75 = cat.countP75
  const count = place.ratingCount ?? 0
  const crowdPenalty = p75 == null || count <= p75 ? 0 : clamp01((count - p75) / (CROWD_MULTIPLE * p75))
  return { score: affinity * ratingTerm * (1 - crowdPenalty), category }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/taste.test.ts`
Expected: all PASS. If a percentile assertion differs by one rank, the fixture was edited — do not change the constants to fit; restore the fixture.

- [ ] **Step 6: Commit**

```bash
git add src/lib/taste.ts tests/lib/taste.test.ts tests/fixtures/lisbon-place-meta.json
git commit -m "feat(taste): pure profile builder and scorer with the Lisbon fixture

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Metadata for every trip reaches the app (fetch, cache, context)

**Files:**
- Modify: `src/lib/data.ts`, `src/lib/db.ts`, `src/lib/trip.tsx`
- Test: `tests/lib/data.test.ts`, `tests/lib/trip.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // data.ts
  export async function fetchAllPlaceMetaWith(c: SupabaseClient): Promise<PlaceMeta[]>
  export const fetchAllPlaceMeta: () => Promise<PlaceMeta[]>
  // db.ts
  export async function getCachedPlaceMeta(): Promise<PlaceMeta[]>
  export async function putCachedPlaceMeta(rows: PlaceMeta[]): Promise<void>
  // trip.tsx — Trip context gains:
  placeMeta: PlaceMeta[]
  ```

- [ ] **Step 1: Write the failing data test**

Open `tests/lib/data.test.ts`, look at how it builds a fake client for `fetchCityWith` (a `from(table)` recorder), and add this test in the same style. If the file's fake client cannot express two tables with different `select` strings, write a small local fake as below:

```ts
import { fetchAllPlaceMetaWith } from '../../src/lib/data'
import type { SupabaseClient } from '@supabase/supabase-js'

test('fetchAllPlaceMetaWith reads the five columns from items and parked_venues where primary_type is set, across trips', async () => {
  const calls: { table: string; select: string; filter: unknown }[] = []
  const answer = (table: string) => table === 'items'
    ? [{ primary_type: 'cafe', types: ['cafe'], price_level: null, rating: 4.9, rating_count: 198 }]
    : [{ primary_type: 'castle', types: ['castle'], price_level: null, rating: 4.4, rating_count: 5000 }]
  const client = {
    from: (table: string) => ({
      select: (select: string) => ({
        not: (col: string, op: string, v: unknown) => { calls.push({ table, select, filter: [col, op, v] }); return Promise.resolve({ data: answer(table), error: null }) },
      }),
    }),
  } as unknown as SupabaseClient
  const rows = await fetchAllPlaceMetaWith(client)
  expect(rows).toHaveLength(2)
  expect(rows[0].primary_type).toBe('cafe'); expect(rows[1].primary_type).toBe('castle')
  expect(calls.map(c => c.table).sort()).toEqual(['items', 'parked_venues'])
  for (const c of calls) { expect(c.select).toBe('primary_type,types,price_level,rating,rating_count'); expect(c.filter).toEqual(['primary_type', 'is', null]) }
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/data.test.ts`
Expected: FAIL — `fetchAllPlaceMetaWith is not a function` (or not exported).

- [ ] **Step 3: Implement the fetch and the cache**

In `src/lib/data.ts`, add `PlaceMeta` to the type import and append:

```ts
const META_COLS = 'primary_type,types,price_level,rating,rating_count'
/**
 * Metadata of every chosen place in every trip — the taste profile is one taste, not one per
 * city. A few hundred five-column rows; rides along with the trips fetch and is cached with it.
 */
export async function fetchAllPlaceMetaWith(c: SupabaseClient): Promise<PlaceMeta[]> {
  const [items, parked] = await Promise.all([
    rows<PlaceMeta>(c.from('items').select(META_COLS).not('primary_type', 'is', null), 'items meta'),
    rows<PlaceMeta>(c.from('parked_venues').select(META_COLS).not('primary_type', 'is', null), 'parked meta'),
  ])
  return [...items, ...parked]
}
export const fetchAllPlaceMeta = () => fetchAllPlaceMetaWith(supabase)
```

In `src/lib/db.ts`, add `PlaceMeta` to the type import and, next to the areas helpers:

```ts
/** Chosen-place metadata for every trip: the taste profile must exist on a cold start with no network. */
export async function getCachedPlaceMeta() { return ((await (await openDb()).get('meta', 'placeMeta')) as PlaceMeta[] | undefined) ?? [] }
export async function putCachedPlaceMeta(rows: PlaceMeta[]) { await (await openDb()).put('meta', rows, 'placeMeta') }
```

No IndexedDB version bump: the `meta` store already exists.

- [ ] **Step 4: Run the data test to verify it passes**

Run: `npx vitest run tests/lib/data.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing provider test**

Open `tests/lib/trip.test.tsx` and see how it renders `TripProvider` with a fake `client` and asserts `allAreas`. Add, in the same style:

```ts
test('TripProvider exposes placeMeta fetched with the trips, and serves the cached copy when the fetch fails', async () => {
  // Arrange a client whose items/parked_venues meta selects answer one row each, using the
  // file's existing fake-client helper; then render and read useTrip().placeMeta.
  // Expected after load: placeMeta has 2 rows, and getCachedPlaceMeta() resolves to the same 2 rows.
  // Then: a client whose meta selects reject → placeMeta equals the cached 2 rows (not []).
})
```

Fill the body with the file's helpers (the test asserts `result.current.placeMeta`), keeping the two expectations in the comments above.

- [ ] **Step 6: Implement the provider change**

In `src/lib/trip.tsx`:
- Import `fetchAllPlaceMeta, fetchAllPlaceMetaWith` from `./data` and `getCachedPlaceMeta, putCachedPlaceMeta` from `./db`; import `PlaceMeta` type.
- Add `placeMeta: PlaceMeta[]` to `interface Trip`, and to `initial` as optional `placeMeta?: PlaceMeta[]`.
- Add state `const [placeMeta, setPlaceMeta] = useState<PlaceMeta[]>(initial?.placeMeta ?? [])` and `const doFetchMeta = () => (client ? fetchAllPlaceMetaWith(client) : fetchAllPlaceMeta())`.
- Inside the trips effect, directly after the areas IIFE, add a sibling IIFE:

```ts
      // Chosen-place metadata for the taste profile: one taste across every city, cached like areas.
      void (async () => {
        try {
          const m = await doFetchMeta()
          await putCachedPlaceMeta(m)
          if (!cancelled && mounted.current) setPlaceMeta(m)
        } catch {
          const m = await getCachedPlaceMeta()
          if (!cancelled && mounted.current) setPlaceMeta(m)
        }
      })()
```

- Add `placeMeta` to `const value: Trip = { … }`.

- [ ] **Step 7: Run the provider tests and type-check**

Run: `npx tsc --noEmit && npx vitest run tests/lib/trip.test.tsx tests/lib/data.test.ts`
Expected: PASS. Any other test that constructs a `Trip` context value by hand (grep `allAreas:` under `tests/`) needs `placeMeta: []` added.

- [ ] **Step 8: Commit**

```bash
git add src/lib/data.ts src/lib/db.ts src/lib/trip.tsx tests/lib/data.test.ts tests/lib/trip.test.tsx
git commit -m "feat(taste): fetch and cache chosen-place metadata for every trip

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Votes through the outbox

**Files:**
- Modify: `src/lib/outbox.ts` (kind + payload), `src/lib/sync.ts` (replay), `src/lib/state.ts` (`usePlaceVotes`)
- Test: `tests/lib/sync.test.ts`, `tests/lib/state.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // outbox.ts
  kind: 'check_set' | 'booking_state' | 'day_notes' | 'attachment_upload' | 'place_vote'
  export type PlaceVotePayload = { placeId: string; primaryType: string | null; vote: 1 | -1 }
  // state.ts
  export function usePlaceVotes(client?: SupabaseClient): { votes: PlaceVoteRow[]; loading: boolean; vote(placeId: string, primaryType: string | null, vote: 1 | -1): Promise<WriteResult> }
  ```
  Outbox key for a vote: `` `vote:${placeId}` `` (last vote wins).

- [ ] **Step 1: Write the failing sync test**

Append to `tests/lib/sync.test.ts`, using the file's `fakeClient`, `soon()` and `Call` helpers:

```ts
test('replays a place_vote as an upsert on place_votes keyed by place_id, with the op time as voted_at', async () => {
  const calls: Call[] = []
  const op = await enqueue({ key: 'vote:ChIJ1', kind: 'place_vote', payload: { placeId: 'ChIJ1', primaryType: 'bar', vote: -1 } })
  const res = await flushOutbox(fakeClient(calls), soon(), () => true)
  expect(res).toEqual({ done: 1, remaining: 0, failed: 0 })
  expect(calls[0].table).toBe('place_votes')
  expect(calls[0].op).toBe('upsert')
  expect(calls[0].upsertOpts).toEqual({ onConflict: 'place_id' })
  expect(calls[0].payload).toEqual({ place_id: 'ChIJ1', primary_type: 'bar', vote: -1, voted_at: new Date(op.createdAt).toISOString() })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/sync.test.ts -t place_vote`
Expected: FAIL — type error on `kind: 'place_vote'` or the op is rejected as an unknown kind (`calls` empty / `failed: 1`).

- [ ] **Step 3: Implement the kind and the replay**

`src/lib/outbox.ts`: extend the union to `'check_set' | 'booking_state' | 'day_notes' | 'attachment_upload' | 'place_vote'` and add:

```ts
/** One taste vote on a Google place. +1 = saved to notes, -1 = "Not for us". Key `vote:<placeId>`, last wins. */
export type PlaceVotePayload = { placeId: string; primaryType: string | null; vote: 1 | -1 }
```

`src/lib/sync.ts`: import `PlaceVotePayload` and add to `replay()` after the `day_notes` branch:

```ts
  if (op.kind === 'place_vote') {
    const { placeId, primaryType, vote } = op.payload as PlaceVotePayload
    // voted_at is the owner's clock (op.createdAt), for the same reason day_notes uses it.
    const row = { place_id: placeId, primary_type: primaryType, vote, voted_at: new Date(op.createdAt).toISOString() }
    const { error } = (await client.from('place_votes').upsert(row, { onConflict: 'place_id' })) as { error: PgError }
    if (error) throw asError(error)
    return
  }
```

- [ ] **Step 4: Run the sync tests**

Run: `npx vitest run tests/lib/sync.test.ts`
Expected: all PASS.

- [ ] **Step 5: Write the failing hook tests**

Append to `tests/lib/state.test.ts` (it already imports `renderHook`, `act`, `waitFor`, `enqueue`, `listOutbox`; add `usePlaceVotes` to the state import and `PlaceVotePayload` to the outbox type import). Look at how `useChecks` tests build their fake client (a `from()` recorder with `select().like()` / `insert` / `delete().eq()`); the votes client needs `select('*')` resolving to rows and `upsert(row, opts)` resolving `{ error: null }`.

```ts
function votesClient(rows: unknown[], calls: { op: string; payload?: unknown; opts?: unknown }[] = [], fail = false) {
  return {
    from: (table: string) => {
      expect(table).toBe('place_votes')
      return {
        select: () => Promise.resolve({ data: rows, error: null }),
        upsert: (payload: unknown, opts: unknown) => { calls.push({ op: 'upsert', payload, opts }); return Promise.resolve(fail ? { error: { message: 'TypeError: Failed to fetch' } } : { error: null }) },
      }
    },
  } as unknown as SupabaseClient
}

test('usePlaceVotes: loads server rows, then overlays a pending outbox vote on top', async () => {
  await enqueue({ key: 'vote:ChIJ2', kind: 'place_vote', payload: { placeId: 'ChIJ2', primaryType: 'cafe', vote: -1 } satisfies PlaceVotePayload })
  const { result } = renderHook(() => usePlaceVotes(votesClient([{ place_id: 'ChIJ1', primary_type: 'bar', vote: 1, voted_at: '2026-09-29T00:00:00Z' }, { place_id: 'ChIJ2', primary_type: 'cafe', vote: 1, voted_at: '2026-09-28T00:00:00Z' }])))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const byId = Object.fromEntries(result.current.votes.map(v => [v.place_id, v.vote]))
  expect(byId).toEqual({ ChIJ1: 1, ChIJ2: -1 })          // the queued -1 beats the server's older +1
})

test('usePlaceVotes: vote() upserts with onConflict place_id and updates the list optimistically', async () => {
  const calls: { op: string; payload?: unknown; opts?: unknown }[] = []
  const { result } = renderHook(() => usePlaceVotes(votesClient([], calls)))
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => { await result.current.vote('ChIJ9', 'restaurant', -1) })
  expect(result.current.votes).toEqual([expect.objectContaining({ place_id: 'ChIJ9', primary_type: 'restaurant', vote: -1 })])
  expect(calls[0].opts).toEqual({ onConflict: 'place_id' })
  expect(calls[0].payload).toMatchObject({ place_id: 'ChIJ9', primary_type: 'restaurant', vote: -1 })
  expect(await listOutbox()).toEqual([])
})

test('usePlaceVotes: a network failure queues the vote and keeps it in the list', async () => {
  const { result } = renderHook(() => usePlaceVotes(votesClient([], [], true)))
  await waitFor(() => expect(result.current.loading).toBe(false))
  let r: { queued: boolean } | undefined
  await act(async () => { r = await result.current.vote('ChIJ9', 'bar', 1) })
  expect(r).toEqual({ queued: true })
  expect(result.current.votes.map(v => v.place_id)).toEqual(['ChIJ9'])
  const ops = await listOutbox()
  expect(ops).toHaveLength(1); expect(ops[0].kind).toBe('place_vote'); expect(ops[0].key).toBe('vote:ChIJ9')
})
```

(`isNetworkFailure` in `src/lib/net.ts` matches messages against `/\bfetch\b|\bnetwork\b|Failed to fetch|NetworkError|\bload failed\b/i`, so `TypeError: Failed to fetch` is classified as a network failure.)

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run tests/lib/state.test.ts -t usePlaceVotes`
Expected: FAIL — `usePlaceVotes` is not exported.

- [ ] **Step 7: Implement `usePlaceVotes` in `src/lib/state.ts`**

Add `PlaceVotePayload` to the outbox type import and `PlaceVoteRow` from `./types`. Append:

```ts
/**
 * Taste votes on Google places (spec 2026-09-29 §4). Same shape as useChecks: server rows first,
 * pending outbox votes on top, so a "Not for us" tapped with no signal counts at once and survives a relaunch.
 */
export function usePlaceVotes(client: SupabaseClient = supabase) {
  const [votes, setVotes] = useState<PlaceVoteRow[]>([])
  const votesRef = useRef<PlaceVoteRow[]>([])
  const [loading, setLoading] = useState(true)

  const commit = (next: PlaceVoteRow[]) => { votesRef.current = next; setVotes(next) }
  const upsertLocal = (list: PlaceVoteRow[], row: PlaceVoteRow) => [...list.filter(v => v.place_id !== row.place_id), row]

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const { data, error } = await client.from('place_votes').select('*')
        if (cancelled) return
        if (error) console.warn(message(error))
        let next: PlaceVoteRow[] = error ? [...votesRef.current] : ((data ?? []) as PlaceVoteRow[])
        for (const op of await listOutbox()) {
          if (op.kind !== 'place_vote') continue
          const p = op.payload as PlaceVotePayload
          next = upsertLocal(next, { place_id: p.placeId, primary_type: p.primaryType, vote: p.vote, voted_at: new Date(op.createdAt).toISOString() })
        }
        if (cancelled) return
        commit(next)
      } catch (e) {
        console.warn(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [client])

  async function vote(placeId: string, primaryType: string | null, v: 1 | -1): Promise<WriteResult> {
    const startedAt = Date.now()
    const row: PlaceVoteRow = { place_id: placeId, primary_type: primaryType, vote: v, voted_at: new Date(startedAt).toISOString() }
    commit(upsertLocal(votesRef.current, row))
    const payload: PlaceVotePayload = { placeId, primaryType, vote: v }
    const enqueueIt = () => queue({ key: `vote:${placeId}`, kind: 'place_vote', payload })
    if (!isOnline()) return enqueueIt()
    const outcome = await runWrite(() => client.from('place_votes').upsert(row, { onConflict: 'place_id' }) as PromiseLike<{ error: unknown }>)
    if (outcome.ok) { await settle(client, `vote:${placeId}`, startedAt); return { queued: false } }
    if (outcome.network) return enqueueIt()
    console.warn(outcome.error.message)
    throw new Error(outcome.error.message)
  }

  return { votes, loading, vote }
}
```

- [ ] **Step 8: Run the state tests and type-check**

Run: `npx tsc --noEmit && npx vitest run tests/lib/state.test.ts tests/lib/sync.test.ts`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/outbox.ts src/lib/sync.ts src/lib/state.ts tests/lib/sync.test.ts tests/lib/state.test.ts
git commit -m "feat(taste): place votes through the outbox with a usePlaceVotes hook

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The nearby search keeps places by taste score

**Files:**
- Modify: `src/lib/places.ts`
- Test: `tests/lib/places.test.ts`

**Interfaces:**
- Consumes: `TasteProfile`, `scorePlace`, `THRESHOLD`, `buildProfile` from `./taste`.
- Produces:
  ```ts
  export interface Place { …existing…; primaryType: string | null }
  export const INCLUDED_TYPES: string[]   // widened (see step 3)
  export async function nearbyPlaces(lat: number, lng: number, key: string, fetchImpl?: typeof fetch, profile?: TasteProfile): Promise<Place[]>
  ```
  With `profile` omitted, `nearbyPlaces` behaves exactly as before (legacy rule via an empty profile).

- [ ] **Step 1: Write the failing tests**

In `tests/lib/places.test.ts`, add `buildProfile` import from `../../src/lib/taste` and the fixture import `import fixture from '../fixtures/lisbon-place-meta.json'`. Add:

```ts
describe('nearbyPlaces with a taste profile', () => {
  const profile = buildProfile(fixture as never)
  const respond = (places: unknown[]) => vi.fn(async () => new Response(JSON.stringify({ places }), { status: 200 })) as unknown as typeof fetch

  test('the request asks for restaurants, bars and shops too, and for primaryType', async () => {
    let body: { includedTypes: string[] } | null = null
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => { body = JSON.parse(init.body as string); return new Response(JSON.stringify({ places: [] }), { status: 200 }) }) as unknown as typeof fetch
    await nearbyPlaces(38.71, -9.14, 'k', fetchImpl, profile)
    for (const t of ['restaurant', 'bar', 'coffee_shop', 'market', 'clothing_store', 'home_goods_store', 'cafe', 'museum']) expect(body!.includedTypes).toContain(t)
    expect(body!.includedTypes).not.toContain('shopping_mall')
    const mask = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(mask['X-Goog-FieldMask']).toContain('places.primaryType')
  })

  test('keeps a tasca and drops a tourist-square restaurant and a 10k-review café', async () => {
    const places = await nearbyPlaces(38.71, -9.14, 'k', respond([
      rawPlace({ id: 'tasca', primaryType: 'portuguese_restaurant', types: ['portuguese_restaurant', 'restaurant', 'food'], rating: 4.6, userRatingCount: 300 }),
      rawPlace({ id: 'trap', primaryType: 'restaurant', types: ['restaurant', 'food'], rating: 4.3, userRatingCount: 8000 }),
      rawPlace({ id: 'brasileira', primaryType: 'cafe', types: ['cafe', 'coffee_shop'], rating: 4.2, userRatingCount: 10535 }),
    ]), profile)
    expect(places.map(p => p.id)).toEqual(['tasca'])
    expect(places[0].primaryType).toBe('portuguese_restaurant')
  })

  test('without a profile the legacy rule still applies', async () => {
    const places = await nearbyPlaces(38.71, -9.14, 'k', respond([
      rawPlace({ id: 'ok', rating: 4.5, userRatingCount: 200 }),
      rawPlace({ id: 'low', rating: 4.0, userRatingCount: 200 }),
    ]))
    expect(places.map(p => p.id)).toEqual(['ok'])
  })
})
```

Update the existing test `'POSTs searchNearby with the documented headers and body'` only if it pins the full field mask string; it should now include `places.primaryType`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/places.test.ts`
Expected: the three new tests FAIL (includedTypes lacks `restaurant`; `primaryType` undefined; the tasca is dropped because the old `keep()` ignores the profile).

- [ ] **Step 3: Implement**

In `src/lib/places.ts`:

```ts
import { buildProfile, scorePlace, THRESHOLD, type TasteProfile } from './taste'

export interface Place { id: string; name: string; lat: number; lng: number; rating: number | null; ratingCount: number | null; openNow: boolean | null; types: string[]; primaryType: string | null; photoName: string | null; address: string | null }

// Places API (New) Table A types only. Widened 29 Sep 2026: the taste profile now decides what
// earns a "!", so restaurants, bars and shops are searched for at all.
export const INCLUDED_TYPES = [
  'tourist_attraction', 'historical_landmark', 'museum', 'art_gallery', 'church', 'park',
  'cafe', 'coffee_shop', 'bakery', 'restaurant', 'bar',
  'book_store', 'gift_shop', 'clothing_store', 'home_goods_store', 'market',
]
```

Add `'places.primaryType'` to `FIELD_MASK`; add `primaryType?: string` to `RawPlace`; set `primaryType: p.primaryType ?? null` in `mapPlace`. Replace `keep()` and its use:

```ts
const EMPTY_PROFILE = buildProfile([])
function keepByTaste(p: Place, profile: TasteProfile): boolean {
  return scorePlace({ id: p.id, types: p.types, primaryType: p.primaryType, rating: p.rating, ratingCount: p.ratingCount }, profile).score >= THRESHOLD
}

export async function nearbyPlaces(lat: number, lng: number, key: string, fetchImpl: typeof fetch = fetch, profile: TasteProfile = EMPTY_PROFILE): Promise<Place[]> {
  … (request unchanged) …
  return (json.places ?? []).map(mapPlace).filter(p => keepByTaste(p, profile))
}
```

Delete `UNRATED_KEEP_TYPES` and `keep()` from `places.ts` (the legacy rule now lives in `taste.ts` as `legacyScore`).

- [ ] **Step 4: Run the tests**

Run: `npx tsc --noEmit && npx vitest run tests/lib/places.test.ts tests/lib/taste.test.ts`
Expected: all PASS, including the two pre-existing `keep` tests (`'keeps a rated cafe…'`, `'drops a rated place below the 50-review floor'`), which exercise the legacy path.

- [ ] **Step 5: Commit**

```bash
git add src/lib/places.ts tests/lib/places.test.ts
git commit -m "feat(taste): nearby search keeps discoveries by taste score and searches restaurants and shops

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Map wiring and the "Not for us" button

**Files:**
- Modify: `src/components/MapSheet.tsx`, `src/screens/Map.tsx`
- Test: `tests/app/MapSheet.test.tsx` (new file; `tests/app/` is where the existing component/screen tests live — there is no `tests/components/`)

**Interfaces:**
- Consumes: `useTrip().placeMeta`, `usePlaceVotes()`, `buildProfile`, `nearbyPlaces(…, profile)`.
- Produces on `MapSheetProps`: `onReject?: () => void` (renders the `Not for us` button for `kind === 'place'`).

- [ ] **Step 1: Write the failing sheet test**

```tsx
// tests/app/MapSheet.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MapSheet } from '../../src/components/MapSheet'

const base = { open: true, title: 'Tasca X', subtitle: null, details: null, walkHref: null, onClose: () => {} }

test('a place sheet shows "Not for us" and calls onReject', () => {
  const onReject = vi.fn()
  render(<MemoryRouter><MapSheet {...base} kind="place" onSave={() => {}} onReject={onReject} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Not for us' }))
  expect(onReject).toHaveBeenCalledTimes(1)
})

test('a stop sheet has no "Not for us" button', () => {
  render(<MemoryRouter><MapSheet {...base} kind="stop" onReject={() => {}} /></MemoryRouter>)
  expect(screen.queryByRole('button', { name: 'Not for us' })).toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/app/MapSheet.test.tsx`
Expected: FAIL — no button named `Not for us` (and a TS error on `onReject` if the file type-checks in the run).

- [ ] **Step 3: Implement the sheet button**

In `MapSheetProps` add:

```ts
  /** Places only: records a "Not for us" vote and hides the marker. */
  onReject?: () => void
```

Destructure `onReject` and render, directly after the Save button block:

```tsx
      {kind === 'place' && onReject && (
        <button type="button" className="btn btn--text" onClick={onReject}>Not for us</button>
      )}
```

- [ ] **Step 4: Run the sheet test**

Run: `npx vitest run tests/app/MapSheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the profile and the vote into `Map.tsx`**

Imports: add `usePlaceVotes` to the `../lib/state` import; add `import { buildProfile } from '../lib/taste'`.

Near `const { done } = useChecks(slug)` add:

```ts
  const { placeMeta } = useTrip()   // already destructured as `content` above — extend that destructure instead of calling useTrip twice
  const placeVotes = usePlaceVotes()
  // One taste across every city (spec 2026-09-29): chosen-place metadata plus the owner's votes.
  const tasteProfile = useMemo(() => buildProfile(placeMeta, placeVotes.votes), [placeMeta, placeVotes.votes])
```

(Concretely: change the existing `const { content } = useTrip()` to `const { content, placeMeta } = useTrip()`.)

In the places fetch effect, pass the profile: `nearbyPlaces(position.lat, position.lng, placesKey, undefined, tasteProfile)` and add `tasteProfile` to that effect's dependency array. Because a profile change (a vote) must not by itself trigger a refetch, keep `shouldRefetch` as the gate — it already returns early when position and time have not moved.

Add a hide-and-vote handler next to `handleSave`:

```ts
  async function handleReject() {
    if (!sheet?.place) return
    const place = placesRef.current.get(sheet.place.id)
    // Hide first: the marker must vanish on the tap, whatever the network does.
    placesRef.current.delete(sheet.place.id)
    const m = mapRef.current
    if (m && position) setData(m, 'places', placesGeoJSON(nearestN([...placesRef.current.values()], position.lat, position.lng)))
    setSelected(null); setSaveError(null); setSaveQueued(null)
    try { await placeVotes.vote(sheet.place.id, place?.primaryType ?? null, -1) }
    catch (e) { console.warn('reject place', e instanceof Error ? e.message : String(e)) }
  }
```

In `handleSave`, after a successful `notes.savePlace(...)`, add the positive vote (fire-and-forget, never blocks the save):

```ts
      const saved = placesRef.current.get(sheet.place.id)
      void placeVotes.vote(sheet.place.id, saved?.primaryType ?? null, 1).catch(() => {})
```

In the `<MapSheet …/>` element add `onReject={sheet.place ? () => { void handleReject() } : undefined}`.

The hidden set must also apply to places already in the session cache when a vote lands: in the effect that sets the places layer after a fetch (`.then(found => …)`), filter with `tasteProfile.hidden`:

```ts
        const all = nearestN([...placesRef.current.values()].filter(p => !tasteProfile.hidden.has(p.id)), position.lat, position.lng)
```

- [ ] **Step 6: Type-check and run the whole suite**

Run: `npx tsc --noEmit && npm test`
Expected: all PASS. If a Map test renders `TripProvider` with an `initial` value, add `placeMeta: []` there.

- [ ] **Step 7: Commit**

```bash
git add src/components/MapSheet.tsx src/screens/Map.tsx tests/app/MapSheet.test.tsx
git commit -m "feat(taste): map filters discoveries by the taste profile; \"Not for us\" votes from the sheet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Diagnostics "Taste" block

**Files:**
- Modify: `src/screens/More.tsx`
- Test: `tests/lib/taste.test.ts` (the pure formatter; there is no More screen test to extend).

**Interfaces:**
- Produces in `src/lib/taste.ts`: `export function summariseProfile(p: TasteProfile): string[]` — one line per category plus a votes line, e.g. `eat · 13 places · top: restaurant, cafe, coffee_shop, portuguese_restaurant, pastry_shop · reviews ≤ 3,371 · rating ≥ 4.3`.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/lib/taste.test.ts
import { summariseProfile } from '../../src/lib/taste'
test('summariseProfile prints one line per category and the vote count', () => {
  const lines = summariseProfile(P)
  expect(lines).toHaveLength(4)
  // weight desc, then alphabetical: the three weight-1 types first, then the first two of the 2/3-weight types
  expect(lines[0]).toBe('eat · 13 places · top: cafe, coffee_shop, restaurant, bakery, bar · reviews ≤ 3,371 · rating ≥ 4.3')
  expect(lines[2]).toMatch(/^see · 6 places · top: museum, tourist_attraction/)
  expect(lines[3]).toBe('votes · 0')
  expect(summariseProfile(buildProfile([]))[0]).toBe('eat · 0 places · thin — using the pre-profile rule')
})
```

(Top types are sorted by weight descending, then alphabetically, first five.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/taste.test.ts -t summariseProfile`
Expected: FAIL — `summariseProfile` is not exported.

- [ ] **Step 3: Implement the formatter**

Append to `src/lib/taste.ts`:

```ts
/** What the profile learned, one line per category, for More → Diagnostics. */
export function summariseProfile(p: TasteProfile): string[] {
  const line = (c: Category) => {
    const cat = p[c]
    if (cat.n === 0) return `${c} · 0 places · thin — using the pre-profile rule`
    const top = Object.entries(cat.typeWeight).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([t]) => t).join(', ')
    const parts = [`${c} · ${cat.n} places${cat.thin ? ' (thin)' : ''}`, `top: ${top}`]
    if (cat.countP75 != null) parts.push(`reviews ≤ ${cat.countP75.toLocaleString('en-GB')}`)
    if (cat.minRating != null) parts.push(`rating ≥ ${cat.minRating}`)
    return parts.join(' · ')
  }
  return [line('eat'), line('shop'), line('see'), `votes · ${p.votes}`]
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/lib/taste.test.ts`
Expected: PASS.

- [ ] **Step 5: Render it in More**

In `src/screens/More.tsx`: extend the `useTrip()` destructure with `placeMeta`; import `usePlaceVotes` from `../lib/state` and `buildProfile, summariseProfile` from `../lib/taste`; add

```ts
  const placeVotes = usePlaceVotes()
  const tasteLines = useMemo(() => summariseProfile(buildProfile(placeMeta, placeVotes.votes)), [placeMeta, placeVotes.votes])
```

and, directly before the Diagnostics `<section>`, a new section:

```tsx
      {/* What the map's "!" filter learned from the itineraries and the owner's votes (spec 2026-09-29). */}
      <section className="more-section">
        <h2 className="h5 more-section__heading">Taste</h2>
        <pre className="more-diag">{tasteLines.join('\n')}</pre>
      </section>
```

- [ ] **Step 6: Type-check and run the suite**

Run: `npx tsc --noEmit && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/taste.ts src/screens/More.tsx tests/lib/taste.test.ts
git commit -m "feat(taste): Diagnostics shows what the profile learned

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Re-import Lisbon, verify live, open the PR

**Files:** none in the repo (content is gitignored). Backup dir: `content/_handoff/pre-import-backup-2026-09-29-lisbon-c/`.

- [ ] **Step 1: Back up and re-import Lisbon**

```bash
mkdir -p content/_handoff/pre-import-backup-2026-09-29-lisbon-c && cp content/lisbon/*.md content/_handoff/pre-import-backup-2026-09-29-lisbon-c/
npm run import -- lisbon --skip-maps --skip-photos
```
Expected: report with `items 86`, `alerts 42`, `areas 1`, and a warning `place metadata: N Details call(s)` (N ≈ 35 on the first run).

- [ ] **Step 2: Verify the columns landed**

```bash
set -a; source .env; set +a
curl -s "$VITE_SUPABASE_URL/rest/v1/items?select=place_name,primary_type,rating,rating_count&trip=eq.lisbon&primary_type=not.is.null&limit=5" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
curl -s "$VITE_SUPABASE_URL/rest/v1/items?select=id&trip=eq.lisbon&primary_type=not.is.null" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" -H "Prefer: count=exact" -o /dev/null -w '%header{content-range}\n'
```
Expected: five rows with types and counts; a content-range total ≥ 30.

- [ ] **Step 3: Build and check the map locally**

```bash
npm run build && npx vite preview --port 4173
```
Open `http://localhost:4173/europe-guide/?trip=lisbon`, sign in, go to More → confirm the Taste block reads `eat · N places …` with N ≥ 13. Open the Map, allow location (or use the browser's sensor override to place yourself at Portas do Sol, 38.7119, -9.1300), toggle discoveries on. Expected: "!" on tascas and cafés in the lanes, none on the terrace restaurants on the square. Tap one, tap `Not for us`: the marker disappears at once; More → Taste shows `votes · 1`.

- [ ] **Step 4: Offline check of the vote**

In DevTools set Network → Offline, tap `Not for us` on another place, reload the page: the marker stays hidden and More shows `Pending changes 1`. Go online: the badge clears and `place_votes` has two rows:

```bash
curl -s "$VITE_SUPABASE_URL/rest/v1/place_votes?select=place_id,primary_type,vote" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
```

- [ ] **Step 5: Re-import the other cities** (each with a backup as in step 1; `--skip-maps --skip-photos`):

```bash
for c in seville barcelona istanbul cappadocia; do npm run import -- $c --dry-run --skip-maps --skip-photos | tail -15; done
```
Read each dry run for parse errors first (Barcelona's md carries a hand edit; see the project notes), then run without `--dry-run`. Expected: More → Taste `eat` count rises well above 13.

- [ ] **Step 6: Open the PR**

```bash
git push -u origin feat/taste-profile
gh pr create --title "Taste profile for the map's \"!\" discoveries" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-09-29-taste-profile-design.md.

- Importer stores Google Place Details metadata per stop and parked venue (cached on geocode_cache).
- src/lib/taste.ts builds an eat/shop/see profile from every trip's chosen places and scores nearby discoveries; below THRESHOLD there is no "!".
- "Not for us" on the place sheet records a vote through the outbox; saves count as +1.
- More → Diagnostics shows what the profile learned.
- Migration 20260929000008_taste.sql applied; Lisbon re-imported.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then follow `superpowers:finishing-a-development-branch`.

---

## Self-review notes (done while writing)

- Spec §1 → Task 1 + 2. §2 → Task 3 + 4. §3 → Task 3 + 6. §4 → Task 5 + 7. §5 → Task 3 (`legacyScore`, `THIN_WEIGHT`) and Task 6 (default empty profile). §6 → Task 8. Rollout → Task 9.
- The spec draft's formulas were tightened after simulating them on the fixture (saturating weights instead of share-of-max, p75 instead of p90, rating ramp with an offset, unrated-sight floor of 0.5). The spec is amended in the same commit as this plan so the two agree.
- Names used across tasks: `buildProfile`, `scorePlace`, `categoryOf`, `summariseProfile`, `THRESHOLD`, `THIN_WEIGHT`, `TasteProfile`, `PlaceMeta`, `PlaceVoteRow`, `PlaceVotePayload`, `usePlaceVotes` (`votes`, `loading`, `vote()`), `fetchAllPlaceMeta(With)`, `getCachedPlaceMeta`/`putCachedPlaceMeta`, `placeMeta` on the Trip context, `Place.primaryType`, `onReject`. Each is defined in exactly one task and consumed by name afterwards.
