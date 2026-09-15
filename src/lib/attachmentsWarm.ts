/**
 * One pass that puts every ticket in the trip on the phone.
 *
 * `useAttachments` only ever prefetches the booking whose sheet is open, so a ticket the
 * owner never happened to tap stays online-only — and the one day that matters is the day
 * with no signal. This runs once per trip per session, over every attachment row the trip
 * has, and is also the only caller of `enforceCacheLimit`: the cap is a whole-trip budget,
 * so it has to be measured against the whole trip's rows (fix I4).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { cacheAttachment, enforceCacheLimit, hasCachedAttachment } from './attachmentsCache'

/** What the caption in More counts: files on the phone, out of files the trip has. */
export type WarmResult = { cached: number; total: number }

type WarmRow = { id: string; storage_path: string; size: number; uploaded_at: string }

const NOTHING: WarmResult = { cached: 0, total: 0 }

// One run per trip per session, memoised by its promise so two screens mounting together
// (Home, then More) share the pass rather than racing two copies of it. The resolved
// result is kept so a later mount can still draw the caption without re-fetching.
const runs = new Map<string, Promise<WarmResult>>()

/**
 * Forget that `trip` has been warmed, so the next mount runs the pass again.
 *
 * Called after a ticket is uploaded live: the trip now has a file the last pass never saw,
 * and More's "Tickets saved for offline" would otherwise keep quoting the old count until
 * the app is reloaded.
 */
export function resetWarm(trip: string) { runs.delete(trip) }

/** Test-only: forget every trip warmed this session. */
export function resetWarmForTests() { runs.clear() }

function warn(e: unknown) { console.warn(e instanceof Error ? e.message : String(e)) }

async function warm(trip: string, client: SupabaseClient, cacheStorage?: CacheStorage): Promise<WarmResult> {
  const { data, error } = await client.from('attachments').select('*').eq('trip', trip)
  if (error) { warn(error); return NOTHING }
  const rows = (data ?? []) as WarmRow[]
  let cached = 0
  // Sequential on purpose: these are multi-megabyte PDFs on a phone's connection, and a
  // parallel burst is how you get a stalled screen and a handful of timeouts.
  for (const row of rows) {
    try {
      if (await hasCachedAttachment(row.id, cacheStorage)) { cached += 1; continue }
      const { data: signed, error: sErr } = await client.storage.from('tickets').createSignedUrl(row.storage_path, 3600)
      if (sErr) throw sErr
      await cacheAttachment(row.id, (signed as { signedUrl: string }).signedUrl, fetch, cacheStorage)
      cached += 1
    } catch (e) {
      // One unreachable ticket must not cost the rest of them.
      warn(e)
    }
  }
  try {
    const evicted = await enforceCacheLimit(rows, undefined, cacheStorage)
    cached -= evicted.length
  } catch (e) {
    warn(e)
  }
  return { cached: Math.max(0, cached), total: rows.length }
}

/**
 * Cache every ticket in `trip` that is not already on the phone, then hold the whole-trip
 * cache inside its cap. Safe to call on every mount: the first call per trip does the work
 * and every later one gets the same answer back.
 */
export function warmTripAttachments(
  trip: string,
  client: SupabaseClient = supabase,
  cacheStorage?: CacheStorage,
): Promise<WarmResult> {
  if (!trip) return Promise.resolve(NOTHING)
  const existing = runs.get(trip)
  if (existing) return existing
  // Nothing to warm with no signal, and no reason to burn the one run per session on it:
  // leave the trip unmarked so the pass still happens when the phone comes back.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(NOTHING)
  // Safari in private mode denies the Cache API outright; there is nowhere to put the bytes.
  const store = cacheStorage ?? (typeof caches === 'undefined' ? undefined : caches)
  if (!store) return Promise.resolve(NOTHING)

  const run = warm(trip, client, store).catch(e => { warn(e); return NOTHING })
  runs.set(trip, run)
  return run
}
