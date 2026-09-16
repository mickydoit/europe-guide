import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { cachePhoto, getCachedPhotoBlob, hasCachedPhoto } from './photosCache'

export async function signedPhotoUrl(path: string, client: SupabaseClient = supabase): Promise<string> {
  const { data, error } = await client.storage.from('photos').createSignedUrl(path, 3600)
  if (error) throw error
  return (data as { signedUrl: string }).signedUrl
}

/**
 * The photo at `path` as something an <img> can show: the cached bytes when the phone has
 * them, else a signed URL while online (and the bytes are cached in the background for next
 * time). Null until known, and null when neither is possible — the caller draws its fallback.
 */
export function usePhoto(path: string | null | undefined, client: SupabaseClient = supabase): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true; let objectUrl: string | null = null
    setSrc(null)
    if (!path) return
    void (async () => {
      try {
        const store = typeof caches === 'undefined' ? undefined : caches
        const blob = store ? await getCachedPhotoBlob(path, store) : null
        if (blob) { objectUrl = URL.createObjectURL(blob); if (alive) setSrc(objectUrl); return }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return
        const url = await signedPhotoUrl(path, client)
        if (alive) setSrc(url)
        if (store) void cachePhoto(path, url, fetch, store).catch(() => {})
      } catch { /* fallback stays */ }
    })()
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [path, client])
  return src
}

const runs = new Map<string, Promise<{ cached: number; total: number }>>()
export function resetPhotoWarmForTests() { runs.clear() }

/** Put every photo of the trip on the phone, once per trip per session, after the tickets pass. */
export function warmTripPhotos(trip: string, paths: string[], client: SupabaseClient = supabase, cacheStorage?: CacheStorage): Promise<{ cached: number; total: number }> {
  const NOTHING = { cached: 0, total: 0 }
  if (!trip || paths.length === 0) return Promise.resolve(NOTHING)
  const existing = runs.get(trip); if (existing) return existing
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(NOTHING)
  const store = cacheStorage ?? (typeof caches === 'undefined' ? undefined : caches)
  if (!store) return Promise.resolve(NOTHING)
  const run = (async () => {
    let cached = 0
    for (const path of paths) {
      try {
        if (await hasCachedPhoto(path, store)) { cached += 1; continue }
        await cachePhoto(path, await signedPhotoUrl(path, client), fetch, store)
        cached += 1
      } catch (e) { console.warn(e instanceof Error ? e.message : String(e)) }
    }
    return { cached, total: paths.length }
  })()
  runs.set(trip, run)
  return run
}
