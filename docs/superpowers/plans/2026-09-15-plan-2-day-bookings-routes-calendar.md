# Europe Guide — Plan 2: Data layer, Day, Bookings, Routes, Calendar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the authenticated shell into a usable trip companion: a Day screen with "now and next", done ticks and Walk-there links; a Bookings screen with status, confirmation details and PDF attachments in private storage; a Routes screen; a per-city calendar export; and a real More screen. All reads work offline from an IndexedDB mirror.

**Architecture:** A `TripProvider` loads one city's content (all ten content tables) from Supabase into memory and mirrors it in IndexedDB via `idb`; on failure or offline it serves the mirror. Screens are pure functions of `content` plus small `state` hooks (item checks, booking state, attachments) that write straight to Supabase (write queue arrives in Plan 4). Time logic lives in one module keyed on the trip's IANA timezone. Google Maps deep links are built by one helper. The `.ics` export is generated client-side from the alerts table.

**Tech Stack:** as Plan 1 plus `idb@8`, dev `fake-indexeddb@6`. No UI library; styling continues in `src/styles/base.css` using the Figma tokens.

**Spec:** `docs/superpowers/specs/2026-09-14-europe-guide-design.md` (§4 Day, Bookings, Routes, More; §6; §7 reads; §8)

## Global Constraints

- Everything reads through `useTrip()`; no screen calls Supabase for content directly. State writes go through `src/lib/state.ts` only.
- All times are interpreted in `trip.timezone`. Never use the device's local date for "today".
- "Walk there" links: `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>&travelmode=walking` when coordinates exist, else `destination=<encodeURIComponent(name[, address], trip.name)>`. Whole-route links use the stored `google_url` unchanged.
- Storage paths: `tickets/<owner uuid>/<trip>/<booking_id>/<safe filename>`; open via signed URL (3600 s); accept `application/pdf` and `image/*`, max 25 MB.
- Tokens: bg `#202123`, card `#252525`, card-alt `#2a2c2f`, border `#434445`, accent `#11DA8F`, salmon `#FF7262`, banana `#FBDD40`, columbia `#9EE1FE`, coral `#F8C1B8`, text white; radii 8/12/17; safe-area padding via `.screen`.
- Tests use `tests/fixtures/valle/*` parsed through `assembleCity` (no network) and mocked Supabase; `fake-indexeddb/auto` for IDB.
- Deferred Plan 1 note: the real Lisbon file has 12 routes but only 1 `route_link` item; the Day screen must show routes by `routes.date` (and legs), not rely on `route_link` items.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never commit `content/` or `.env`.

## File structure

```
src/
├── lib/
│   ├── db.ts            idb schema: stores per content table + meta; getCity(slug)/putCity(content)
│   ├── data.ts          fetchCityFromSupabase(slug), listTrips(); merge into CityContent
│   ├── trip.tsx         TripProvider + useTrip(); active slug from ?trip= or localStorage
│   ├── time.ts          nowInTz, todayInTz, minutesOf, currentBlock, currentAndNext, fmtTime, fmtDay
│   ├── links.ts         walkLink(item | leg endpoint | parked), routeLink(route)
│   ├── state.ts         useChecks, toggleCheck, useBookingState, saveBookingState, useAttachments, uploadAttachment, attachmentUrl
│   └── ics.ts           buildIcs(trip, alerts) → string; downloadIcs(filename, text)
├── components/
│   ├── Md.tsx           inline markdown: **bold**, [text](url), line breaks
│   ├── Pill.tsx         status/priority pill
│   ├── Sheet.tsx        bottom sheet (dialog) with close
│   ├── NowNext.tsx      banner: current alert, next alert + countdown
│   ├── StopCard.tsx     one item: time, plan, details, tick, Walk there, options
│   ├── RouteStrip.tsx   routes for a date/block: title, distance, whole-route link
│   └── TripPicker.tsx   pills for trips
├── screens/
│   ├── Day.tsx          /day and /day/:date
│   ├── Bookings.tsx     /bookings (+ BookingSheet)
│   ├── Routes.tsx       /routes
│   └── More.tsx         parked venues, standing notes, calendar export, routes link, sign out
└── styles/base.css      + card, pill, sheet, list styles
tests/
├── helpers/content.ts   loadValle(): CityContent via assembleCity('tests/fixtures/valle','valle')
├── helpers/supabaseMock.ts
├── lib/*.test.ts        db, data, trip, time, links, state, ics
└── app/*.test.tsx       Day, Bookings, Routes, More
```

