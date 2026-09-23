import { useEffect, useMemo, useState } from 'react'
import { cachedMapStatus } from './offlineMaps'
import { nowInTz } from './time'
import { useTrip } from './trip'
import type { OfflineAreaRow, TripRow } from './types'

/** A city you will need a map for, that does not have one on the phone yet. */
export interface MapNeed {
  slug: string
  name: string
  /** `null` when you are in the city today; otherwise the date you arrive. */
  neededOn: string | null
  bytes: number
}

/**
 * Which cities still need their offline map fetched.
 *
 * Only cities you have not finished with: a trip that has already ended is dead weight, and
 * warning about it would train the owner to ignore the warning. A city with no `offline_areas`
 * rows is skipped too — there is nothing to download, so naming it would be a dead end.
 *
 * `cachedSlugs` is the set of cities whose every area is already in the Cache API; computing
 * that needs async storage reads, so it is passed in and this stays pure and directly testable.
 */
export function needsDownload(
  trips: TripRow[],
  areasByTrip: Record<string, OfflineAreaRow[]>,
  cachedSlugs: Set<string>,
  today: string,
): MapNeed[] {
  return trips
    .filter(t => t.end_date >= today)
    .filter(t => !cachedSlugs.has(t.slug))
    .filter(t => (areasByTrip[t.slug]?.length ?? 0) > 0)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .map(t => ({
      slug: t.slug,
      name: t.name,
      neededOn: t.start_date <= today ? null : t.start_date,
      bytes: areasByTrip[t.slug].reduce((sum, a) => sum + a.size_bytes, 0),
    }))
}

/**
 * Which cities have their whole map on the phone right now.
 *
 * A partially downloaded city does not count, and neither does a stale one — cached bytes that
 * no longer match the row mean the city was re-cut since it was saved, so what is on the phone
 * is a different map than the one the trip now describes.
 *
 * Reads only the Cache API, so this is as correct offline as it is on wifi.
 */
export async function fullyCachedSlugs(
  areasByTrip: Record<string, OfflineAreaRow[]>,
  cacheStorage: CacheStorage = globalThis.caches,
): Promise<Set<string>> {
  const ready = new Set<string>()
  for (const [slug, areas] of Object.entries(areasByTrip)) {
    if (areas.length === 0) continue
    const stat = await cachedMapStatus(slug, areas, cacheStorage)
    if (stat.downloaded === stat.total && !stat.stale) ready.add(slug)
  }
  return ready
}

/** Group area rows by their trip, so each city can be asked about independently. */
export function areasByTrip(areas: OfflineAreaRow[]): Record<string, OfflineAreaRow[]> {
  const by: Record<string, OfflineAreaRow[]> = {}
  for (const a of areas) (by[a.trip] ??= []).push(a)
  return by
}

/**
 * The cities still missing a map, recomputed whenever the trip data changes.
 *
 * Every Cache API read is guarded: Safari private mode denies `caches` outright and jsdom has
 * no such global, and neither should stop the screen rendering. A storage read that throws is
 * read as "nothing is saved", which errs towards offering a download the owner may not need
 * rather than hiding one they do.
 */
export function useMapNeeds(cacheStorage?: CacheStorage): MapNeed[] {
  const { trips, allAreas, content } = useTrip()
  const [needs, setNeeds] = useState<MapNeed[]>([])

  // The current city's rows arrive with its content, ahead of the all-trips fetch; merging
  // them in means the city you are standing in is never briefly reported as having no map.
  const byTrip = useMemo(() => {
    const by = areasByTrip(allAreas)
    if (content && content.areas.length > 0) by[content.trip.slug] = content.areas
    return by
  }, [allAreas, content])

  const today = content ? nowInTz(content.trip.timezone).date : null

  useEffect(() => {
    if (!today || trips.length === 0) { setNeeds([]); return }
    let cancelled = false
    void (async () => {
      let cached = new Set<string>()
      try {
        cached = await fullyCachedSlugs(byTrip, cacheStorage ?? globalThis.caches)
      } catch { /* no Cache API — treat as nothing saved */ }
      if (cancelled) return
      setNeeds(needsDownload(trips, byTrip, cached, today))
    })()
    return () => { cancelled = true }
  }, [trips, byTrip, today, cacheStorage])

  return needs
}
