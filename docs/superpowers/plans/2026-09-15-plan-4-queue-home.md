# Europe Guide — Plan 4: Offline write queue, single-file city maps, Home screen

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app trustworthy with no signal (writes queue and sync later; ticket PDFs open offline), remove the map coverage gaps and seams (one PMTiles file per city), trim Places cost, and build the Home screen from the owner's Figma design.

**Architecture:** An `outbox` store in IndexedDB holds pending writes as small typed operations; `state.ts` hooks keep their optimistic updates and enqueue on failure or when offline; a `sync.ts` module flushes the outbox on `online`, on foreground, and after any successful write, in FIFO order, retrying with backoff and surfacing the pending count through a `useSync()` hook. The import script gains a merged single extract per city (union bbox, maxzoom 15) so `offline_areas` has one row per trip. Places drops `photos` from the nearby field mask and fetches a photo lazily from Place Details when a sheet opens. Attachments are cached in Cache Storage when first listed online and served from cache offline. Home is a new screen composed from existing data hooks plus `getCurrent` weather, laid out per the Figma tokens; `/` routes to it.

**Tech Stack:** unchanged. Vitest for everything; screen tests with `TripProvider initial` + mocked hooks as in Plans 2–3.

**Spec:** `docs/superpowers/specs/2026-09-14-europe-guide-design.md` §4 Home, §7 offline (writes offline queue, PDFs cached), §5 offline areas; Plan 3 notes for carried items.

## Global Constraints

- Every write path goes through `state.ts` → `sync.ts`; screens never talk to Supabase directly.
- Queue semantics: FIFO per key, idempotent replays (`upsert` with `onConflict`, insert-or-ignore for checks), last-write-wins on the same key (a newer op for the same key replaces the older one in the outbox), max 20 attempts with exponential backoff capped at 5 minutes, never drop silently: after 20 attempts the op is marked `failed` and shown in More with a Retry.
- Optimistic state is the source of truth for the UI while an op is pending; a successful server read must not overwrite a pending optimistic value (compare against the outbox).
- Attachment uploads offline store the `File` blob in the outbox record (IDB supports Blobs); size limit stays 25 MB.
- Single map file per city: `offline_areas` gets exactly one row (`seq 0`, `name = trip.name`, bbox = union of clusters padded 400 m), `pmtiles_path = <trip>/0.pmtiles`, maxzoom 15 (the Protomaps build maximum). App code keeps working with N rows (no assumptions on count).
- Places field mask excludes `places.photos`; the sheet fetches `GET https://places.googleapis.com/v1/places/{id}` with `X-Goog-FieldMask: photos` only when opened and only if online; cache per session.
- Home follows the Figma frame `design/figma-assets` tokens: Coal bg, Caribbean Green accent, pastel tiles, SF Pro/Inter fallbacks; left-aligned; the map hero is the optimised world-map SVG with trip-city dots; `/` renders Home (remove the `/day` redirect).
- Bundle: no maplibre in the index chunk; Home must not import Map code.
- Times in trip tz; commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; never commit `content/`, `.env`, `.cache/`.

## File structure

```
src/lib/
├── outbox.ts        IDB store `outbox` (db v3): enqueue(op), list(), remove(id), update(id, patch), replaceByKey(key, op)
├── sync.ts          flushOutbox(client), startSync(), useSync() → { pending, failed, syncing, retryFailed(), lastError }
├── state.ts         hooks route failures/offline through outbox; reads reconcile against pending ops
├── attachmentsCache.ts  cacheAttachment(id, signedUrl), getCachedAttachmentUrl(id) → blob URL | null
├── places.ts        + placePhoto(id, key, fetchImpl) (Details, fields=photos)
└── weather.ts       (getCurrent already exists)
src/screens/Home.tsx, src/components/{WorldHero,OptionsCard,TileRow,ReminderChips,SyncBadge}.tsx
public/home/world.svg (optimised from design/figma-assets/world-map.svg via svgo, target ≤ 250 KB)
scripts/import/offline.ts  buildOfflineAreas → single merged extract (flag --split-areas keeps the old behaviour)
tests/lib/{outbox,sync,attachmentsCache}.test.ts, tests/app/{Home,SyncBadge}.test.tsx, updates to state/places/offline tests
```

---

### Task 1: Outbox store and sync engine

**Files:** `src/lib/db.ts` (v3, store `outbox` keyed by `id`, index `key`), `src/lib/outbox.ts`, `src/lib/sync.ts`, `tests/lib/outbox.test.ts`, `tests/lib/sync.test.ts`