---

### Task 1: IndexedDB mirror and Supabase content fetch

**Files:**
- Create: `src/lib/db.ts`, `src/lib/data.ts`, `tests/helpers/content.ts`, `tests/helpers/supabaseMock.ts`, `tests/lib/db.test.ts`, `tests/lib/data.test.ts`
- Modify: `package.json` (deps), `tests/setup.ts` (add `import 'fake-indexeddb/auto'`)

**Interfaces:**
- Consumes: `CityContent`, row types from `src/lib/types.ts`; `supabase` client.
- Produces:
  - `openDb(): Promise<IDBPDatabase>` (name `europe-guide`, version 1; object stores: `content` keyed by slug storing a whole `CityContent`, `meta` keyed by string).
  - `getCachedCity(slug): Promise<CityContent | null>`, `putCachedCity(content): Promise<void>`, `getCachedTrips(): Promise<TripRow[]>`, `putCachedTrips(trips)`.
  - `fetchCity(slug): Promise<CityContent>` — ten parallel selects filtered by `trip = slug` (trips by `slug`), ordered (`items` by `date,sort`; `alerts` by `date,seq`; `legs` by `route_id,seq`; `routes`,`bookings`,`parked`,`notes`,`areas` by `sort`/`seq`), throws on any error with the table name.
  - `fetchTrips(): Promise<TripRow[]>` ordered by `sort, start_date`.
  - Test helper `loadValle(): Promise<CityContent>`.
  - Test helper `mockSupabaseContent(content: CityContent)` returning a fake client whose `from(table).select(...).eq(...).order(...)` resolves the right rows (chainable; every method returns the same thenable).

- [ ] **Step 1: Install**
```bash
npm i idb@8 && npm i -D fake-indexeddb@6
```
Add `import 'fake-indexeddb/auto'` as the first line of `tests/setup.ts`.

- [ ] **Step 2: Failing tests**

`tests/helpers/content.ts`:
```ts
import { assembleCity } from '../../scripts/import/write'
import type { CityContent } from '../../src/lib/types'
let cache: CityContent | null = null
export async function loadValle(): Promise<CityContent> {
  if (!cache) cache = (await assembleCity('tests/fixtures/valle', 'valle')).content
  return structuredClone(cache)
}
```
`tests/helpers/supabaseMock.ts`:
```ts
import type { CityContent } from '../../src/lib/types'
type Row = Record<string, unknown>
const TABLE: Record<string, keyof CityContent> = { trips: 'trip', days: 'days', items: 'items', bookings: 'bookings', routes: 'routes', legs: 'legs', alerts: 'alerts', parked_venues: 'parked', standing_notes: 'notes', offline_areas: 'areas' }
export function mockSupabaseContent(content: CityContent, opts: { failTable?: string } = {}) {
  const calls: string[] = []
  function query(table: string) {
    let rows: Row[] = table === 'trips' ? [content.trip as unknown as Row] : (content[TABLE[table]] as unknown as Row[]) ?? []
    const q: Record<string, unknown> = {
      select() { return q }, order() { return q }, limit() { return q },
      eq(col: string, val: unknown) { rows = rows.filter(r => r[col] === val); return q },
      then(res: (v: { data: Row[] | null; error: { message: string } | null }) => void) {
        calls.push(table)
        res(opts.failTable === table ? { data: null, error: { message: `boom ${table}` } } : { data: rows, error: null })
      },
    }
    return q
  }
  return { client: { from: query } as never, calls }
}
```
`tests/lib/db.test.ts`:
```ts
import { getCachedCity, putCachedCity, getCachedTrips, putCachedTrips } from '../../src/lib/db'
import { loadValle } from '../helpers/content'
test('round-trips a city through IndexedDB', async () => {
  const c = await loadValle()
  expect(await getCachedCity('valle')).toBeNull()
  await putCachedCity(c)
  const back = await getCachedCity('valle')
  expect(back?.trip.slug).toBe('valle'); expect(back?.items.length).toBe(c.items.length)
})
test('round-trips the trip list', async () => {
  const c = await loadValle()
  await putCachedTrips([c.trip]); expect((await getCachedTrips()).map(t => t.slug)).toEqual(['valle'])
})
```
`tests/lib/data.test.ts`:
```ts
import { vi } from 'vitest'
import { loadValle } from '../helpers/content'
import { mockSupabaseContent } from '../helpers/supabaseMock'
const content = await loadValle()
const mock = mockSupabaseContent(content)
vi.mock('../../src/lib/supabase', () => ({ supabase: mock.client }))
import { fetchCity, fetchTrips } from '../../src/lib/data'
test('fetchCity assembles all ten tables for a slug', async () => {
  const c = await fetchCity('valle')
  expect(c.trip.slug).toBe('valle'); expect(c.days.length).toBe(content.days.length); expect(c.items.length).toBe(content.items.length)
  expect(c.legs.length).toBe(content.legs.length); expect(c.alerts.length).toBe(content.alerts.length)
  expect(new Set(mock.calls)).toEqual(new Set(['trips','days','items','bookings','routes','legs','alerts','parked_venues','standing_notes','offline_areas']))
})
test('fetchTrips returns trips', async () => { expect((await fetchTrips()).map(t => t.slug)).toEqual(['valle']) })
test('a failing table throws with its name', async () => {
  const bad = mockSupabaseContent(content, { failTable: 'legs' })
  vi.doMock('../../src/lib/supabase', () => ({ supabase: bad.client }))
  const { fetchCity: f } = await import('../../src/lib/data?fail')
  await expect(f('valle')).rejects.toThrow(/legs/)
})
```
(If the `?fail` re-import trick is awkward under Vitest 5, instead export `fetchCityWith(client, slug)` from data.ts and test that directly; keep `fetchCity` as `fetchCityWith(supabase, slug)`.)

