import type { SupabaseClient } from '@supabase/supabase-js'
import type { BookingRow, CityContent, ItemRow } from './types'
// The app's own ticket heuristics are the single source of truth for "this booking is a
// journey, not a venue" (TRANSPORT_RE + the flight-code/carrier rules live there).
import { inferKind, stopForBooking } from '../../src/lib/tickets'

export interface PhotoTarget {
  /** The id of the row this target writes back to — how a shared booking finds its stop. */
  id: string
  path: string
  query: string
  lat: number | null
  lng: number | null
  set(path: string | null, credit: string | null): void
  get(): { path: string | null; credit: string | null }
}
/** A booking that names a stop we are already searching for: it copies that stop's photo. */
export interface SharedPhoto { booking: BookingRow; stopId: string }
export interface PhotoPlan { targets: PhotoTarget[]; shared: SharedPhoto[] }
export interface PlacesPhoto { placeId: string; photoName: string; credit: string | null }
export interface PhotoStore {
  exists(path: string): Promise<boolean>
  upload(path: string, bytes: Uint8Array): Promise<void>
  cacheGet(path: string): Promise<PlacesPhoto | null>
  cacheSet(path: string, v: PlacesPhoto): Promise<void>
}

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
const FIELD_MASK = 'places.id,places.photos.name,places.photos.authorAttributions.displayName'
const WIDTH = 800
/** Text Search answers anything, so an admin chore titled like one must never be asked. */
const CHORE_RE = /^(confirm|reconfirm|decide|book|lisboa card|airport)\b/i

/**
 * "At the meeting point", "decision needed", "Alfama wander", "Triana ceramic streets": a phrase
 * of several words with no capital letter or digit after the first character is a description,
 * not a venue name — Text Search would still answer it with some nearby business. Single words
 * (Prado, Miolo) and anything with an address are kept.
 */
export function looksGeneric(name: string): boolean {
  const words = name.trim().split(/\s+/)
  return words.length > 1 && !/[A-Z0-9]/.test(name.trim().slice(1))
}
/** After this many refusals in a row the key or the quota is wrong, not the query. */
const REFUSAL_LIMIT = 3
const REFUSAL_RE = /HTTP (403|429)/

function safeId(id: string): string { return id.replace(/[^A-Za-z0-9_-]/g, '_') }

/** Row ids already start with the trip slug; the path must not repeat it. */
function pathFor(slug: string, id: string): string {
  const rest = id.startsWith(`${slug}/`) ? id.slice(slug.length + 1) : id
  return `${slug}/${safeId(rest)}.jpg`
}

/** The venue name a booking is about: everything before the first em/en-dash clause. */
function bookingName(b: BookingRow): string { return b.title.split(/ — | - /)[0].trim() }

/**
 * What to photograph, and what to copy.
 *
 * A Text Search always answers, and the answer is then cached forever — so a target is only
 * worth creating when the row really names a place. Items must have both a `place_name` and a
 * geocoded point (a geocode miss means the name was not a place). Bookings must not be a
 * walk-in, a journey, an admin chore or an undecided choice, and must either carry an address
 * or be an event whose name is more than one word. A booking that names a stop we are already
 * searching for is not searched at all: it shares that stop's photo (`shared`).
 */
export function photoTargets(content: CityContent, cityHint: string): PhotoPlan {
  const slug = content.trip.slug
  const targets: PhotoTarget[] = []
  const shared: SharedPhoto[] = []
  const places = content.items.filter(
    (i): i is ItemRow => (i.kind === 'stop' || i.kind === 'option') && !!i.place_name && i.lat != null && i.lng != null
      // "Ryanair FR3628", "Ferry to Cacilhas": a journey gets bolded like a venue in the
      // itinerary and geocodes to the terminal. Same test as the bookings below.
      && inferKind({ title: i.place_name, fields: {} }) !== 'transport'
      && !(!i.address && looksGeneric(i.place_name)),
  )
  for (const item of places) {
    targets.push({
      id: item.id,
      path: pathFor(slug, item.id),
      query: [item.place_name, item.address, cityHint].filter(Boolean).join(', '),
      lat: item.lat, lng: item.lng,
      set: (p, c) => { item.photo_path = p; item.photo_credit = c },
      get: () => ({ path: item.photo_path, credit: item.photo_credit }),
    })
  }
  for (const b of content.bookings) {
    if (b.kind === 'walkin') continue
    if (inferKind(b) === 'transport') continue       // a flight/train/taxi has no venue
    if (CHORE_RE.test(b.title)) continue             // "Confirm …", "Lisboa Card …", "Airport taxi …"
    if (b.options) continue                          // still a choice between venues: none of them is the place
    const stop = stopForBooking(places, b)
    if (stop) { shared.push({ booking: b, stopId: stop.id }); continue }
    const name = bookingName(b)
    if (!b.address && looksGeneric(name)) continue   // "Belém guided tour", "Sintra day tour departs"
    if (!b.address && !(inferKind(b) === 'event' && name.split(/\s+/).length >= 2)) continue
    targets.push({
      id: b.id,
      path: pathFor(slug, b.id),
      query: [name, b.address, cityHint].filter(Boolean).join(', '),
      lat: null, lng: null,
      set: (p, c) => { b.photo_path = p; b.photo_credit = c },
      get: () => ({ path: b.photo_path, credit: b.photo_credit }),
    })
  }
  return { targets, shared }
}