**Interfaces:**
- `type OutboxOp = { id: string; key: string; kind: 'check_set' | 'booking_state' | 'day_notes' | 'attachment_upload'; payload: unknown; createdAt: number; attempts: number; nextAt: number; status: 'pending' | 'failed'; lastError?: string }`
  - `check_set` payload `{ itemId: string; done: boolean }` (key `check:<itemId>`) → replay: done ? `insert({ item_id })` ignoring duplicate-key errors (code `23505`) : `delete().eq('item_id', id)`.
  - `booking_state` payload = the upsert row (key `booking:<trip>:<id>`) → `upsert(row, { onConflict: 'trip,booking_id' })`.
  - `day_notes` payload `{ trip, date, patch: { text? , saved_places? } }` (key `notes:<trip>:<date>:<field>`) → upsert with `onConflict: 'trip,date'`.
  - `attachment_upload` payload `{ trip, bookingId, ownerId, path, filename, mime, size, blob: Blob }` (key = path) → storage upload then row insert.
- `enqueue(op: Omit<OutboxOp,'id'|'createdAt'|'attempts'|'nextAt'|'status'>): Promise<OutboxOp>` — replaces any pending op with the same `key` (last write wins) except `attachment_upload` (distinct paths).
- `flushOutbox(client, now = Date.now()): Promise<{ done: number; remaining: number; failed: number }>` — processes ops in `createdAt` order whose `nextAt <= now`; on success remove; on error `attempts++`, `nextAt = now + min(5 min, 2^attempts × 2 s)`, `lastError`; when `attempts >= 20` set `status:'failed'`; stops early when `!navigator.onLine`.
- `startSync(client)`: listeners on `online`, `visibilitychange` (visible), and a 60 s interval; returns a stop function. `useSync()` hook: subscribes to an in-module event emitter (`onChange`) and returns `{ pending, failed, syncing, lastError, retryFailed() }` (retry resets `attempts`/`status` on failed ops and flushes).
- Tests with a fake client that can be told to fail N times: FIFO order; last-write-wins per key; backoff schedule; failed after 20; `retryFailed` re-runs; `flushOutbox` skips when offline (stub `navigator.onLine`); duplicate-key on check insert treated as success.

- [ ] Commit `feat(sync): outbox store and flush engine`.

---

### Task 2: Route state hooks through the outbox + UI

**Files:** `src/lib/state.ts`, `tests/lib/state.test.ts`, `src/components/SyncBadge.tsx`, `src/screens/More.tsx` (pending/failed section with Retry), `src/screens/Day.tsx`, `src/screens/Bookings.tsx`, `src/components/MapSheet.tsx`, `src/main.tsx` (`startSync(supabase)`), `src/styles/base.css`

**Behaviour:**
- `useChecks.toggle`: optimistic as now; if `!navigator.onLine` → enqueue immediately (no network attempt); else attempt, on error enqueue; never revert when enqueued; `console.warn` only for unexpected errors. Same pattern for `useBookingState.save`, `useDayNotes.setNote/savePlace/removePlace`, `useAttachments.upload` (offline → enqueue with the Blob and show the file in the list with a "waiting to upload" tag; the list row gets `pendingUpload: true`).
- Reconciliation on load: after fetching `item_checks`/`booking_state`/`day_notes`/`attachments`, apply pending outbox ops for that trip on top (so a reload while offline still shows your tick).
- Messages: replace "Couldn't save — you may be offline" with "Saved on this phone — will sync when online" (accent, not salmon) when the op was enqueued; keep the error tone for genuinely failed (non-network) errors.
- `SyncBadge` (small pill "N to sync" / "Syncing…" / "N failed") shown in the Day header and More; More has a "Pending changes" section listing ops by kind with a Retry all button when any failed.
- Tests: toggle offline enqueues and keeps the tick; a load after an offline toggle still shows done; save/upload offline enqueue; SyncBadge renders counts from a mocked `useSync`.

- [ ] Commit `feat(sync): queue writes offline and reconcile on load`.

---

### Task 3: Single-file city map at import; re-import Lisbon

**Files:** `scripts/import/offline.ts`, `scripts/import/cli.ts` (`--split-areas` flag), `tests/import/offline.test.ts`, README

**Behaviour:** default = one extract for the union bbox of all clustered points padded 400 m, `--maxzoom 15`, uploaded to `<trip>/0.pmtiles`, one `offline_areas` row named `trip.name`; `--split-areas` keeps per-cluster extraction. Report prints the file size in MB. Tests: default produces 1 row whose bbox contains all points; `--split-areas` behaves as before.
- After merge: run `npm run import -- lisbon` (controller), confirm one row and the size; the app's Offline Map card will show "0 of 1 · X MB" and the registry generation logic re-reads on download.

- [ ] Commit `feat(import): single merged offline map per city`.

---

### Task 4: Places cost trim and lazy photo

**Files:** `src/lib/places.ts`, `src/components/MapSheet.tsx`, `src/screens/Map.tsx`, tests

**Behaviour:** remove `places.photos` from the nearby field mask (`Place.photoName` becomes `null` from search); add `placePhoto(id, key, fetchImpl = fetch): Promise<string | null>` → Details with `X-Goog-FieldMask: photos`, returns `photos[0].name` or null; the sheet calls it once per place id when opened and online (session cache `Map<id, string|null>`), then renders `photoUrl(name, key)`. Tests: mask excludes photos; `placePhoto` request shape; sheet requests photo once and shows the img.