- [ ] **Step 3: Implement**

`src/lib/db.ts`:
```ts
import { openDB, type IDBPDatabase } from 'idb'
import type { CityContent, TripRow } from './types'
let dbp: Promise<IDBPDatabase> | null = null
export function openDb() {
  dbp ??= openDB('europe-guide', 1, { upgrade(db) { db.createObjectStore('content'); db.createObjectStore('meta') } })
  return dbp
}
export async function getCachedCity(slug: string) { return ((await (await openDb()).get('content', slug)) as CityContent | undefined) ?? null }
export async function putCachedCity(c: CityContent) { await (await openDb()).put('content', c, c.trip.slug) }
export async function getCachedTrips() { return ((await (await openDb()).get('meta', 'trips')) as TripRow[] | undefined) ?? [] }
export async function putCachedTrips(t: TripRow[]) { await (await openDb()).put('meta', t, 'trips') }
```
`src/lib/data.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { CityContent, TripRow } from './types'
type Q = { data: unknown[] | null; error: { message: string } | null }
async function rows<T>(p: PromiseLike<Q>, table: string): Promise<T[]> {
  const { data, error } = await p; if (error) throw new Error(`load ${table}: ${error.message}`); return (data ?? []) as T[]
}
export async function fetchCityWith(c: SupabaseClient, slug: string): Promise<CityContent> {
  const f = c.from.bind(c)
  const [trips, days, items, bookings, routes, legs, alerts, parked, notes, areas] = await Promise.all([
    rows<TripRow>(f('trips').select('*').eq('slug', slug), 'trips'),
    rows(f('days').select('*').eq('trip', slug).order('date'), 'days'),
    rows(f('items').select('*').eq('trip', slug).order('date').order('sort'), 'items'),
    rows(f('bookings').select('*').eq('trip', slug).order('sort'), 'bookings'),
    rows(f('routes').select('*').eq('trip', slug).order('sort'), 'routes'),
    rows(f('legs').select('*').eq('trip', slug).order('route_id').order('seq'), 'legs'),
    rows(f('alerts').select('*').eq('trip', slug).order('date').order('seq'), 'alerts'),
    rows(f('parked_venues').select('*').eq('trip', slug).order('seq'), 'parked_venues'),
    rows(f('standing_notes').select('*').eq('trip', slug).order('seq'), 'standing_notes'),
    rows(f('offline_areas').select('*').eq('trip', slug).order('seq'), 'offline_areas'),
  ])
  if (!trips[0]) throw new Error(`trip "${slug}" not found`)
  return { trip: trips[0], days, items, bookings, routes, legs, alerts, parked, notes, areas } as CityContent
}
export const fetchCity = (slug: string) => fetchCityWith(supabase, slug)
export async function fetchTripsWith(c: SupabaseClient) { return rows<TripRow>(c.from('trips').select('*').order('sort').order('start_date'), 'trips') }
export const fetchTrips = () => fetchTripsWith(supabase)
```
Rows come back with an extra `owner` field; that is fine for the app.

