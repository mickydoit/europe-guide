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
    const current = cat.typeWeight[v.primary_type] ?? (cat.thin ? THIN_WEIGHT : v.vote > 0 ? 1 / TYPE_SATURATION : 0)
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
  const weights = types.filter(t => SETS[category].has(t)).map(t => { const w = cat.typeWeight[t] ?? 0; return cat.thin ? Math.max(w, THIN_WEIGHT) : w })
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

/** What the profile learned, one line per category, for More → Diagnostics. */
export function summariseProfile(p: TasteProfile): string[] {
  const line = (c: Category) => {
    const cat = p[c]
    if (cat.n === 0) return p.empty ? `${c} · 0 places · thin — using the pre-profile rule` : `${c} · 0 places (thin)`
    const top = Object.entries(cat.typeWeight).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([t, w]) => `${t} (${w.toFixed(2)})`).join(', ')
    const parts = [`${c} · ${cat.n} places${cat.thin ? ' (thin)' : ''}`, `top: ${top}`]
    if (cat.countP75 != null) parts.push(`reviews ≤ ${cat.countP75.toLocaleString('en-GB')}`)
    if (cat.minRating != null) parts.push(`rating ≥ ${cat.minRating}`)
    return parts.join(' · ')
  }
  return [line('eat'), line('shop'), line('see'), `votes · ${p.votes}`]
}
