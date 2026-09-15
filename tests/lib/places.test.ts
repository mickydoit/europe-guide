import { describe, test, expect, vi } from 'vitest'
import {
  nearbyPlaces, placePhoto, shouldRefetch, photoUrl, nearestN, INCLUDED_TYPES, EXCLUDED_TYPES,
} from '../../src/lib/places'

function rawPlace(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    displayName: { text: 'Café X' },
    location: { latitude: 38.71, longitude: -9.14 },
    rating: 4.5,
    userRatingCount: 200,
    currentOpeningHours: { openNow: true },
    types: ['cafe'],
    photos: [{ name: 'places/p1/photos/abc' }],
    formattedAddress: '1 Rua X',
    ...overrides,
  }
}

describe('nearbyPlaces request shape', () => {
  test('POSTs searchNearby with the documented headers and body', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(JSON.stringify({ places: [] }), { status: 200 })
    })

    await nearbyPlaces(38.71, -9.14, 'test-key', fetchImpl as unknown as typeof fetch)

    expect(captured).not.toBeNull()
    expect(captured!.url).toBe('https://places.googleapis.com/v1/places:searchNearby')
    expect(captured!.init.method).toBe('POST')

    const headers = captured!.init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['X-Goog-Api-Key']).toBe('test-key')
    const mask = headers['X-Goog-FieldMask']
    expect(mask).toBe(
      'places.id,places.displayName,places.location,places.rating,places.userRatingCount,'
      + 'places.currentOpeningHours.openNow,places.types,places.formattedAddress',
    )
    expect(mask).not.toContain('places.photos')

    const body = JSON.parse(captured!.init.body as string)
    expect(body.rankPreference).toBe('DISTANCE')
    expect(body.maxResultCount).toBe(20)
    expect(body.locationRestriction).toEqual({
      circle: { center: { latitude: 38.71, longitude: -9.14 }, radius: 300 },
    })
    expect(body.includedTypes).toEqual(INCLUDED_TYPES)
    expect(body.excludedTypes).toEqual(EXCLUDED_TYPES)
  })

  test('rejects with the HTTP status on a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => new Response('Forbidden', { status: 403 }))
    await expect(nearbyPlaces(0, 0, 'k', fetchImpl as unknown as typeof fetch))
      .rejects.toThrow(/HTTP 403/)
  })
})

describe('nearbyPlaces filtering', () => {
  test('keeps a rated cafe, drops a low-rated cafe, keeps an unrated historical landmark', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      places: [
        rawPlace({ id: 'good-cafe', rating: 4.5, userRatingCount: 200 }),
        rawPlace({ id: 'bad-cafe', rating: 3.9, userRatingCount: 500, displayName: { text: 'Low Cafe' } }),
        rawPlace({
          id: 'landmark', rating: undefined, userRatingCount: undefined,
          types: ['historical_landmark'], displayName: { text: 'Old Tower' }, photos: undefined,
        }),
      ],
    }), { status: 200 }))

    const places = await nearbyPlaces(38.71, -9.14, 'k', fetchImpl as unknown as typeof fetch)

    expect(places.map(p => p.id)).toEqual(['good-cafe', 'landmark'])
    const landmark = places.find(p => p.id === 'landmark')!
    expect(landmark.rating).toBeNull()
    expect(landmark.photoName).toBeNull()
    // Photos are dropped from the search field mask, so photoName is always null from
    // search even when the raw payload happens to carry a photos array.
    const goodCafe = places.find(p => p.id === 'good-cafe')!
    expect(goodCafe.photoName).toBeNull()
  })

  test('drops a rated place below the 50-review floor', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      places: [rawPlace({ id: 'few-reviews', rating: 4.8, userRatingCount: 10 })],
    }), { status: 200 }))

    const places = await nearbyPlaces(38.71, -9.14, 'k', fetchImpl as unknown as typeof fetch)
    expect(places).toEqual([])
  })
})