- [ ] **Step 4: Run** `npm test` → PASS. **Step 5: Commit** `feat(app): IndexedDB mirror and Supabase content fetch`.

---

### Task 2: TripProvider and useTrip

**Files:**
- Create: `src/lib/trip.tsx`, `tests/lib/trip.test.tsx`
- Modify: `src/App.tsx` (wrap `Shell` in `TripProvider`)

**Interfaces:**
- Produces: `useTrip(): { trips: TripRow[]; slug: string | null; content: CityContent | null; loading: boolean; offline: boolean; error: string | null; setSlug(slug): void; refresh(): Promise<void> }`.
  - Initial slug: `?trip=` query param → `localStorage['europe-guide.trip']` → the trip whose date range contains today (per its own timezone) → the first trip by `sort`.
  - Load: try `fetchCity(slug)` → `putCachedCity` → set; on failure `getCachedCity(slug)` → set with `offline = true`; if neither, `error`.
  - Trips list: `fetchTrips()` → `putCachedTrips`; fallback `getCachedTrips()`.
  - `refresh()` re-runs the fetch for the current slug.

- [ ] **Step 1: Failing tests** — render a probe component inside `TripProvider` with the mocked client (Task 1 helper): (a) with no query/localStorage, slug resolves to `valle` and `content.items.length` matches; (b) with `failTable: 'items'` AND a cached copy already in IDB from a previous `putCachedCity`, `content` is served from cache and `offline === true`; (c) with failure and no cache, `error` matches /items/; (d) `setSlug('x')` persists to `localStorage`.

- [ ] **Step 2: Implement** with `useEffect` on `slug`; guard against state updates after unmount; `setSlug` writes localStorage and updates URL via `history.replaceState` with `?trip=`.

- [ ] **Step 3: Wire** `App.tsx`: `<Route element={<RequireAuth><TripProvider><Shell /></TripProvider></RequireAuth>}>`. Update the smoke test's supabase mock to include `from()` returning the Task 1 style chain resolving `{ data: [], error: null }` so Home renders.

- [ ] **Step 4: Run, commit** `feat(app): TripProvider with cached fallback`.

---

### Task 3: Time helpers

**Files:** Create `src/lib/time.ts`, `tests/lib/time.test.ts`

**Interfaces:**
- `nowInTz(tz: string, at: Date = new Date()): { date: string; minutes: number; hhmm: string }` — `date` = `YYYY-MM-DD` in tz via `Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' })`; `minutes` = hours*60+minutes in tz.
- `minutesOf(hhmm: string): number`; `fmtTime(hhmm | null, text | null)` → `'08:00'`, `'~18:00'`, or `'—'`.
- `currentBlock(minutes): Block` → `< 11:30` morning, `< 17:00` midday, else evening.
- `currentAndNext(alerts: AlertRow[], date: string, minutes: number): { current: AlertRow | null; next: AlertRow | null; minutesToNext: number | null }` — among alerts for `date` with a time: current = last with `minutesOf(time) <= minutes`, next = first with `> minutes`; if none today, next = first timed alert of the next date that has one (minutesToNext then spans midnight: `(24*60 - minutes) + minutesOf(next.time) + 24*60*(dayGap-1)`).
- `fmtDay(date: string, tz)` → `'Wednesday 30 September'`; `fmtCountdown(minutes)` → `'in 12 min'`, `'in 2 h 05'`, `'now'` for 0.
- `dayIndex(days: DayRow[], date)`; `isToday(trip, date)`.

