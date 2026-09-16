import type { SupabaseClient } from '@supabase/supabase-js'
import type { CityContent } from './types'

export interface PhotoTarget { path: string; query: string; lat: number | null; lng: number | null; set(path: string | null, credit: string | null): void }
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

function safeId(id: string): string { return id.replace(/[^A-Za-z0-9_-]/g, '_') }

/** One photo per named stop/option and per booking that is not a walk-in. */
export function photoTargets(content: CityContent, cityHint: string): PhotoTarget[] {
  const slug = content.trip.slug
  const out: PhotoTarget[] = []
  for (const item of content.items) {
    if ((item.kind !== 'stop' && item.kind !== 'option') || !item.place_name) continue
    out.push({
      path: `${slug}/${safeId(item.id)}.jpg`,
      query: [item.place_name, item.address, cityHint].filter(Boolean).join(', '),
      lat: item.lat, lng: item.lng,
      set: (p, c) => { item.photo_path = p; item.photo_credit = c },
    })
  }
  for (const b of content.bookings) {
    if (b.kind === 'walkin') continue
    const name = b.title.split(/ — | - /)[0].trim()
    out.push({
      path: `${slug}/${safeId(b.id)}.jpg`,
      query: [name, b.address, cityHint].filter(Boolean).join(', '),
      lat: null, lng: null,
      set: (p, c) => { b.photo_path = p; b.photo_credit = c },
    })
  }
  return out
}

export async function findPlacePhoto(query: string, bias: { lat: number; lng: number } | null, key: string, fetchImpl: typeof fetch = fetch): Promise<PlacesPhoto | null> {
  const body: Record<string, unknown> = { textQuery: query, maxResultCount: 1 }
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
 */
export async function attachPhotos(targets: PhotoTarget[], store: PhotoStore, key: string, fetchImpl: typeof fetch = fetch) {
  let attached = 0, skipped = 0
  const warnings: string[] = []
  for (const t of targets) {
    try {
      const cached = await store.cacheGet(t.path)
      if (cached && await store.exists(t.path)) { t.set(t.path, cached.credit); skipped += 1; continue }
      const found = cached ?? await findPlacePhoto(t.query, t.lat != null && t.lng != null ? { lat: t.lat, lng: t.lng } : null, key, fetchImpl)
      if (!found) { warnings.push(`photo ${t.path}: no place found for "${t.query}"`); t.set(null, null); continue }
      const bytes = await downloadPhoto(found.photoName, key, fetchImpl)
      await store.upload(t.path, bytes)
      await store.cacheSet(t.path, found)
      t.set(t.path, found.credit)
      attached += 1
    } catch (e) {
      warnings.push(`photo ${t.path}: ${(e as Error).message}`)
      t.set(null, null)
    }
  }
  return { attached, skipped, warnings }
}

export function supabasePhotoStore(client: SupabaseClient, ownerId: string): PhotoStore {
  return {
    async exists(path) {
      const [dir, file] = [path.slice(0, path.lastIndexOf('/')), path.slice(path.lastIndexOf('/') + 1)]
      const { data, error } = await client.storage.from('photos').list(dir, { search: file, limit: 1 })
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
