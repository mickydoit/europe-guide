# Taste profile for the map's "!" discoveries — design

Date: 29 September 2026. Status: draft for owner review.

## Problem

The Map screen marks nearby Google Places discoveries with a "!" (spec of 14 Sep, "Map" section). Today the only filter is a fixed list of ten place types plus a floor of rating ≥ 4.2 and ≥ 50 reviews (`src/lib/places.ts`, `keep()`). That filter has no idea what the owner likes, so a tourist-trap café on a main square with 8,000 reviews and a 4.3 rating earns a "!" while a 200-review neighbourhood tasca does not, and restaurants are not searched for at all.

The owner's own itineraries already encode their taste: across Lisbon, Seville, Barcelona and Istanbul roughly 250 chosen places, plus the parked venues they researched. This design turns that into a profile the map uses to decide which discoveries deserve a "!". The owner's decision (29 Sep): places that score poorly are **not shown** with a "!"; they are simply absent.

## Evidence from a spike (29 Sep, Lisbon)

Google Place Details were fetched for 32 Lisbon stops. Findings that shape the design:

- Chosen places to **eat and drink** are mostly `restaurant`, `portuguese_restaurant`, `breakfast_restaurant`, `cafe`, `coffee_shop`, `pastry_shop`, `bar`; ratings mostly ≥ 4.5; review counts 100–4,000 (median ≈ 1,500); price level moderate to expensive, never cheap or unset.
- Chosen **shops** are `clothing_store`, `store`, `home_goods_store`, `book_store`, `manufacturer` (Sant'Anna), `flea_market`; review counts 100–8,000.
- Chosen **sights** are `museum`, `monument`, `church`; review counts 12,000–117,000.

So review count is a tourist-trap signal only *within a category*: 60,000 reviews is normal for a sight and absurd for a tasca. The profile is therefore built per category, not globally.

## Goals and non-goals

Goals:
- A "!" appears only for discoveries that resemble what the owner has already chosen, in the same category.
- The model is deterministic, explainable in one screen, and works from data already cached offline. No server, no LLM, no new keys.
- The owner can correct it from the place sheet with one tap, and corrections survive being offline.

Non-goals:
- Changing which places are *searched* beyond widening the type list to include restaurants, bars and shops.
- Personalising anything other than the "!" layer (Day, Home, Tickets are untouched).
- Cross-owner or cross-device learning beyond what the existing state tables already give.

## Design

### 1. Place metadata at import

`scripts/import/geocode.ts` already resolves every stop and parked venue to a `geocode_cache` row with a `place_id`. Extend that pass: for each row whose metadata is missing, call Place Details for `primaryType, types, priceLevel, rating, userRatingCount` and store them on the cache row (new nullable columns `primary_type text, types text[], price_level text, rating numeric, rating_count int, meta_fetched_at timestamptz`). Details is called once per place ever; re-imports read the cache.

The same pass copies the five values onto the `items` and `parked_venues` rows being imported (new nullable columns of the same names). `import_city` needs no change: it populates records from JSON, so new columns flow through once the migration adds them.

Cost: about 300 Details calls across the five trips, once, at roughly $0.02 each. Every city must be re-imported once (`--skip-maps --skip-photos`) to fill the columns; until then that city contributes nothing to the profile and the map falls back to the current rule (see §5).

### 2. The profile: a pure function in the app

New module `src/lib/taste.ts`.

```
buildProfile(rows: PlaceMeta[], votes: PlaceVote[]): TasteProfile
scorePlace(place: Place, profile: TasteProfile): { score: number; category: Category | null }
```

`PlaceMeta` is the five metadata fields from any item or parked venue that has them. `Category` is `eat | shop | see`, derived from `primary_type` (fallback: first matching entry in `types`) via a fixed lookup table in the module; unknown types are ignored.

`TasteProfile` holds, per category:
- `typeWeight`: for each Google type in the category's own lookup table seen among chosen places, `min(1, timesChosen / 3)`. A type chosen three or more times is fully trusted; generic types (`point_of_interest`, `food`, a café's `store`) never count. (Simulated on the Lisbon data: "share of the most common type" starved cafés because restaurants dominate; saturation treats every kind of place the owner keeps choosing as equally wanted.)
- `countP75`: nearest-rank 75th percentile of `rating_count` among chosen places (eat and shop only).
- `minRating`: nearest-rank 25th percentile of chosen `rating`, floored at 4.0 (eat and shop only).
- `n`: how many chosen places fed the category. A category with `n < 5` is marked `thin`.

Votes (§4) adjust the profile after it is built: each down-vote on a type multiplies that type's weight by 0.7; each save multiplies by 1.3 (capped at 1). A down-voted `place_id` is stored in `profile.hidden`.

Rows come from **every trip**, not just the city on screen: `fetchAllPlaceMeta()` in `src/lib/data.ts` selects the five columns from `items` and `parked_venues` across trips (a few hundred short rows), fetched with the trips list and cached in IndexedDB beside `allAreas`, so the profile exists offline.

### 3. Scoring

`scorePlace` returns 0 for: no category; `place_id` in `hidden`; any type in a short hard-avoid list (`fast_food_restaurant`, `meal_takeaway`, `steak_house`, `night_club`, `amusement_center`, `casino`). Otherwise:

