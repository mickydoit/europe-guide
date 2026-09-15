import type { SupabaseClient } from '@supabase/supabase-js'
import type { CityContent } from './types'
export interface GeoPoint { lat: number; lng: number; formatted: string; place_id: string }
export type Geocoder = (query: string) => Promise<GeoPoint | null>

export function makeGoogleGeocoder(key: string, region: string, fetchImpl: typeof fetch = fetch): Geocoder {
  return async q => {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=${region}&key=${key}`
    const res = await fetchImpl(url); const j = await res.json() as { status: string; results: { geometry: { location: { lat: number; lng: number } }; formatted_address: string; place_id: string }[]; error_message?: string }
    if (j.status === 'ZERO_RESULTS') return null
    if (j.status !== 'OK') throw new Error(`geocode ${j.status}: ${j.error_message ?? ''} for "${q}"`)
    const r = j.results[0]; return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, formatted: r.formatted_address, place_id: r.place_id }
  }
}
export function makeCachedGeocoder(inner: Geocoder, cache: { get(q: string): Promise<GeoPoint | null>; set(q: string, v: GeoPoint): Promise<void> }): Geocoder {
  return async q => { const hit = await cache.get(q); if (hit) return hit; const v = await inner(q); if (v) await cache.set(q, v); return v }
}
export function supabaseCache(client: SupabaseClient, ownerId: string) {
  return {
    async get(q: string) { const { data } = await client.from('geocode_cache').select('lat,lng,formatted_address,place_id').eq('query', q).maybeSingle(); return data && data.lat != null ? { lat: data.lat, lng: data.lng, formatted: data.formatted_address, place_id: data.place_id } : null },
    async set(q: string, v: GeoPoint) { await client.from('geocode_cache').upsert({ query: q, owner: ownerId, lat: v.lat, lng: v.lng, formatted_address: v.formatted, place_id: v.place_id }) },
  }
}
export async function geocodeContent(c: CityContent, geocode: Geocoder, cityHint: string) {
  const misses: string[] = []
  const lookup = async (q: string) => { const r = await geocode(q); if (!r) misses.push(q); return r }
  for (const it of c.items) if (it.place_name && it.lat == null) { const r = await lookup(`${it.place_name}${it.address ? ', ' + it.address : ''}, ${cityHint}`); if (r) { it.lat = r.lat; it.lng = r.lng } }
  for (const p of c.parked) if (p.lat == null) { const r = await lookup(`${p.name}${p.address ? ', ' + p.address : ''}, ${cityHint}`); if (r) { p.lat = r.lat; p.lng = r.lng } }
  for (const l of c.legs) {
    if (l.from_lat == null) { const r = await lookup(l.from_name); if (r) { l.from_lat = r.lat; l.from_lng = r.lng } }
    if (l.to_lat == null) { const r = await lookup(l.to_name); if (r) { l.to_lat = r.lat; l.to_lng = r.lng } }
  }
  return { misses: [...new Set(misses)] }
}
