import type { SupabaseClient } from '@supabase/supabase-js'
import type { Geocoder } from './geocode'
import type { CityContent, PlaceMeta } from './types'

export type MetaFetcher = (placeId: string) => Promise<PlaceMeta | null>

const FIELD_MASK = 'primaryType,types,priceLevel,rating,userRatingCount'

function detailsUrl(placeId: string) {
  const id = placeId.startsWith('places/') ? placeId.slice('places/'.length) : placeId
  return `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`
}

/** Place Details (New) for the five fields the taste profile needs. 404 → null (the place is gone). */
export function makeGoogleMetaFetcher(key: string, fetchImpl: typeof fetch = fetch): MetaFetcher {
  return async placeId => {
    const res = await fetchImpl(detailsUrl(placeId), { method: 'GET', headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK } })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`place details HTTP ${res.status} for "${placeId}": ${(await res.text()).slice(0, 200)}`)
    const j = await res.json() as { primaryType?: string; types?: string[]; priceLevel?: string; rating?: number; userRatingCount?: number }
    return { primary_type: j.primaryType ?? null, types: j.types ?? null, price_level: j.priceLevel ?? null, rating: j.rating ?? null, rating_count: j.userRatingCount ?? null }
  }
}

export function makeCachedMetaFetcher(inner: MetaFetcher, cache: { get(id: string): Promise<PlaceMeta | null>; set(id: string, v: PlaceMeta): Promise<void> }): MetaFetcher {
  return async id => { const hit = await cache.get(id); if (hit) return hit; const v = await inner(id); if (v) await cache.set(id, v); return v }
}

/** The metadata lives on the geocode_cache row that already holds this place_id. */
export function supabaseMetaCache(client: SupabaseClient) {
  const cols = 'primary_type,types,price_level,rating,rating_count,meta_fetched_at'
  return {
    async get(placeId: string): Promise<PlaceMeta | null> {
      const { data, error } = await client.from('geocode_cache').select(cols).eq('place_id', placeId).maybeSingle()
      if (error) { console.warn(`geocode_cache meta get failed: ${error.message}`); return null }
      if (!data || !data.meta_fetched_at) return null
      return { primary_type: data.primary_type, types: data.types, price_level: data.price_level, rating: data.rating, rating_count: data.rating_count }
    },
    async set(placeId: string, v: PlaceMeta) {
      const { error } = await client.from('geocode_cache').update({ ...v, meta_fetched_at: new Date().toISOString() }).eq('place_id', placeId)
      if (error) console.warn(`geocode_cache meta set failed: ${error.message}`)
    },
  }
}

const hasMeta = (r: Partial<PlaceMeta>) => r.primary_type != null || (r.types != null && r.types.length > 0)

/**
 * Fill the five metadata fields on every geocoded item and parked venue that lacks them.
 * Re-asks the (cached) geocoder for the place_id — a cache hit, so free — then the meta fetcher.
 */
export async function enrichPlaceMeta(c: CityContent, geocode: Geocoder, fetchMeta: MetaFetcher, cityHint: string) {
  let fetched = 0; const missing: string[] = []
  const fill = async (row: Partial<PlaceMeta>, query: string) => {
    if (hasMeta(row)) return
    const g = await geocode(query)
    if (!g) { missing.push(query); return }
    const m = await fetchMeta(g.place_id); fetched++
    if (m) Object.assign(row, m)
  }
  for (const it of c.items) if (it.place_name) await fill(it, `${it.place_name}${it.address ? ', ' + it.address : ''}, ${cityHint}`)
  for (const p of c.parked) await fill(p, `${p.name}${p.address ? ', ' + p.address : ''}, ${cityHint}`)
  return { fetched, missing: [...new Set(missing)] }
}