- `affinity` = the largest weight among the place's types (primary type included). A place none of whose types appear in the profile scores 0.
- `ratingTerm` (eat, shop) = clamp((rating − minRating + 0.2) / 0.5, 0, 1): full marks 0.3 stars above the owner's floor, nothing 0.2 stars below it. Unrated eat/shop places score 0. For see, `ratingTerm` = 1; an unrated sight of a landmark type (`tourist_attraction`, `historical_landmark`, `church`, `museum`) scores at least 0.5.
- `crowdPenalty` (eat, shop) = 0 while `rating_count ≤ countP75`, rising linearly to 1 at 4 × countP75. For see, 0.
- `score = affinity × ratingTerm × (1 − crowdPenalty)`.

A discovery earns a "!" when `score ≥ 0.45`. The threshold is one exported constant with a comment. Simulated on the Lisbon spike data (29 Sep): Falta Café 1.0, Isco 1.0, a 4.6 tasca with 300 reviews 1.0, a 4.4 café with 600 reviews 0.6, wetheknot 1.0, Belém Tower 1.0 all pass; A Brasileira (cafe, 10,535 reviews, 4.2) 0.06, a 4.3 restaurant with 8,000 reviews 0.22, a 4.3 gift shop with 5,000 reviews 0.0, and Manteigaria-shaped input (10,923 reviews) 0.17 all fail.

`nearbyPlaces()` keeps its request shape but widens `INCLUDED_TYPES` to add `restaurant`, `bar`, `coffee_shop`, `market`, `clothing_store`, `home_goods_store` (not `shopping_mall`). The response filter `keep()` is replaced by `scorePlace(...) ≥ THRESHOLD`; the Map effect passes the current profile in. The map layer, sheet and save flow are otherwise unchanged.

### 4. Learning from the sheet

`MapSheet` gains a "Not for us" button for `kind === 'place'`, beside "Save to notes". Tapping it:
- hides the marker at once (`placesRef` entry removed, layer re-set),
- enqueues an outbox op `place_vote` `{ placeId, primaryType, vote: -1 }`, flushed to a new table `place_votes (place_id text primary key, owner uuid, primary_type text, vote smallint, voted_at timestamptz)` with the same owner-only RLS as `item_checks`.

"Save to notes" additionally enqueues `{ vote: +1 }`. A `usePlaceVotes()` hook mirrors `useChecks()`: server rows, then pending outbox ops on top, so a vote made with no signal counts immediately and survives relaunch.

### 5. Fallbacks

- No metadata yet for any trip (nothing re-imported): `buildProfile` returns a profile with every category `thin`; `scorePlace` then applies the old rule (rating ≥ 4.2, ≥ 50 reviews, old type list) so behaviour is unchanged until the first re-import.
- A single `thin` category (e.g. only 3 chosen shops) uses a relaxed affinity: any type in the category's lookup table counts as weight 0.6, so the map still shows shops rather than none.
- Places API failure, offline, or no key: exactly as today (layer stays as it was).

### 6. Seeing what it learned

More → Diagnostics gets a "Taste" block: per category, the top five types with weights, the review band, the rating floor, `n`, and the number of votes. This is the only UI besides the sheet button, and it is what the owner reads if the map goes quiet or noisy.

## Data changes

- Migration `20260929000008_taste.sql`: five nullable columns on `items`, `parked_venues`, `geocode_cache` (plus `meta_fetched_at` on the cache); table `place_votes` with owner RLS.
- `CityContent` unchanged; `ItemRow`/`ParkedRow` types gain the optional fields; new `PlaceMeta`, `PlaceVote`, `TasteProfile` types in `src/lib/types.ts`.
- IndexedDB: a new `placeMeta` store alongside `areas`, filled by the trips fetch.
- Outbox: new kind `place_vote`.

## Files

- `scripts/import/geocode.ts` (Details fetch + cache columns), `scripts/import/cli.ts` (wire-up), `scripts/import/types.ts`.
- `src/lib/taste.ts` (new), `src/lib/places.ts` (types list, filter hook-in), `src/lib/data.ts`, `src/lib/db.ts`, `src/lib/state.ts` (`usePlaceVotes`), `src/lib/outbox.ts`, `src/lib/sync.ts` (flush handler), `src/lib/types.ts`.
- `src/screens/Map.tsx` (pass profile, handle hide), `src/components/MapSheet.tsx` (button), `src/screens/More.tsx` (Diagnostics block).
- `supabase/migrations/…_taste.sql`.

## Testing

- `tests/lib/taste.test.ts`: `buildProfile` from a committed fixture of the 32 Lisbon spike rows (names, types, counts — nothing private); expected bands and top types asserted. `scorePlace`: A Brasileira-shaped input below threshold, Falta-shaped above, Belém Tower-shaped above despite 117k reviews, fast-food 0, hidden id 0, vote dampening, `thin` fallback to the old rule.
- `tests/lib/places.test.ts`: request body includes the widened types; filter now delegates to the profile.
- `tests/import/geocode.test.ts`: Details called once per place with the five-field mask, cache hit skips the call, missing fields stay null.
- `tests/lib/state.test.ts`: `usePlaceVotes` overlays outbox ops like `useChecks`.
- Manual: re-import Lisbon, open the map in Alfama at Portas do Sol, confirm the tourist restaurants on the square have no "!" and the tascas in the lanes do; tap "Not for us" offline, relaunch, confirm it stays hidden.

## Rollout

1. Migration, importer change, re-import Lisbon (the city they are in) first; other cities as convenient.
2. App change ships behind nothing: with no metadata it behaves as today.
3. Threshold and the 0.7 / 1.3 vote factors are constants; tune from Diagnostics after two days of use.