- [ ] **Step 1: Tests** (deterministic with fixed `Date`): `nowInTz('Europe/Lisbon', new Date('2026-09-30T08:15:00Z'))` → `{ date: '2026-09-30', minutes: 9*60+15 }` (Lisbon is UTC+1 on that date); `nowInTz('Europe/Istanbul', …)` → +3; `currentBlock(600)` morning, `currentBlock(720)` midday, `currentBlock(1100)` evening; `currentAndNext` with the Valle alerts at 09:00 on the Monday returns current = the `—`-less earlier alert or null and next = the 09:15 alert with `minutesToNext 15`; after the last alert of a day, `next` is the first timed alert of the following day and `minutesToNext` spans midnight; `fmtCountdown(0)==='now'`, `fmtCountdown(125)==='in 2 h 05'`.

- [ ] **Step 2: Implement.** Use `Intl.DateTimeFormat(...).formatToParts` for hour/minute (`hourCycle: 'h23'`). No date libraries.

- [ ] **Step 3: Run, commit** `feat(app): timezone-aware time helpers`.

---

### Task 4: Links and inline markdown

**Files:** Create `src/lib/links.ts`, `src/components/Md.tsx`, `tests/lib/links.test.ts`, `tests/app/Md.test.tsx`

**Interfaces:**
- `walkLink(p: { lat: number | null; lng: number | null; name: string | null; address?: string | null }, tripName: string, mode: 'walking' | 'driving' = 'walking'): string | null` (null when no name and no coords).
- `routeLink(route: RouteRow) = route.google_url`; `legLink(leg: LegRow) = leg.google_url`.
- `<Md text={string} />` renders `**bold**` → `<strong>`, `[t](url)` → `<a target="_blank" rel="noopener">`, `\n` → `<br>`, and leaves other text as-is; never uses `dangerouslySetInnerHTML`.

- [ ] Tests: coords → `destination=38.71,-9.14&travelmode=walking`; no coords → `destination=Senzi%2C%20R.%20da%20Moeda%2012%2C%20Lisbon`; nothing → null. Md: renders a `<strong>` and an `<a href>` with `target=_blank`; text with `<script>` stays literal text.
- [ ] Implement with a small tokenizer (regex split on `(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))`).
- [ ] Commit `feat(app): maps deep links and inline markdown`.

---

### Task 5: State hooks (checks, booking state, attachments)

**Files:** Create `src/lib/state.ts`, `tests/lib/state.test.ts`

**Interfaces:**
- `useChecks(trip: string): { done: Set<string>; toggle(itemId: string): Promise<void>; loading }` — loads `item_checks` where `item_id like '<trip>/%'`; `toggle` inserts `{ item_id }` or deletes by id, optimistic update, revert on error and surface via `console.warn` + returned rejection.
- `useBookingState(trip): { state: Record<string, BookingStateRow>; save(bookingId, patch): Promise<void> }` — table `booking_state`, upsert on `(trip, booking_id)`; `BookingStateRow = { trip; booking_id; status: 'not_booked'|'booked'|'confirmed'|'cancelled'|'undecided'|null; confirmation_ref; cost; currency; notes; updated_at }`.
- `useAttachments(trip, bookingId): { list: AttachmentRow[]; upload(file: File): Promise<void>; url(a: AttachmentRow): Promise<string>; remove(a): Promise<void> }` — path `${ownerId}/${trip}/${bookingId}/${safeName}` where `safeName` = filename with `[^A-Za-z0-9._-]` → `_` and a `Date.now()` prefix; validates mime (`application/pdf` or `image/*`) and size ≤ 25 MB before upload; uploads to bucket `tickets` then inserts `attachments` row; `url()` = `createSignedUrl(path, 3600)`; `remove` deletes storage object then row. `ownerId` from `useAuth().session.user.id`.

- [ ] Tests with a mocked client: toggle inserts then deletes; failing insert reverts the optimistic set; `save` upserts with `onConflict: 'trip,booking_id'`; `upload` rejects a 30 MB file and a `.txt` file before calling storage; a successful upload calls `storage.from('tickets').upload` with the expected path shape then inserts a row.
- [ ] Implement. Commit `feat(app): item checks, booking state and attachment hooks`.

