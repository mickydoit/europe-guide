# Europe Guide — design spec

Date: 14 September 2026
Status: approved in conversation, awaiting written review
Owner: Michael de Wet (single user)

## 1. Purpose

A personal travel-guide PWA for a multi-city trip: Istanbul (20–29 Sep 2026), Lisbon
(29 Sep–4 Oct), Seville, Barcelona, Egypt. It turns the owner's markdown itinerary
files into a phone app that shows what is happening now and next, where to walk,
what is booked, holds ticket PDFs, shows the owner's live position with nearby
points of interest, and keeps working with no signal.

Hard deadline: usable and phone-tested by **19 September 2026**. Lisbon content is
the first import; other cities follow as their files arrive.

## 2. Decisions taken

| Topic | Decision | Why |
|---|---|---|
| Hosting | Public GitHub repo `mickydoit/europe-guide`, GitHub Pages | Free, known deploy path |
| Private data | Supabase (new project) behind email + password, RLS on everything | Pages URLs are always public; data must not be in the bundle |
| Source of truth | Markdown files stay master; import script pushes to Supabase | Owner is iterating in md; no time for an in-app editor |
| Stack | Vite + React + TypeScript, PWA | Matches Fitness Tracker; components map to Figma frames |
| In-app map | One engine: MapLibre GL + Protomaps (PMTiles), dark style | Same map online and offline; offline maps required for every city by launch |
| Google | Deep links open Google Maps app; Routes API for walking lines; Places API for nearby "!" markers; Geocoding in the import script | Owner's routes are already Google links |
| Reminders | `.ics` calendar export per city with alarms | iOS web push is fragile; native Calendar is reliable. Push is Tier 2 |
| Tickets | PDF (and image) upload to a private Supabase bucket per booking | Confirmations are PDFs |
| Login | One account, sign-ups disabled, long session, email password reset | Single user, no Face ID |
| Offline | App shell, current ±1 city content, PDFs, route lines and map file cached; writes queued | Signal drops everywhere on this route |
| Icons | Figma-exported SVGs as placeholders | Design nav uses Font Awesome Pro; owner will replace icons later |

## 3. Data model

Supabase Postgres. Every table has `owner uuid not null default auth.uid()` and an
RLS policy `owner = auth.uid()` for select/insert/update/delete. Storage bucket
`tickets` is private with the same owner check on the object path prefix
(`<owner>/<booking_id>/<filename>`).

### 3.1 Content tables (rewritten per city by the import script)

| Table | Key | Fields |
|---|---|---|
| `trips` | `slug` (`lisbon`) | name, country, start_date, end_date, base, timezone, sort |
| `days` | `(trip, date)` | title, status (`locked`, `locked_except_dinner`, null), intro (md) |
| `items` | `id` = `<trip>/<date>/<HHMM or seq>/<slug(plan)>` | day, block (`morning`/`midday`/`evening`/null), time (nullable), plan (md), details (md), sort, kind (`stop`/`option`/`note`), parent_item (for options), place_name, address, lat, lng, route_id |
| `bookings` | `id` (B01, T01…) | kind (`booked`/`todo`/`walkin`), title, date, time, priority, book_by, decide_by, contact, address, notes, fallback, relates_to, options, status_from_file |
| `routes` | `id` (W1, T1, S1…) | trip, date, title, distance_text, mode (`walking`/`driving`), covers[], note, google_url |
| `legs` | `(route_id, seq)` | from_name, to_name, from_lat, from_lng, to_lat, to_lng, google_url (single hop), polyline (cached from Routes API), distance_m, duration_s |
| `alerts` | `(trip, date, seq)` | time (nullable for "—"), text (md) |
| `parked_venues` | `(trip, seq)` | name, what, why, address, lat, lng |
| `standing_notes` | `(trip, seq)` | text (md) |
| `offline_areas` | `trip` | bboxes (json), pmtiles_path, size_bytes, built_at |

### 3.2 State tables (owner's, survive re-imports)

