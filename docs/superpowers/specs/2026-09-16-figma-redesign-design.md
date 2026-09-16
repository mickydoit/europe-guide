# Europe Guide — Figma redesign spec

Date: 16 September 2026. Supersedes the visual sections of the 14 September design spec; data model, import, security, offline and sync sections of that spec stay in force except where amended here.

Reference: Figma file `KMHaWP7ikFa3IimN3cx520` (Travel Itinerary App, Community). Frames used: Screen `1:58`, Travel Cards `1:208`, Ticket `1103:45`, Place Card `1103:161`, Navigation `1:85`, style guide `1:322`, and the owner's existing Home frame `1104:729` for the world map.

## 1. Purpose

Restyle the live PWA to the Figma look and add three things it lacks: ticket cards for bookings, detail screens for tickets and places, and an upcoming view of every ticket grouped by country, city and day. The trip departs 20 September; the app must remain deployable at every step.

## 2. Decisions taken

- **Cards represent bookings.** Rows from the booked table and to-book items are tickets. Itinerary stops stay in the Day timeline. Walk-in venues are never tickets.
- **Restyle in place.** Routes, data hooks, offline queue, map and the 453 tests are kept. Tokens, components and screens change; the data model gains only photo columns and a kind column.
- **Five tabs.** Home, Day, Map, Tickets, More. Tickets replaces Bookings and absorbs the trip picker. The Figma heart icon is not used.
- **No country pills on Home.** Country and city selection lives on the Tickets tab only and sets the active trip for Day and Map. Home picks the trip whose dates include today, otherwise the next to start.
- **Photos everywhere, fetched at import.** Google Places photos are downloaded by the import script into a private bucket and cached offline by the app like ticket PDFs. The app never calls Places for photos at runtime. Every card has a colour-and-icon fallback.
- **Fonts self-hosted.** Overpass for UI, Poppins for ticket faces, woff2 in `public/fonts`, precached by the service worker.

## 3. Theme