---

### Task 6: Day screen

**Files:** Create `src/components/NowNext.tsx`, `src/components/StopCard.tsx`, `src/components/RouteStrip.tsx`, `src/components/TripPicker.tsx`, `src/screens/Day.tsx`, `tests/app/Day.test.tsx`; Modify `src/App.tsx` (routes `/day`, `/day/:date`), `src/styles/base.css`

**Behaviour:**
- Header: TripPicker (pills; active = accent), day title `fmtDay` + `days.title` + status pill (`LOCKED` → accent outline; `LOCKED except dinner` → banana), left/right arrows to previous/next day, "Today" button when not on today.
- Default date: today in trip tz if inside the trip, else the first day.
- NowNext banner only on today: `current` alert text (Md) and `next` with `fmtCountdown`; hidden if there are no timed alerts today.
- Blocks: for each of morning/midday/evening present in items (or a single unnamed block when `block` is null): heading, `RouteStrip` (routes where `route.date === date`, all shown under the first block; each: title, `distance_text`, "Open route" link), then `StopCard`s for `kind==='stop'` items in `sort` order; `note` items render as a muted paragraph between cards in order; `route_link` items render as a link line.
- StopCard: time (`fmtTime`), plan (Md), first line of details, tick button (aria-label `Mark done`/`Mark not done`, accent when done, dims the card), "Walk there" link when `walkLink` non-null, expander showing full details (Md) and the item's `option` children as a compact list (name, details Md, Walk there).
- The current block on today gets a subtle accent left border.

- [ ] Tests (fixture content via a `TripProvider` test double or by mocking `useTrip`): renders three block headings for the first Valle day; renders the Caffè Nord card with a Walk there link containing `destination=`; clicking the tick calls `toggle` with the item id; the options table's two options appear under their parent; the `/day/<last date>` route renders the block-less day; NowNext shows `next` text when `Date` is fixed inside the trip.
- [ ] Implement, style, commit `feat(app): Day screen with now/next, ticks and walk links`.

---

### Task 7: Bookings screen

**Files:** Create `src/components/Pill.tsx`, `src/components/Sheet.tsx`, `src/screens/Bookings.tsx`, `tests/app/Bookings.test.tsx`; Modify `src/App.tsx`, `src/styles/base.css`

**Behaviour:**
- Sections: **To book** (`kind==='todo'` sorted by `book_by ?? decide_by`, priority Pill: critical → salmon, high → banana, medium → columbia, low → muted; overdue `book_by < today` → salmon border), **Booked** (`kind==='booked'` sorted by `date,time`), **Walk-in** (collapsed list of names).
- Effective status = `booking_state.status ?? status_from_file` mapped to a Pill.
- Row → `Sheet` with: title, date/time, all non-null file fields (address, contact as `tel:` link, notes Md, fallback, options, relates_to, and every `fields` entry as label/value), then editable: status select (five values), confirmation ref input, cost + currency, notes textarea, Save button (calls `save`), and **Attachments**: list with filename/size, tap opens signed URL in a new tab, delete with confirm; "Add PDF or photo" file input (`accept="application/pdf,image/*"`) calling `upload`; progress/disabled state during upload; errors shown inline.
- [ ] Tests: T01 appears under To book with a `critical` pill before T02; B01 under Booked; opening T01 shows its contact as a `tel:` link and the `why_urgent` field; selecting status `booked` and pressing Save calls `save('T01', { status: 'booked', … })`; choosing a file calls `upload`.
- [ ] Implement, commit `feat(app): Bookings with status, details and attachments`.

---

### Task 8: Routes screen and More

**Files:** Create `src/screens/Routes.tsx`, `tests/app/Routes.test.tsx`; Modify `src/screens/More.tsx`, `tests/app/More.test.tsx` (create), `src/App.tsx` (route `/routes`), `src/styles/base.css`

