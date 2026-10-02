import fixture from '../fixtures/lisbon-place-meta.json'
import { buildProfile, scorePlace, categoryOf, THRESHOLD, THIN_WEIGHT, summariseProfile } from '../../src/lib/taste'
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
    expect(scorePlace(place('portuguese_restaurant', ['portuguese_restaurant', 'restaurant', 'food'], 4.6, 300), P).score).toBeCloseTo(1, 10)
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
    expect(scorePlace(place('monument', ['monument', 'tourist_attraction'], 4.5, 117345), P).score).toBeCloseTo(1, 10)
    expect(pass(scorePlace(place('park', ['park'], 4.6, 3000), P))).toBe(false)
  })
  test('unrated: a landmark-type sight passes at 0.5, an unrated café scores 0', () => {
    expect(scorePlace(place('church', ['church', 'place_of_worship'], null, null), P).score).toBeCloseTo(0.5, 10)
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
  test('an up-vote on a type never chosen seeds it, so a save counts as one choice', () => {
    const votes: PlaceVoteRow[] = [{ place_id: 'new', primary_type: 'wine_bar', vote: 1, voted_at: '2026-09-29T00:00:00Z' }]
    const V = buildProfile(rows, votes)
    expect(V.eat.typeWeight.wine_bar).toBeCloseTo((1 / 3) * 1.3)
  })
  test('thin category: any type in the category lookup counts as THIN_WEIGHT', () => {
    const T = buildProfile(rows.filter(r => r.primary_type !== 'clothing_store' && r.primary_type !== 'store' && r.primary_type !== 'manufacturer' && r.primary_type !== 'home_goods_store'))
    expect(T.shop.n).toBeLessThan(5); expect(T.shop.thin).toBe(true)
    expect(scorePlace(place('jewelry_store', ['jewelry_store', 'store'], 4.7, 80), T).score).toBeCloseTo(THIN_WEIGHT)
    // A type the owner actually chose must not score below a type they never picked.
    expect(scorePlace(place('book_store', ['book_store', 'store'], 4.7, 80), T).score).toBeGreaterThanOrEqual(THIN_WEIGHT)
  })
  test('empty profile falls back to the legacy rule: rating ≥ 4.2 with ≥ 50 reviews, or an unrated landmark', () => {
    const E = buildProfile([])
    expect(scorePlace(place('cafe', ['cafe'], 4.5, 200), E).score).toBeCloseTo(1, 10)
    expect(scorePlace(place('cafe', ['cafe'], 4.0, 200), E).score).toBe(0)
    expect(scorePlace(place('cafe', ['cafe'], 4.5, 20), E).score).toBe(0)
    expect(scorePlace(place('church', ['church'], null, null), E).score).toBeCloseTo(1, 10)
  })
})

describe('summariseProfile', () => {
  test('summariseProfile prints one line per category and the vote count', () => {
    const lines = summariseProfile(P)
    expect(lines).toHaveLength(4)
    // weight desc, then alphabetical: the three weight-1 types first, then the first two of the 2/3-weight types
    expect(lines[0]).toBe('eat · 13 places · top: cafe (1.00), coffee_shop (1.00), restaurant (1.00), bakery (0.67), bar (0.67) · reviews ≤ 3,371 · rating ≥ 4.3')
    expect(lines[2]).toMatch(/^see · 6 places · top: museum \(1\.00\), tourist_attraction \(1\.00\)/)
    expect(lines[3]).toBe('votes · 0')
    expect(summariseProfile(buildProfile([]))[0]).toBe('eat · 0 places · thin — using the pre-profile rule')
  })
  test('a category with zero chosen places in an otherwise non-empty profile reads as thin, not as the pre-profile rule', () => {
    const noShop = buildProfile(rows.filter(r => categoryOf(r.primary_type, r.types) !== 'shop'))
    expect(summariseProfile(noShop)[1]).toBe('shop · 0 places (thin)')
  })
})
