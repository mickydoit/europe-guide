# Europe Guide — Plan 3: Full-screen Map, offline tiles, Places, Weather

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-screen in-app map that looks identical online and offline: MapLibre rendering the per-city Protomaps extracts already in the private `maps` bucket, with today's stops, walking lines, parked venues, the user's live position, Google Places "!" discoveries nearby, and a weather strip on the Day screen.

**Architecture:** The map route is code-split (lazy) so Day/Bookings never load MapLibre. Map data for a city is downloaded once (all `offline_areas` files, ≈12 MB for Lisbon) into Cache Storage and served to the `pmtiles` library through a custom in-memory `Source`, so the renderer never depends on network once downloaded; a "Download offline map" button in More does this explicitly and the Map screen offers it on first open. Glyphs and sprites for the basemap theme are bundled under `public/map/` so labels render offline. Markers and lines are GeoJSON sources built from `content` (items, parked, legs' encoded polylines). Places and Weather are thin fetch modules on the browser key with IndexedDB caching; both degrade to absent when offline or over quota.

**Tech Stack:** as Plans 1–2 plus `maplibre-gl@6`, `pmtiles@4`, `@protomaps/basemaps@5`, `@mapbox/polyline@1`. Google Places API (New) `places:searchNearby` and Weather API `forecast/days:lookup`, `forecast/hours:lookup`, `currentConditions:lookup`.

**Spec:** `docs/superpowers/specs/2026-09-14-europe-guide-design.md` §4 Map, §4 Weather, §2 decisions (single map engine), §7 offline.

## Global Constraints

- One map engine: MapLibre + PMTiles. No Google Maps JavaScript API. Google is used only for deep links (`walkLink`), Places and Weather.
- Map bundle is lazy: `import('./screens/Map')` behind `React.lazy`; the Day/Bookings chunk must not import maplibre.
- Offline parity: once a city's map is downloaded, the Map renders with the network disabled (tiles, glyphs, sprites all local). Online without a download uses signed URLs with range requests.
- Places calls only fire on meaningful movement (≥150 m since the last query) and at most once per 60 s; radius 300 m; results cached in memory per session; never more than 20 markers.
- Weather is cached per `(trip, kind, date)` for 60 min in IndexedDB; stale cache is shown with an "as of HH:MM" caption when offline.
- The browser key is `import.meta.env.VITE_GOOGLE_BROWSER_KEY`; requests carry no other secret. Storage reads use signed URLs (3600 s) from the `maps` bucket.
- All reads via `useTrip`; all writes via `src/lib/state.ts` (add `useDayNotes` there for "Save to notes").
- Tokens/left-aligned/safe-area rules as before; the Map screen is edge to edge: `position: fixed; inset: 0`, tab bar hidden while on `/map`, a top-left "Close" button returns to the previous route, controls respect safe-area insets.
- Tests: no network; MapLibre is mocked in component tests (`vi.mock('maplibre-gl')`) — logic lives in pure modules (`geo.ts`, `mapData.ts`, `places.ts`, `weather.ts`, `offlineMaps.ts`) that are unit-tested for real.
- Commit after each task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never commit `content/`, `.env`, or `.cache/`.

## File structure

```
public/map/
├── fonts/Noto Sans Regular/{0-255,256-511,512-767}.pbf, Noto Sans Medium/…, Noto Sans Italic/… (copied from protomaps basemaps-assets)
└── sprites/v4/dark{.json,.png,@2x.json,@2x.png}
src/lib/
├── geo.ts            haversineM, decodePolyline (via @mapbox/polyline), bboxOfPoints, distanceLabel
├── offlineMaps.ts    listAreas(content), downloadCityMaps(trip, areas, signer, onProgress), getCachedMap(trip, seq) → ArrayBuffer|null, cachedMapStatus(trip) → { downloaded, total, bytes }, MemorySource (pmtiles Source over ArrayBuffer)
├── mapStyle.ts       buildStyle(sources: {id,url|protocolUrl}[]) → maplibre StyleSpecification using @protomaps/basemaps dark layers, local glyphs/sprites
├── mapData.ts        stopsGeoJSON(content, date, done), parkedGeoJSON(content), legsGeoJSON(content, date), placesGeoJSON(places), fitBounds helper
├── places.ts         nearbyPlaces(lat, lng, key, fetchImpl) → Place[]; shouldRefetch(prev, now)
├── weather.ts        getDailyForecast(trip, lat, lng, key), getHourly(…), getCurrent(…) with IDB cache; pickDay(forecast, date)
└── state.ts          + useDayNotes(trip, date, client?) → { note, savedPlaces, savePlace(p), removePlace(id), setNote(text) }
src/screens/Map.tsx   lazy; owns the MapLibre instance; layers; geolocation; sheet; offline banner; download prompt
src/components/
├── MapSheet.tsx      details for stop / parked / place; Walk there; Save to notes
├── WeatherStrip.tsx  Day-screen strip
└── OfflineMapCard.tsx  More: size/status/download button
tests/lib/{geo,offlineMaps,mapStyle,mapData,places,weather}.test.ts, tests/app/{Map,WeatherStrip,OfflineMapCard}.test.tsx
```

---

### Task 1: Dependencies, assets, geo helpers, lazy route shell

**Files:** `package.json`, `vite.config.ts` (add `pbf` to `globPatterns`), `public/map/**`, `src/lib/geo.ts`, `tests/lib/geo.test.ts`, `src/App.tsx` (lazy `/map` with `Suspense` fallback), `src/screens/Map.tsx` (placeholder shell that renders "Map loading…" and a Close button, no maplibre yet), `src/components/TabBar.tsx` (hidden when `location.pathname.startsWith('/map')`), `src/styles/base.css`.

**Interfaces produced:**
- `haversineM(a: {lat,lng}, b): number`; `decodePolyline(encoded: string): [lng, lat][]` (GeoJSON order); `bboxOfPoints(points: [lng,lat][], padM = 200): [minLng, minLat, maxLng, maxLat]`; `distanceLabel(m: number): '850 m' | '1.2 km'`.
- Assets: run a script `scripts/fetch-map-assets.sh` (committed) that curls the glyph ranges `0-255,256-511,512-767,768-1023` for `Noto Sans Regular`, `Noto Sans Medium`, `Noto Sans Italic` and the `sprites/v4/dark*` files from `https://protomaps.github.io/basemaps-assets/` into `public/map/`. Commit the assets (≈1–2 MB).
- Tests: decode a known encoded polyline (`_p~iF~ps|U_ulLnnqC_mqNvxq\`@` → `[[-120.2,38.5],[-120.95,40.7],[-126.453,43.252]]`); haversine Lisbon→Sintra ≈ 25 km ±1; bbox padding; labels.

- [ ] Install: `npm i maplibre-gl@6 pmtiles@4 @protomaps/basemaps@5 @mapbox/polyline@1 && npm i -D @types/mapbox__polyline`. Run the asset script. Lazy route + Suspense. `npm run build` must show maplibre in its own chunk (`dist/assets/Map-*.js`), not in `index-*.js`. Commit `feat(map): deps, bundled basemap assets, geo helpers, lazy map route`.

---

### Task 2: Offline map store and PMTiles memory source

**Files:** `src/lib/offlineMaps.ts`, `tests/lib/offlineMaps.test.ts`, `src/components/OfflineMapCard.tsx`, `src/screens/More.tsx` (add the card under Tools), `tests/app/OfflineMapCard.test.tsx`.

**Interfaces:**
- `type Signer = (path: string) => Promise<string>` (default: `supabase.storage.from('maps').createSignedUrl(path, 3600)`).
- `downloadCityMaps(trip: string, areas: OfflineAreaRow[], signer: Signer, onProgress?: (done: number, total: number) => void, fetchImpl = fetch): Promise<void>` — for each area, fetch the signed URL, store the response in `caches.open('europe-guide-maps')` under the request key `/__maps/${trip}/${seq}.pmtiles`; throws on any non-OK response (partial downloads are kept).
- `getCachedMap(trip, seq): Promise<ArrayBuffer | null>`; `cachedMapStatus(trip, areas): Promise<{ downloaded: number; total: number; bytes: number }>`; `deleteCityMaps(trip)`.
- `class MemorySource implements pmtiles Source { constructor(buf: ArrayBuffer, key: string); getBytes(offset, length): Promise<{ data: ArrayBuffer }>; getKey(): string }`.
- `OfflineMapCard`: shows "Offline map — N of M areas, X MB" and a Download / Update / Delete button; progress text while downloading; error inline.
- Tests: with a fake `caches` (implement a minimal Cache/CacheStorage in the test or use a tiny polyfill object on `globalThis.caches`) — download stores 2 areas and reports progress; `getCachedMap` returns bytes; `MemorySource.getBytes` slices correctly; a 403 from the signed URL rejects and leaves earlier areas cached; status counts.
- Commit `feat(map): offline map download store and memory PMTiles source`.

---

### Task 3: Map style and GeoJSON builders

**Files:** `src/lib/mapStyle.ts`, `src/lib/mapData.ts`, `tests/lib/mapStyle.test.ts`, `tests/lib/mapData.test.ts`.

**Interfaces:**
- `buildStyle(sources: { id: string; url: string }[]): StyleSpecification` — one vector source per area (`type: 'vector', url: 'pmtiles://<key or signed url>'`), `layers` = `@protomaps/basemaps` `layers(sourceId, namedFlavor('dark'), { lang: 'en' })` for EACH source (layer ids suffixed by source id), `glyphs: '/europe-guide/map/fonts/{fontstack}/{range}.pbf'`, `sprite: '/europe-guide/map/sprites/v4/dark'`. Background colour `#202123`.
- `stopsGeoJSON(content, date, done: Set<string>)` → FeatureCollection of `stop` items with coords: props `{ id, n (1-based order), title: place_name ?? plan, time, done }`; `parkedGeoJSON(content)` → `{ id: 'parked:'+seq, title, what }`; `legsGeoJSON(content, date)` → LineStrings from `decodePolyline(leg.polyline)` for routes on that date (fallback: straight from→to when no polyline), props `{ route_id, seq }`; `placesGeoJSON(places: Place[])` → `{ id, title, rating, open }`.
- Tests against the Valle fixture (add `polyline` to one Valle leg in the fixture? No — fixtures are parsed md; instead build content in the test by cloning `loadValle()` and setting `legs[0].polyline`), plus a style test that asserts source count, glyph/sprite paths, and that layer ids are unique across two sources.
- Commit `feat(map): basemap style and GeoJSON builders`.

---

### Task 4: Map screen

**Files:** `src/screens/Map.tsx` (real), `src/components/MapSheet.tsx`, `src/styles/base.css`, `tests/app/Map.test.tsx`, `src/lib/state.ts` (+ `useDayNotes`), `tests/lib/state.test.ts` (+ tests).

**Behaviour:**
- On mount: read `content.areas`; `cachedMapStatus`; if all cached → build sources from `MemorySource` (register with `pmtiles` `Protocol.add(new PMTiles(source))`, url `pmtiles://<key>`); else if online → signed URLs for each area; else show "Offline map not downloaded" with a Download button (disabled offline) over a blank Coal background with markers still drawn (markers don't need tiles).
- First open online with nothing cached: show a non-blocking banner "Download the Lisbon offline map (12 MB)?" with Download / Later.
- Layers: legs (line, accent, width 4, opacity .8), parked (circle, muted, r 5), stops (circle accent r 9 with white number via `symbol` text-field `n`; done → muted), places (symbol "!" text in banana on a coral circle), user (circle columbia with white stroke, plus accuracy ring).
- Geolocation: `navigator.geolocation.watchPosition` with `enableHighAccuracy`, update the user source; a "Locate" button recentres and toggles follow mode; permission denied → small caption.
- Fit: on load, fit bounds to today's stops (or the city's first area bbox when none); "Today / All" toggle switches stops between the selected date and all days.
- Tap a stop/parked/place → `MapSheet` (reuses `Sheet`): title, subtitle (time / what / rating & open-now), details Md, **Walk there** (`walkLink`), for places **Save to notes** (`useDayNotes(trip, date).savePlace({ id, name, lat, lng })`) with "Saved" state.
- Offline banner: when `!navigator.onLine` or a tile `error` event fires and the map is on signed URLs, show "Offline — showing saved map" if cached, else "Offline — map tiles unavailable".
- Close button top-left → `navigate(-1)` (fallback `/day`). Tab bar hidden on `/map`; the Day screen's header gets a small "Map" button linking to `/map`.
- `useDayNotes(trip, date, client?)`: row in `day_notes` `(trip,date)`; `savedPlaces` JSON array; `savePlace` upserts with the appended place; `removePlace`; `setNote(text)` debounced 800 ms.
- Tests (maplibre mocked with a stub `Map` class recording `addSource/addLayer/setData/fitBounds/on`): renders Close; with all areas cached builds N `pmtiles://` sources; with none cached and offline shows the not-downloaded message; tapping a stop feature (invoke the recorded click handler with a fake feature) opens the sheet with the stop title and a Walk there link; `useDayNotes.savePlace` upserts the appended array.
- Commit `feat(map): full-screen map with offline tiles, markers, legs, location and sheet`.

---

### Task 5: Places "!" layer

**Files:** `src/lib/places.ts`, `tests/lib/places.test.ts`, `src/screens/Map.tsx` (wire), `src/components/MapSheet.tsx` (place details + photo).

**Interfaces:**
- `type Place = { id: string; name: string; lat: number; lng: number; rating: number | null; ratingCount: number | null; openNow: boolean | null; types: string[]; photoName: string | null; address: string | null }`.
- `nearbyPlaces(lat, lng, key, fetchImpl = fetch): Promise<Place[]>` — POST `https://places.googleapis.com/v1/places:searchNearby` with headers `X-Goog-Api-Key`, `X-Goog-FieldMask: places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.currentOpeningHours.openNow,places.types,places.photos,places.formattedAddress`; body `{ includedTypes: ['tourist_attraction','historical_landmark','museum','art_gallery','church','monument','cafe','bakery','book_store','gift_shop','viewpoint' as allowed by the API — use the documented types: tourist_attraction, historical_landmark, museum, art_gallery, church, cafe, bakery, book_store, gift_shop, park], excludedTypes: ['lodging','bank','atm','gas_station','parking'], maxResultCount: 20, rankPreference: 'DISTANCE', locationRestriction: { circle: { center, radius: 300 } } }`; filter `rating >= 4.2 && ratingCount >= 50` (keep unrated landmarks); map to `Place`; throw with status text on non-OK (caller catches and hides the layer).
- `shouldRefetch(prev: { lat,lng,at } | null, now: { lat,lng,at }): boolean` — true when no prev, or moved ≥150 m and ≥60 s elapsed.
- `photoUrl(photoName, key, maxWidth = 480)` → `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=480&key=…`.
- Map wiring: on each position update, if `shouldRefetch` → `nearbyPlaces`, merge into a session `Map<id, Place>`, update the places source (cap 20 nearest). A "!" toggle button hides the layer. Sheet for a place shows photo (lazy `<img>`), rating, open now, address, Walk there, Save to notes.
- Tests: request shape (headers, field mask, radius, rankPreference) via fetchImpl; filtering; `shouldRefetch` thresholds; error → rejects.
- Commit `feat(map): nearby Places layer`.

---

### Task 6: Weather

**Files:** `src/lib/weather.ts`, `tests/lib/weather.test.ts`, `src/components/WeatherStrip.tsx`, `tests/app/WeatherStrip.test.tsx`, `src/screens/Day.tsx` (strip under the header), `src/lib/db.ts` (+ `weather` store, bump DB version to 2 with upgrade).

**Interfaces:**
- `getDailyForecast(trip: TripRow, lat, lng, key, opts?: { fetchImpl?, now?: Date, client? }): Promise<DailyForecast>` — GET `https://weather.googleapis.com/v1/forecast/days:lookup?key=&location.latitude=&location.longitude=&days=10&unitsSystem=METRIC`; map to `{ fetchedAt, days: { date: 'YYYY-MM-DD'; hi: number; lo: number; precipPct: number; condition: string; iconUri: string | null; sunrise?: string; sunset?: string }[] }` using the trip timezone to derive `date` from `displayDate`/`interval`.
- `getHourly(trip, lat, lng, key, opts?)` → next 24 h `{ time: 'HH:MM', temp, precipPct, condition, iconUri }[]` in trip tz; `getCurrent(...)` → `{ temp, feelsLike, condition, iconUri, humidity, windKph }`.
- Cache: IDB store `weather` keyed `${trip}:${kind}` with `fetchedAt`; serve cached when < 60 min old or when the fetch fails (mark `stale: true`).
- `pickDay(forecast, date)` → the day entry or null.
- City coordinates: centroid of `content.items` with coords for the selected date, else the first `offline_areas` bbox centre.
- `WeatherStrip({ trip, date, lat, lng })`: for `date`: icon (img from `iconUri` + `.svg`, fallback emoji by condition), condition text, `hi° / lo°`, `☂ NN%`; when `date` is today, an hourly row (next 8 hours: HH, icon, temp); when the date is beyond the forecast window: "Forecast opens on <date − 10 days>"; when stale: "as of HH:MM"; when the key is missing: renders nothing. Left-aligned, one line on 390 px plus the hourly scroller.
- Tests: mapping from a captured sample response shape (write the fixture JSON by hand from the documented response: `forecastDays[].displayDate {year,month,day}`, `maxTemperature.degrees`, `minTemperature.degrees`, `daytimeForecast.precipitation.probability.percent`, `daytimeForecast.weatherCondition.description.text`, `weatherCondition.iconBaseUri`); cache hit avoids fetch; stale fallback on fetch failure; `pickDay`; strip renders hi/lo and the "opens on" message for a far date.
- Commit `feat(weather): daily/hourly forecast strip on Day`.

---

### Task 7: Deploy, phone checklist, notes

- [ ] `npm test`, `npm run build` (check chunk split), merge to `main`, confirm deploy.
- [ ] Phone checklist: More → Download offline map (progress, then "8 of 8"); Map opens full screen with today's numbered stops and the walking lines; airplane mode → Map still renders tiles and labels; Locate shows the blue dot; tap a stop → sheet → Walk there; "!" markers appear after walking ~150 m outdoors (or emulate by toggling location in Safari dev); Day shows the weather strip for 29 Sep once within 10 days (from 19 Sep) and "Forecast opens" before that.
- [ ] Write `docs/superpowers/plans/2026-09-15-plan-3-notes.md` with rulings and deferred items; carry Home/Places-on-Home/write-queue into Plan 4.

## Self-review
- Spec §4 Map: full screen ✔ (T4), stops/legs/parked/"!"/user ✔ (T3–T5), bottom sheet with Walk there + Save to notes ✔ (T4/T5), offline banner ✔ (T4); §4 Weather ✔ (T6); §2 single engine ✔; §7 map file per city on demand with size ✔ (T2); offline parity incl. glyphs/sprites ✔ (T1/T3).
- Interfaces: `MemorySource`/`downloadCityMaps` (T2) consumed by T4; `buildStyle`/GeoJSON builders (T3) by T4; `nearbyPlaces`/`shouldRefetch` (T5) by T4 wiring; `useDayNotes` defined in T4 and used by T5's sheet; `decodePolyline` (T1) by T3.
- Risks named: Places `includedTypes` must be valid Table A types (implementer verifies against the API docs and adjusts the list); Weather response field names are from the public docs — the first live call in T6 must confirm them and the mapping test fixture must be corrected if they differ.