describe('shouldRefetch', () => {
  test('true with no previous query', () => {
    expect(shouldRefetch(null, { lat: 0, lng: 0, at: 0 })).toBe(true)
  })

  test('false at ~100 m / 120 s (distance below the 150 m threshold)', () => {
    const prev = { lat: 38.71, lng: -9.14, at: 0 }
    const now = { lat: 38.7109, lng: -9.14, at: 120_000 }
    expect(shouldRefetch(prev, now)).toBe(false)
  })

  test('false at ~200 m / 30 s (elapsed time below the 60 s threshold)', () => {
    const prev = { lat: 38.71, lng: -9.14, at: 0 }
    const now = { lat: 38.7118, lng: -9.14, at: 30_000 }
    expect(shouldRefetch(prev, now)).toBe(false)
  })

  test('true at ~200 m / 90 s (both thresholds met)', () => {
    const prev = { lat: 38.71, lng: -9.14, at: 0 }
    const now = { lat: 38.7118, lng: -9.14, at: 90_000 }
    expect(shouldRefetch(prev, now)).toBe(true)
  })
})

describe('placePhoto', () => {
  test('GETs Place Details with the photos field mask, id form without the "places/" prefix', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(JSON.stringify({ photos: [{ name: 'places/abc/photos/1' }] }), { status: 200 })
    })

    const name = await placePhoto('ChIJabc', 'test-key', fetchImpl as unknown as typeof fetch)

    expect(captured).not.toBeNull()
    expect(captured!.url).toBe('https://places.googleapis.com/v1/places/ChIJabc')
    expect(captured!.init.method).toBe('GET')
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-Goog-Api-Key']).toBe('test-key')
    expect(headers['X-Goog-FieldMask']).toBe('photos')
    expect(name).toBe('places/abc/photos/1')
  })

  test('GETs Place Details with the id form that already carries the "places/" prefix', async () => {
    let captured: { url: string } | null = null
    const fetchImpl = vi.fn(async (url: string) => {
      captured = { url }
      return new Response(JSON.stringify({ photos: [{ name: 'places/abc/photos/1' }] }), { status: 200 })
    })

    await placePhoto('places/ChIJabc', 'test-key', fetchImpl as unknown as typeof fetch)

    expect(captured!.url).toBe('https://places.googleapis.com/v1/places/ChIJabc')
  })

  test('returns null when the place has no photos', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
    const name = await placePhoto('places/ChIJabc', 'k', fetchImpl as unknown as typeof fetch)
    expect(name).toBeNull()
  })

  test('rejects with the HTTP status on a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => new Response('Forbidden', { status: 403 }))
    await expect(placePhoto('places/ChIJabc', 'k', fetchImpl as unknown as typeof fetch))
      .rejects.toThrow(/HTTP 403/)
  })
})

describe('photoUrl', () => {
  test('builds a media URL with maxWidthPx and the key', () => {
    expect(photoUrl('places/p1/photos/abc', 'mykey')).toBe(
      'https://places.googleapis.com/v1/places/p1/photos/abc/media?maxWidthPx=480&key=mykey',
    )
  })

  test('honours a custom maxWidth', () => {
    expect(photoUrl('places/p1/photos/abc', 'mykey', 200)).toBe(
      'https://places.googleapis.com/v1/places/p1/photos/abc/media?maxWidthPx=200&key=mykey',
    )
  })
})

describe('nearestN', () => {
  test('sorts by distance and caps at n', () => {
    const base = {
      rating: null, ratingCount: null, openNow: null, types: [], photoName: null, address: null,
    }
    const far = { ...base, id: 'far', name: 'Far', lat: 38.72, lng: -9.14 }
    const near = { ...base, id: 'near', name: 'Near', lat: 38.7101, lng: -9.14 }
    const mid = { ...base, id: 'mid', name: 'Mid', lat: 38.712, lng: -9.14 }

    const result = nearestN([far, near, mid], 38.71, -9.14, 2)
    expect(result.map(p => p.id)).toEqual(['near', 'mid'])
  })
})