**Behaviour:**
- Routes: grouped by `route.date` (fmtDay), each route: title, mode icon text (walk/taxi/transit), `distance_text`, note (Md), "Open whole route" (`routeLink`), then legs: `from_name → to_name`, `distance_m`/`duration_s` when present (`'1.2 km · 15 min'`), per-leg "Walk there" (`leg.google_url`).
- More: sections — Trip (name, dates, base, intro Md), Parked venues (name, what, why, Walk there), Standing notes (section `standing` and `walkin` and `routes`, Md), Tools (link to `/routes`, "Export calendar (.ics)" button → Task 9, "Refresh data" → `refresh()`, offline indicator when `offline`), Account (email, Sign out). Surfaces `error` from `useTrip`.
- [ ] Tests: Routes renders V1 with 2 legs and V2 marked as taxi; More lists 3 parked venues and 3 standing notes and a Sign out button.
- [ ] Implement, commit `feat(app): Routes screen and More`.

---

### Task 9: Calendar export

**Files:** Create `src/lib/ics.ts`, `tests/lib/ics.test.ts`; Modify `src/screens/More.tsx` (button), `tests/app/More.test.tsx`

**Interfaces:**
- `buildIcs(trip: TripRow, alerts: AlertRow[]): string` — RFC 5545: `BEGIN:VCALENDAR`, `VERSION:2.0`, `PRODID:-//europe-guide//EN`, `CALSCALE:GREGORIAN`, `X-WR-CALNAME:Europe 2026 — <trip.name>`; one `VEVENT` per alert: `UID:<trip>-<date>-<seq>@europe-guide`, `DTSTAMP` (UTC now), timed alerts `DTSTART;TZID=<tz>:YYYYMMDDTHHMM00` with `DURATION:PT15M` and `BEGIN:VALARM / TRIGGER:PT0M / ACTION:DISPLAY / DESCRIPTION:<summary> / END:VALARM`; untimed alerts as all-day `DTSTART;VALUE=DATE:YYYYMMDD` without alarm; `SUMMARY` = first 60 chars of the alert text with markdown stripped; `DESCRIPTION` = full text with markdown stripped, escaped (`\\`, `;`, `,`, newlines → `\n`); lines folded at 75 octets with CRLF.
- `downloadIcs(filename, text)`: creates a Blob (`text/calendar;charset=utf-8`), an object URL, and clicks a temporary `<a download>`; on iOS Safari this opens the calendar import sheet.
- [ ] Tests: output starts with `BEGIN:VCALENDAR` and ends with `END:VCALENDAR\r\n`; a timed alert yields `DTSTART;TZID=Europe/Rome:20261102T091500` and a VALARM; an untimed alert yields `VALUE=DATE` and no VALARM; a comma in text is escaped; no line exceeds 75 octets; UIDs unique.
- [ ] More button per trip: "Export <trip.name> calendar" → `downloadIcs(\`europe-2026-<slug>.ics\`, buildIcs(...))`.
- [ ] Commit `feat(app): calendar export`.

---

### Task 10: Deploy, phone checklist, notes for Plan 3

- [ ] `npm test`, `npm run build`, push, confirm the Pages run succeeds.
- [ ] Phone checklist (owner + controller): sign in persists after relaunch; Day shows today's Lisbon plan once imported (Valle is not deployed; until the import runs, the trip picker will be empty and screens show an empty state with the message "No trips yet — run the import"); tick a stop, relaunch, still ticked; open a Walk there link into Google Maps; open a booking, upload a PDF, reopen it; export the calendar and add it to iOS Calendar; toggle airplane mode and reopen the app: Day and Bookings still render from the mirror with the offline indicator.
- [ ] Append to the ledger anything discovered for Plan 3 (Map) and Plan 4 (Home, Places, write queue).

## Self-review

- Spec §4 Day ✔ (Task 6), Bookings ✔ (7), Routes ✔ (8), More ✔ (8,9), calendar ✔ (9); §7 reads offline ✔ (1,2); writes offline (queue) explicitly Plan 4; §8 error handling: `useTrip.error`/`offline` surfaced in More and empty states ✔.
- Interfaces: `useTrip` shape identical in Tasks 2, 6, 7, 8; `walkLink` signature identical in 4, 6, 8; `AttachmentRow`/`BookingStateRow` defined once in Task 5 and consumed in 7.
- No placeholders: each task names files, behaviour and tests; code is given where shape matters (db, data, mock) and behaviourally specified where it is UI.
