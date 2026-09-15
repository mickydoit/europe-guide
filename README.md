# europe-guide

Personal travel guide PWA for Europe 2026. Structure and spec in progress.

Live at https://mickydoit.github.io/europe-guide/

## Development

```bash
npm install
npm run dev      # local dev server
npm test         # vitest
npm run build    # tsc --noEmit && vite build
```

Copy `.env.example` to `.env` and fill in the `VITE_*` values for local development.

## Importing a city

**Prerequisites:** the [`pmtiles`](https://github.com/protomaps/go-pmtiles) CLI on `PATH`
(`brew install pmtiles`) — required unless you pass `--skip-maps` or `--dry-run` — and the
[Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), logged
in and linked to the project.

Trip content lives outside the repo, in `content/<slug>/` (gitignored — never commit it). Each
city is four markdown files, matched by filename suffix inside that directory:

- `*Itinerary-Full.md` — required. Day headings (`# Monday 2 November — title ✅ LOCKED`),
  `## Morning` / `## Midday` / `## Evening` blocks, `time | plan | details` tables, options
  tables, and walking-route links.
- `*Bookings-Reminders.md` — required. Front matter plus five numbered sections: already
  booked, to-book, walk-ins, in-trip alerts, standing notes.
- `*Walking-Routes.md` — optional. Per-route Google Maps deep links, split into legs.
- `*Parked-Venues.md` — optional. A single reference table of venues not in the itinerary.

The bookings file's front matter drives the trip row:

```yaml
trip: Lisbon              # required — the display name
dates: 2026-09-29 to 2026-10-04   # required — YYYY-MM-DD to YYYY-MM-DD
base: Alfama               # optional — neighbourhood/area text
timezone: Europe/Lisbon    # optional — inferred from `trip` if omitted
country: Portugal          # optional — inferred from `trip` if omitted
country_code: pt           # optional — required only if `country` is set but not in the built-in table
```

Run the import:

```bash
npm run import -- <slug> [--dry-run] [--skip-maps] [--maxzoom N] [--split-areas]
```

- `--dry-run` never writes to the trip/day/item/etc. content tables — it prints the counts it
  would have written and the geocode-miss list, so misses can be fixed in the markdown first.
  It still calls the Google Geocoding and Routes APIs and upserts hits into `geocode_cache`,
  so it consumes API quota just like a real import.
- `--skip-maps` skips building/uploading offline `.pmtiles` areas for that run.
- `--maxzoom N` (default 15, the Protomaps daily build's maximum) caps the offline map tile zoom
  level.
- By default, offline maps are built as **one merged `.pmtiles` file per city**: the union bbox
  of every clustered point (itinerary items, parked venues, route leg endpoints), each padded
  400 m, uploaded to `<slug>/0.pmtiles` and recorded as a single `offline_areas` row (`seq 0`,
  named after the trip). This removes the seams/gaps a multi-area download used to leave at
  cluster boundaries. Expect roughly 20–40 MB for a city-sized trip like Lisbon; the import
  report prints the extracted size in MB.
- `--split-areas` restores the old behaviour: one extract per geocoded cluster (walking-distance
  groups of points), each its own `offline_areas` row.

A parse failure aborts immediately and prints `✗ <file>:<line>: <message>` with a non-zero
exit code — nothing partial is written. A real (non-dry-run) import is atomic: the Postgres
function `import_city` deletes and re-inserts every table for that trip's `slug` in one
transaction, and is only callable with the service key (revoked from `public`, `anon`,
`authenticated`).

**Id stability:** item ids are derived deterministically from `trip/date/time-or-seq/slug(plan
text)` (see `scripts/import/ids.ts`) — the same source text always produces the same id across
re-imports. This lets client-side state (favourites, notification schedules, cached offline
data) key off item ids safely. Changing the wording of a plan line changes its id.

**Never commit `content/`** — it holds private trip data (real bookings, contacts, addresses)
and is excluded via `.gitignore`.

### Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | app, import | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | app | public, RLS-restricted |
| `VITE_GOOGLE_BROWSER_KEY` | app | referrer-restricted, Routes + Places (New) only |
| `SUPABASE_SERVICE_KEY` | import | service-role key, import script only, never shipped |
| `OWNER_USER_ID` | import | the single owner's Supabase auth uid |
| `GOOGLE_SERVER_KEY` | import | unrestricted-referrer, Geocoding + Routes only |
| `PROTOMAPS_BUILD_URL` | import | newest build from https://maps.protomaps.com/builds/ |