| Table | Key | Fields |
|---|---|---|
| `item_checks` | `item_id` | done_at |
| `booking_state` | `booking_id` | status (`not_booked`/`booked`/`confirmed`/`cancelled`/`undecided`), confirmation_ref, cost, currency, notes |
| `attachments` | `id` | booking_id, storage_path, filename, mime, size, uploaded_at |
| `day_notes` | `(trip, date)` | text (md), saved_places (json: name, place_id, lat, lng, saved_at) |
| `geocode_cache` | `query` (normalised name + address) | lat, lng, formatted_address, place_id, fetched_at |

Item ids are derived from date + time + plan slug, so an edit to the details text
keeps the tick; a change of time or name does not. This is intended.

## 4. Screens

Bottom tab bar on phone: Home, Day, Map, Bookings, More (Routes lives under More
and is also reachable from Day). Placeholder styling uses the Figma tokens in
`design/figma-source.md`.

- **Sign in / Reset password.** Email, password, "Forgot password" (Supabase
  reset email; the reset page is a route in the app). Sign-ups disabled.
- **Home** (Figma frame 1:1478). Date/time header. Country pills switch the active
  trip. Map hero shows the current city with today's stops as glowing dots; tap
  to open Map full screen. Options card shows the current block's `option` items
  ("Breakfast Options" in the morning, "Snack options" at 19:40). Tours row lists
  booked tours (bookings of kind `booked` that are tours) with a progress bar for
  time elapsed on the day. Itineraries row lists cities with "In N Days"
  countdown. Walking Route row lists today's legs with duration. Reminder chips
  are open `todo` bookings sorted by book_by.
- **Day.** "Now and next" banner from alerts with a countdown. Blocks
  Morning/Midday/Evening as cards, one per `stop` item: time, name, first line of
  details, done tick, "Walk there" (Google Maps deep link to the stop), expander
  for full details and attached options. Route strip per block links the whole
  Google route. Day arrows and city picker.
- **Map (full screen).** Edge to edge (viewport-fit=cover, safe-area insets), a
  collapse button, MapLibre dark style. Layers: today's stops as numbered
  markers, today's legs as walking lines, parked venues faint, Google Places
  discoveries as "!" markers within ~300 m of the user, refreshed after ≥150 m of
  movement. Bottom sheet on tap: name, rating, hours, photo, "Walk there", "Save
  to notes". Banner "Offline map" when `navigator.onLine` is false or tile
  fetches fail; disappears when back.
- **Bookings.** To Book (sorted by book_by, priority colour) and Booked (sorted by
  date). Detail sheet: all file fields, status toggle, confirmation ref, cost,
  attachments list with upload (Files or camera roll), open in browser viewer.
- **Routes.** Per day: route title, distance, note, whole-route Google link, leg
  list with per-leg "Walk there".
- **More.** Parked venues, standing notes, per-city: calendar export, "Prepare
  offline" (content + PDFs + route lines), "Download offline map" with size and
  status. Sign out.

Components: Card, Sheet, Banner, Marker, TabBar, Button, StatusPill, Pill,
Tile, ProgressBar. Owner will restyle in Figma; keep styling in tokens.

## 5. Import pipeline

`npm run import -- <city> [--dry-run]`, Node + TypeScript, runs on the laptop
with `SUPABASE_SERVICE_KEY` and `GOOGLE_SERVER_KEY` from a gitignored `.env`.

Input: `content/<city>/` containing `*Itinerary-Full.md` (required),
`*Bookings-Reminders.md` (required), `*Walking-Routes.md` and
`*Parked-Venues.md` (optional). YAML front matter (`trip`, `dates`, `base`,
`timezone` optional) seeds `trips`.

Steps:

1. **Parse strictly.** `# <Weekday> <D> <Month>[ — title][ ✅ status]` → day.
   `## Morning|Midday|Evening` → block. Tables with header `Time | Plan | Details`
   (or `Time | Plan`) → `stop` items; tables with header `Place | Address | Hours | Why`
   or similar immediately after a stop → `option` items attached to that stop.
   Bold paragraphs → `note` items. Bookings: sections 1–3 by table/heading id,
   section 4 alert tables by weekday heading, section 5 standing notes. Routes:
   `### <ID> — <title>` with bullet fields. Parked venues: single table.
   Any unrecognised heading, table shape, missing id or unparsable time stops the
   import with file and line number.