- [ ] Commit `perf(places): drop photos from nearby search; fetch on demand`.

---

### Task 5: Attachments offline cache

**Files:** `src/lib/attachmentsCache.ts`, `src/lib/state.ts` (`useAttachments`: after listing online, prefetch each attachment's signed URL into Cache Storage `europe-guide-attachments` under `/__att/<id>`; `url(a)` returns a blob URL from cache when present or offline, else a fresh signed URL), `src/screens/Bookings.tsx` (open via the returned URL; when opening from cache use `window.open` synchronously as now), tests.
- Cap total cache at 200 MB (evict oldest by `uploaded_at` when over). Tests with the caches polyfill: prefetch stores; offline `url()` serves from cache; eviction.

- [ ] Commit `feat(bookings): ticket PDFs available offline`.

---

### Task 6: World hero asset and Home data selectors

**Files:** `public/home/world.svg` (run `npx svgo --multipass design/figma-assets/world-map.svg -o public/home/world.svg`; if still > 250 KB, simplify further or rasterise to a 1200 px PNG), `src/lib/home.ts` (pure selectors), `tests/lib/home.test.ts`

**Selectors** (all take `content`, `trips`, `now` in trip tz):
- `currentBlockOptions(content, date, minutes)` → the `option` items whose parent stop's block is the current block (or the next upcoming stop's options), with a heading like "Breakfast options"/"Snack options" derived from the parent stop's plan (first 3 words) — fallback "Options".
- `toursToday(content, date, minutes)` → bookings `kind==='booked'` on `date` with a time, each with `progress` 0–1 = elapsed since start over an assumed 3 h (or until the next booked item), and `status: 'upcoming' | 'live' | 'done'`.
- `tripCountdowns(trips, todayISO)` → `{ slug, name, label: 'Now' | 'In N days' | 'Done' }`.
- `legsToday(content, date)` → legs with route title and metric label.
- `openReminders(bookings, state, todayISO)` → todo bookings not booked/confirmed, sorted by `book_by`, label "Book X by D Mon".
- `cityDot(lat,lng, viewBox)` → x/y for the hero via equirectangular mapping (document the calibration constants used against the SVG's viewBox; a test pins Lisbon roughly left of Istanbul and above Cairo).

- [ ] Commit `feat(home): hero asset and data selectors`.

---

### Task 7: Home screen

**Files:** `src/screens/Home.tsx`, `src/components/{WorldHero,OptionsCard,TileRow,ReminderChips}.tsx`, `src/App.tsx` (`/` → Home; keep `/day`), `src/components/TabBar.tsx` (Home label/icon), `src/styles/base.css` (`/* Home */`), `tests/app/Home.test.tsx`

**Layout (top to bottom, per Figma):** date/time header (`fmtDay(today)` + `hhmm` ticking every 30 s) with the SyncBadge; trip pills (TripPicker) — the active trip is the accent pill; WorldHero: `world.svg` with glowing dots for each trip city (current one pulsing), overlaid with current weather (`getCurrent`: icon, temp, condition) when online/cached and an "Open map" button → `/map`; OptionsCard (heading + up to three circular tiles with the option name, tap → sheet with details + Walk there); "Tours" TileRow (booked tours with progress bar + time); "Itineraries" TileRow (trips with countdown; tap → `setSlug` and `/day`); "Walking routes" TileRow (today's legs, tap → `legLink`); "Reminders" chips (open todos; tap → `/bookings`). Empty states per section ("No options right now", etc.). No horizontal overflow at 390 px; rows scroll horizontally.
- Tests: renders header, pills, hero image, sections from Valle content with a fixed clock; countdown labels; a reminder chip links to `/bookings`; smoke test updated for `/` → Home heading.

- [ ] Commit `feat(home): Home screen from the Figma design`.

---

### Task 8: Cleanup and deploy

- Delete `src/screens/Placeholder.tsx`; `GLYPHS/SPRITE/worker` paths via `import.meta.env.BASE_URL`; leg line style by `mode` (walking accent, driving banana dashed, transit columbia dashed); Refresh button disabled while loading; undated routes last.
- `npm test`, `npm run build` (chunk check), merge to `main`, deploy, run the headless probe (`.cache/map-probe.mjs`) once against Home and Map.
- Owner checklist: tick offline then reconnect → syncs; upload a PDF offline → uploads later; open a PDF in airplane mode; Home renders with weather; single-file map download and no gaps.

## Self-review
- Spec §7 write queue ✔ (T1–2), PDFs cached ✔ (T5); §4 Home ✔ (T6–7); §5 offline areas one-per-city ✔ (T3); Plan 3 carried items ✔ (T3, T4, T8).
- Interfaces: `OutboxOp` kinds ↔ hook enqueue calls ↔ `flushOutbox` replay table are the single contract; `useSync` consumed by SyncBadge/More/Day; `placePhoto` by MapSheet; selectors in `home.ts` consumed only by Home.
- Risk: Home is the most design-sensitive task and the owner will restyle in Figma later; keep it token-driven and component-split.