/** The queries a real run would send, so `--dry-run` can be eyeballed before any are spent. */
export function describeTargets(content: CityContent, cityHint: string): string[] {
  return photoTargets(content, cityHint).targets.map(t => t.query)
}

export async function findPlacePhoto(query: string, bias: { lat: number; lng: number } | null, key: string, fetchImpl: typeof fetch = fetch): Promise<PlacesPhoto | null> {
  const body: Record<string, unknown> = { textQuery: query, pageSize: 1 }
  if (bias) body.locationBias = { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 2000 } }
  const res = await fetchImpl(SEARCH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`places searchText HTTP ${res.status}`)
  const json = await res.json() as { places?: { id: string; photos?: { name: string; authorAttributions?: { displayName?: string }[] }[] }[] }
  const place = json.places?.[0]
  const photo = place?.photos?.[0]
  if (!place || !photo) return null
  return { placeId: place.id, photoName: photo.name, credit: photo.authorAttributions?.[0]?.displayName ?? null }
}

export async function downloadPhoto(photoName: string, key: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const res = await fetchImpl(`https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${WIDTH}&key=${key}`)
  if (!res.ok) throw new Error(`photo media HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Sequential on purpose (a burst is how the trial key hits per-minute quota). A target whose
 * object and cache row both exist costs nothing; anything else that fails becomes a warning
 * and leaves the row's photo fields null — a missing photo is a fallback, never a failed import.
 * The one exception is a run Google is refusing outright: three HTTP 403/429 in a row abort it,
 * so a wrong key or an exhausted quota is not written through as ~100 photo-less rows.
 */
export async function attachPhotos(targets: PhotoTarget[], store: PhotoStore, key: string, fetchImpl: typeof fetch = fetch, shared: SharedPhoto[] = []) {
  let attached = 0, skipped = 0, copied = 0, refusals = 0
  const warnings: string[] = []
  for (const t of targets) {
    const bias = t.lat != null && t.lng != null ? { lat: t.lat, lng: t.lng } : null
    try {
      const cached = await store.cacheGet(t.path)
      if (cached && await store.exists(t.path)) { t.set(t.path, cached.credit); skipped += 1; refusals = 0; continue }
      let found = cached ?? await findPlacePhoto(t.query, bias, key, fetchImpl)
      if (!found) { warnings.push(`photo ${t.path}: no place found for "${t.query}"`); t.set(null, null); refusals = 0; continue }
      let bytes: Uint8Array
      try {
        bytes = await downloadPhoto(found.photoName, key, fetchImpl)
      } catch (e) {
        // A cached photoName outlives the object it named: Google rotates them, and the row
        // would then be stuck on a dead name forever. One fresh search, one retry, then warn.
        if (!cached) throw e
        const fresh = await findPlacePhoto(t.query, bias, key, fetchImpl)
        if (!fresh) throw e
        found = fresh
        bytes = await downloadPhoto(fresh.photoName, key, fetchImpl)
      }
      await store.upload(t.path, bytes)
      await store.cacheSet(t.path, found)
      t.set(t.path, found.credit)
      attached += 1
      refusals = 0
    } catch (e) {
      const message = (e as Error).message
      warnings.push(`photo ${t.path}: ${message}`)
      t.set(null, null)
      if (REFUSAL_RE.test(message)) {
        refusals += 1
        if (refusals >= REFUSAL_LIMIT) throw new Error('photos: Google refused 3 requests in a row (HTTP 403/429) — check the server key / quota')
      } else refusals = 0
    }
  }
  for (const s of shared) {
    const v = targets.find(t => t.id === s.stopId)?.get()
    if (!v?.path) continue
    s.booking.photo_path = v.path
    s.booking.photo_credit = v.credit
    copied += 1
  }
  return { attached, skipped, shared: copied, warnings }
}

export function supabasePhotoStore(client: SupabaseClient, ownerId: string): PhotoStore {
  return {
    async exists(path) {
      const [dir, file] = [path.slice(0, path.lastIndexOf('/')), path.slice(path.lastIndexOf('/') + 1)]
      // `search` is a prefix filter, not an exact match: one object per page is not enough to
      // guarantee ours is the one returned, so ask for a page and match the name exactly.
      const { data, error } = await client.storage.from('photos').list(dir, { search: file, limit: 100 })
      if (error) throw new Error(`photos list: ${error.message}`)
      return (data ?? []).some(o => o.name === file)
    },
    async upload(path, bytes) {
      const { error } = await client.storage.from('photos').upload(path, bytes, { upsert: true, contentType: 'image/jpeg' })
      if (error) throw new Error(`photos upload ${path}: ${error.message}`)
    },
    async cacheGet(path) {
      const { data, error } = await client.from('photo_cache').select('place_id,photo_name,credit').eq('path', path).maybeSingle()
      if (error) { console.warn(`photo_cache get failed: ${error.message}`); return null }
      return data?.photo_name ? { placeId: data.place_id, photoName: data.photo_name, credit: data.credit } : null
    },
    async cacheSet(path, v) {
      const { error } = await client.from('photo_cache').upsert({ path, owner: ownerId, place_id: v.placeId, photo_name: v.photoName, credit: v.credit })
      if (error) console.warn(`photo_cache set failed: ${error.message}`)
    },
  }
}