2. **Extract places.** Bold names + addresses in Plan/Details, and origin,
   waypoints, destination of each Google URL. Geocode via Google Geocoding with
   `geocode_cache`; region bias from the trip. Report misses.
3. **Legs.** Split each route's ordered points into single hops; build per-leg
   Google deep links; fetch and store walking polylines from the Routes API.
4. **Offline areas.** Cluster geocoded points (DBSCAN-style, ~1.5 km), pad each
   cluster by 400 m, union into bboxes. Run `pmtiles extract` from the public
   Protomaps build for those bboxes at zoom ≤ 16, upload to storage
   `maps/<city>.pmtiles`, write `offline_areas`.
5. **Write** content tables for the city in one transaction (delete + insert).
   State tables untouched.
6. **Summary**: counts per table, geocode misses, parse warnings, app link.

## 6. Security

- Bundle contains only Supabase URL + anon key and the Google browser key.
- Supabase: email/password, sign-ups disabled, RLS on all tables and storage,
  JWT expiry 1 h with refresh tokens valid 90 days, no anonymous access.
- Google browser key: HTTP referrer restricted to the Pages origin and localhost;
  APIs limited to Routes and Places (New) — the Maps JavaScript API is not used.
- Google billing cap: Google offers no hard spend limit, so the cap is enforced
  with per-API daily quotas set well inside each free allowance (Routes,
  Places Nearby, Places Details, Geocoding) plus a Cloud Billing budget with
  email alerts at 50% and 90% of the free tier. Quota exhaustion degrades the
  app (no lines, no "!" markers) rather than costing money. Server key (import) restricted to Geocoding + Routes, never shipped.
- PDFs: signed URLs (1 h), cached in the app's Cache Storage.
- Location stays on device except as coordinates sent to Google Routes/Places.
- No analytics, no third-party scripts beyond Google and MapLibre.

## 7. Offline and sync

- Service worker (vite-plugin-pwa) precaches the shell; runtime caches PDFs,
  polylines, Places photos.
- IndexedDB mirror of content tables for the active city and its neighbours,
  refreshed on app open when online.
- Write queue for `item_checks`, `booking_state`, `day_notes`; flushed on
  reconnect; last write wins.
- PMTiles per city stored in Cache Storage; MapLibre reads it via the PMTiles
  protocol both online (range requests from Supabase storage) and offline
  (from cache).
- Calendar export: one `.ics` per city from `alerts`, VALARM at 0 min, TZID from
  the trip; downloaded via a signed blob and opened in iOS Calendar.

## 8. Error handling

- Import: fail fast with location; `--dry-run` for checking new cities.
- App: any Supabase error while offline falls back to the IndexedDB mirror and
  shows a quiet "showing cached data" note; while online, errors surface as a
  toast with retry.
- Geolocation denied or unavailable: map still shows stops; Places layer is off;
  a one-line hint explains how to enable.
- Google API failure: "Walk there" still works (deep link); lines and "!"
  markers degrade to absent, never block the screen.

## 9. Testing

- Unit tests (Vitest) for the parsers against the four Lisbon files and against
  hand-made broken fixtures (bad heading, missing id, bad time).
- Unit tests for id derivation, leg splitting, bbox clustering, ics generation.
- Component tests for Day and Bookings rendering from fixture data.
- Manual phone checklist before the 19th: sign in, add to Home Screen, airplane
  mode walk-through of Day/Bookings/PDF/Map, calendar import, location on map.

## 10. Delivery

Tier 1 (by 19 Sep): scaffold + Supabase + auth + Pages deploy; Lisbon import;
Day, Bookings with upload, Routes, calendar export; full-screen Map with stops,
legs, live position, offline map; Home from Figma; Places layer; offline caching
and write queue; phone testing; Istanbul import when files arrive.

Tier 2 (during/after trip): web push reminders from a Supabase scheduled
function; in-app itinerary editing; Apple Wallet pass handling; Figma restyle
of the remaining screens.

## 11. Out of scope

Multi-user sharing, public itineraries, flight tracking, expense tracking,
native app store build.