`src/styles/tokens.css` is replaced. Values are sampled from the Figma fills, not the style-guide labels (the second swatch is labelled #FEFEFE but rendered lavender).

| Token | Value | Role |
|---|---|---|
| `--bg` | #070606 | page ground |
| `--surface` | #083740 | default card, ticket body, sheets |
| `--bg-nav` | #070606 at 90% | tab bar |
| `--accent` | #22DD85 | active states, times, reference numbers |
| `--highlight` | #F7FF88 | selected tab or pill, active tab icon, "next up" and accommodation cards |
| `--lavender` | sampled from card `1:209` fill (≈ #C4B5FD) | event and tour cards, PDF button |
| `--text` / `--text-soft` / `--text-dim` | #FFFFFF at 100 / 70 / 45% | text |
| `--radius-card` | 20px | cards |
| `--radius-pill` | 9999px | pills, tabs |
| `--font` | Overpass, system fallback | UI |
| `--font-ticket` | Poppins, system fallback | ticket faces |

Card colour rule by kind: transport → surface teal; accommodation → highlight yellow with dark text; event or tour → lavender with dark text; the single next-up card → highlight yellow; past or cancelled → near-black `#131313` with dim text.

Font weights shipped: Overpass 400, 600, 800; Poppins 500, 700. The existing tints (salmon, banana, mint, sky, coral, golden) are removed and every use re-pointed.

## 4. Booking kind

A booking's kind is one of `transport`, `accommodation`, `event`, computed in the app (no new column). The markdown field `**kind:**` lands in the existing `fields` JSON via the parser and wins when it holds one of those three values; otherwise the kind is inferred from the **title only** with a keyword list: flight, train, AVE, taxi, Bolt, airport, transfer, ferry, cab → transport; hotel, stay, flat, apartment, check-in, Airbnb → accommodation; else event. Notes are not consulted because they mention taxis and hotels in passing. Inference is a pure function with tests. (Amended 16 Sep during planning: was a `kind_hint` column set at import, and title+notes.)

## 5. Screens

### 5.1 Tab bar

Five items: Home (house), Day (calendar), Map (pin), Tickets (suitcase), More (person). 24 px filled glyphs; house, suitcase and person exported from Figma `1:85`, calendar and pin chosen from the same icon family to match weight. Active item in `--highlight` with the Figma's short underbar; inactive at 40% white. Height 64 px plus safe area. `ScrollReset` stays. Hidden on `/map` as now.

### 5.2 Home `/`

Order: greeting header; weather row; world map hero; next-up card; tickets row; tours and events row; reminders.

- **Header.** "Hello... Michael" (first name from a `VITE_OWNER_NAME` build variable; the app has no profile; fallback "Hello") in Overpass 800; below it the date and the active trip's local time in `--text-dim`.
- **Weather row.** Current condition and temperature large, hourly strip for the rest of the day. Reuses `WeatherStrip` and its cache. Before the forecast window opens, the existing "Forecast opens on …" line.
- **World map hero.** `WorldHero` unchanged in function; the weather overlay is removed from it since weather has its own row. Tap opens `/map`.
- **Next-up card.** The airport-cab layout: kind label, reference or title in `--accent` at 28 px, address line with pin icon, kind icon bottom-left, call button bottom-right when `contact` holds a phone number. Source: the first booking on the active trip day with `time` later than now in trip time, else the first booking of that day, else the first booking of the next day that has one. Tap opens its detail screen.
- **Tickets row.** Horizontal scroll of `TicketCard` for the remaining bookings of the day (excluding the next-up one). Empty state: "No more tickets today".
- **Tours and events row.** Horizontal scroll of `PlaceCard` for today's itinerary stops of kind `stop` with a `place_name` and a `time`, excluding stops that match a booking by `relates_to` or name. Empty state hidden.
- **Reminders.** Existing `ReminderChips` restyled as pills.
- Removed from Home: Options card, Itineraries tile row, country pills, walking-routes row (walks remain reachable from Day and the Routes screen).

### 5.3 Tickets `/tickets`

- **Country tabs** from `trips.country` in trip sort order, Figma tab style (icon + label, selected filled `--highlight`). Selecting a country selects its first city.
- **City chips** shown only when a country has two or more trips. Selecting a city calls `setSlug`, so Day and Map follow. The app loads one city's content at a time, so the list below always shows the selected city's bookings; the tabs are how you move between cities.
- **List** grouped by date with sticky headers "Tuesday 6 October". Each booking renders as a `TicketCard`: title, two data lines chosen by kind (transport: time and reference/cost; accommodation: check-in date and reference; event: time and cost), photo or kind icon on the right, colour by rule. Status pill (booked / not booked / unconfirmed / decide) at the bottom-right; tapping cycles status exactly as Bookings does today via the offline queue. Tapping the card opens the detail screen.
- Days before today collapse into one row "N earlier days" that expands on tap.
- The route `/bookings` redirects to `/tickets` so old links and the ics export keep working.

### 5.4 Ticket detail `/ticket/:trip/:id` (transport, accommodation)

Boarding-pass layout in `--surface`, Poppins faces.

- **Route strip.** Left and right columns: date above, time in `--accent` large, place label below (origin and destination for transport parsed from the title's "A → B" or the address when present; check-in and check-out dates for accommodation with nights in the centre). Centre: duration when both times exist, kind icon on a dotted line.
- **Body.** Title left with `id` in `--accent`; right column shows priority. Below, the four-cell black strip filled in priority order from `fields` and columns: cost, contact, book_by (as "Book by"), then remaining `fields` keys except `for_note`, `book_by_note`, `tier`. Empty cells are omitted; the strip disappears when no cell has a value.
- **Perforated stub** (CSS notches and dashed line). If an attachment exists: the PDF's first page thumbnail rendered with the existing pdf.js path, tap opens full screen from the cache. Otherwise: status pill, `notes`, `fallback` under a "Fallback" label. The round `--lavender` button opens or attaches the PDF as Bookings does today.
- Status pill cycles as in Tickets.

### 5.5 Place detail `/place/:id` (events, tours, itinerary stops)

Opened from a `PlaceCard`, from an event booking, or from a Day stop.

- Photo header 4:3 with a dark gradient; name in Poppins 700 overlaid; photographer credit small in the top-right (Google requirement).
- Facts row: time, duration when the details contain "N min" or "N h", cost from fields, status when the item is a booking.
- Full `details` text (markdown via `Md`), then address with **Walk there** (existing action), contact as `tel:` link, Google Maps deep link.
- If the stop has option children, they list as small cards with their own address and notes.
- The tick control from Day is present so a stop can be checked from here.

### 5.6 Day `/day/:date?`

Timeline kept. Block headers in Overpass 800. Stops become compact rows: time in `--accent`, name, first details line, tick right. A row that matches a booking shows a ticket glyph and opens the ticket detail; other rows open the place detail. Weather strip removed from Day. Prev/next arrows and Map link stay. Options render inside the parent stop row as now.

### 5.7 Map `/map/:date?`

Tokens only. Pins in `--accent`; the sheet in `--surface`. Booking markers open the ticket detail from the sheet.

### 5.8 More `/more`

Same content on `--surface` rows: trips with offline map download and size, storage usage, version and update check, sign out. Trip picker removed (Tickets owns it).

### 5.9 Sign-in and reset

Tokens and fonts only.

## 6. Photos

### 6.1 Storage and schema

- New private bucket `photos`, owner-only policies mirroring `maps` and `tickets`.
- Migration `20260916000007_photos.sql`: `items.photo_path text`, `items.photo_credit text`, `bookings.photo_path text`, `bookings.photo_credit text`. The `import_city` function is updated to carry the new columns (it uses `jsonb_populate_recordset`, so the record type must include them).
- Photo path convention `<trip>/<item or booking id>.jpg`, 800 px wide JPEG, quality 80.

### 6.2 Import step

After geocoding, for every booking and every `stop` or `option` item with a `place_name`:

1. If `geocode_cache` has a `place_id` for the row's query, call Place Details (New) `places/{place_id}` with field mask `photos.name,photos.authorAttributions`. Otherwise call Text Search (New) with the name plus city and `locationBias` at the geocoded point, `maxResultCount 1`.
2. Take the first photo, fetch `/{photo.name}/media?maxWidthPx=800` with the server key, store the bytes, and write `photo_path` and the first `authorAttributions[].displayName` as `photo_credit`.
3. Skip rows whose `photo_path` already exists in the bucket, so re-imports cost nothing new. Cache the Places response in a new `photo_cache` table keyed by query, like `geocode_cache`.
4. Flags: `--skip-photos` mirrors `--skip-maps`. Failures are warnings in the report, never fatal.

The server key needs Places API (New) added to its API restrictions; this is an owner console step before the first photo import. Expected volume ≈ 200 photos for the whole trip.

### 6.3 App side

- `attachmentsWarm` extends to photo paths: on load while online, download any photo not yet in the cache, after PDFs, capped at the existing 200 MB budget.
- `PhotoImg` component: renders from the cache or the signed URL when online, falls back to the kind icon on the card colour when missing. Never blocks layout.

## 7. Data flow additions

- `useTrip` gains `activeTripForToday()` used by Home; Tickets keeps calling `setSlug`.
- `nextTicket(content, date, minutes)` and `inferKind(booking)` are pure functions in `src/lib/tickets.ts`.
- Grouping for Tickets: `groupTickets(trips, bookings) → country → city → date → bookings[]`, pure, tested.

## 8. Error handling

- Missing photo, missing PDF, missing fields: each card and screen degrades to text and icon; nothing throws on absent data.
- Places failures at import are per-row warnings with the row id.
- Font files missing from the cache fall back to system fonts through the stack.

## 9. Testing

- Existing 453 tests stay green at every commit.
- New unit tests: `inferKind`, `nextBooking`, `groupTickets`, four-cell field priority, ticket route-strip parsing, photo import step with a mocked Google client (Details path, Text Search path, skip-if-exists, failure-as-warning).
- Component tests for `TicketCard`, `PlaceCard`, Tickets grouping render, Home next-up selection, `/bookings` redirect.
- Headless screenshots at 390×844 of every screen on real Lisbon and Seville data, attached to the PR for the owner's eye; the owner's approval of the look is the merge gate.

## 10. Delivery

One branch `feat/figma-redesign`, built and reviewed in this order, each step leaving main deployable:

1. Theme tokens, fonts, tab bar.
2. Home.
3. Tickets view and `/bookings` redirect.
4. Ticket and place detail screens.
5. Day, Map, More, auth restyle.
6. Photos: migration, bucket, import step, warm pass, `PhotoImg`; re-import Lisbon and Seville with `--skip-maps`.

Steps 1–5 ship before 19 September; step 6 ships when ready and the cards work without it.

## 11. Out of scope

- Favourites (the Figma heart).
- Any change to the map engine, offline tile pipeline, sync queue or auth.
- Restructuring bookings and items into one table.
- Editing bookings in the app; markdown stays the source of truth.
