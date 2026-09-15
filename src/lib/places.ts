import { haversineM } from './geo'

export interface Place {
  id: string
  name: string
  lat: number
  lng: number
  rating: number | null
  ratingCount: number | null
  openNow: boolean | null
  types: string[]
  photoName: string | null
  address: string | null
}

// Places API (New) Table A types only.
export const INCLUDED_TYPES = [
  'tourist_attraction', 'historical_landmark', 'museum', 'art_gallery', 'church',
  'cafe', 'bakery', 'book_store', 'gift_shop', 'park',
]
export const EXCLUDED_TYPES = ['lodging', 'bank', 'atm', 'gas_station', 'parking']

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchNearby'
// places.photos is deliberately excluded: it's billed per photo on every search hit,
// and most results are never opened. placePhoto() fetches it lazily from Place Details
// only for the one place a sheet actually opens.
const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.location', 'places.rating', 'places.userRatingCount',
  'places.currentOpeningHours.openNow', 'places.types', 'places.formattedAddress',
].join(',')
const DETAILS_FIELD_MASK = 'photos'
const RADIUS_M = 300
// Unrated places are still worth surfacing when they're a landmark-ish type.
const UNRATED_KEEP_TYPES = new Set(['tourist_attraction', 'historical_landmark', 'church', 'museum'])

interface RawPlace {
  id?: string
  displayName?: { text?: string }
  location?: { latitude?: number; longitude?: number }
  rating?: number
  userRatingCount?: number
  currentOpeningHours?: { openNow?: boolean }
  types?: string[]
  formattedAddress?: string
}

function keep(p: RawPlace): boolean {
  if ((p.rating ?? 0) >= 4.2 && (p.userRatingCount ?? 0) >= 50) return true
  if (p.rating == null) {
    return (p.types ?? []).some(t => UNRATED_KEEP_TYPES.has(t))
  }
  return false
}

function mapPlace(p: RawPlace): Place {
  return {
    id: p.id ?? '',
    name: p.displayName?.text ?? '',
    lat: p.location?.latitude ?? 0,
    lng: p.location?.longitude ?? 0,
    rating: p.rating ?? null,
    ratingCount: p.userRatingCount ?? null,
    openNow: p.currentOpeningHours?.openNow ?? null,
    types: p.types ?? [],
    // Photos are no longer part of the nearby search response; a sheet fetches one
    // lazily via placePhoto() when the place is actually opened.
    photoName: null,
    address: p.formattedAddress ?? null,
  }
}

export async function nearbyPlaces(
  lat: number,
  lng: number,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Place[]> {
  const res = await fetchImpl(SEARCH_URL, {
    referrerPolicy: 'no-referrer-when-downgrade',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: INCLUDED_TYPES,
      excludedTypes: EXCLUDED_TYPES,
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: RADIUS_M } },
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`places HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = await res.json() as { places?: RawPlace[] }
  return (json.places ?? []).filter(keep).map(mapPlace)
}

export function shouldRefetch(
  prev: { lat: number; lng: number; at: number } | null,
  now: { lat: number; lng: number; at: number },
): boolean {
  if (!prev) return true
  return haversineM(prev, now) >= 150 && now.at - prev.at >= 60_000
}

// Place ids from search come back as `places/ChIJ…`. The Details endpoint path is
// `/v1/{id}` when the id already carries that prefix, and `/v1/places/{id}` when it
// doesn't — handle both so callers can pass either form.
function detailsUrl(placeId: string): string {
  if (placeId.startsWith('places/')) return `https://places.googleapis.com/v1/${placeId}`
  return `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`
}

export async function placePhoto(
  placeId: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const res = await fetchImpl(detailsUrl(placeId), {
    method: 'GET',
    referrerPolicy: 'no-referrer-when-downgrade',
    headers: {
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': DETAILS_FIELD_MASK,
    },
  })
  if (!res.ok) {
    throw new Error(`place details HTTP ${res.status}`)
  }
  const json = await res.json() as { photos?: { name?: string }[] }
  return json.photos?.[0]?.name ?? null
}

export function photoUrl(photoName: string, key: string, maxWidth = 480): string {
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidth}&key=${key}`
}

export function nearestN(places: Place[], lat: number, lng: number, n = 20): Place[] {
  return [...places]
    .sort((a, b) => haversineM({ lat, lng }, a) - haversineM({ lat, lng }, b))
    .slice(0, n)
}
