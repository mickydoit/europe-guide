import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { fetchAllAreas, fetchAllAreasWith, fetchCity, fetchCityWith, fetchTrips, fetchTripsWith } from './data'
import { getCachedAreas, getCachedCity, putCachedAreas, putCachedCity, getCachedTrips, putCachedTrips } from './db'
import { todayInTrip } from './time'
import type { CityContent, OfflineAreaRow, TripRow } from './types'

const STORAGE_KEY = 'europe-guide.trip'

interface Trip {
  trips: TripRow[]
  /** Offline areas for EVERY trip — the readiness dot must see cities you have not opened yet. */
  allAreas: OfflineAreaRow[]
  slug: string | null
  content: CityContent | null
  loading: boolean
  offline: boolean
  error: string | null
  setSlug(slug: string): void
  refresh(): Promise<void>
}

export const TripContext = createContext<Trip | null>(null)

function message(e: unknown) { return e instanceof Error ? e.message : String(e) }

function defaultSlug(trips: TripRow[]): string {
  const current = trips.find(t => todayInTrip(t) !== null)
  return (current ?? trips[0]).slug
}

// Validates a candidate slug against the known trips list, falling back to the
// today-match / trips[0] rule when it names a trip that no longer exists (e.g. a
// stale ?trip= or localStorage value left over from a since-removed trip).
function pickSlug(trips: TripRow[], candidate: string | null): string | null {
  if (candidate && trips.some(t => t.slug === candidate)) return candidate
  return null
}

function resolveSlug(trips: TripRow[]): string | null {
  if (trips.length === 0) return null
  const fromQuery = pickSlug(trips, new URLSearchParams(location.search).get('trip'))
  if (fromQuery) return fromQuery
  const fromStorage = pickSlug(trips, localStorage.getItem(STORAGE_KEY))
  if (fromStorage) return fromStorage
  return defaultSlug(trips)
}

export function TripProvider({ children, client, initial }: {
  children: ReactNode
  client?: SupabaseClient
  initial?: { trips: TripRow[]; slug: string; content: CityContent; allAreas?: OfflineAreaRow[] }
}) {
  const [trips, setTrips] = useState<TripRow[]>(initial?.trips ?? [])
  const [allAreas, setAllAreas] = useState<OfflineAreaRow[]>(initial?.allAreas ?? [])
  const [slug, setSlugState] = useState<string | null>(initial?.slug ?? null)
  const [content, setContent] = useState<CityContent | null>(initial?.content ?? null)
  const [loading, setLoading] = useState(!initial)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const skipInitialCityLoad = useRef(!!initial)
  const loadSeq = useRef(0)

  const doFetchTrips = () => (client ? fetchTripsWith(client) : fetchTrips())
  const doFetchAreas = () => (client ? fetchAllAreasWith(client) : fetchAllAreas())
  const doFetchCity = (s: string) => (client ? fetchCityWith(client, s) : fetchCity(s))

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  async function loadCity(s: string) {
    const seq = ++loadSeq.current
    const stale = () => !mounted.current || seq !== loadSeq.current
    try {
      const c = await doFetchCity(s)
      await putCachedCity(c)
      if (stale()) return
      setContent(c); setOffline(false); setError(null)
    } catch (e) {
      const msg = message(e)
      const cached = await getCachedCity(s)
      if (stale()) return
      if (cached) { setContent(cached); setOffline(true); setError(null) }
      else { setError(msg) }
    } finally {
      if (!stale()) setLoading(false)
    }
  }

  useEffect(() => {
    if (initial) return
    let cancelled = false
    void (async () => {
      // Areas for every trip ride along with the trips list: a few rows for the whole trip,
      // and both are cached so a cold start with no network still knows what is missing.
      void (async () => {
        try {
          const a = await doFetchAreas()
          await putCachedAreas(a)
          if (!cancelled && mounted.current) setAllAreas(a)
        } catch {
          const a = await getCachedAreas()
          if (!cancelled && mounted.current) setAllAreas(a)
        }
      })()
      let list: TripRow[] = []
      try {
        list = await doFetchTrips()
        await putCachedTrips(list)
      } catch (e) {
        const cached = await getCachedTrips()
        if (cached.length > 0) list = cached
        else if (!cancelled && mounted.current) setError(message(e))
      }
      if (cancelled || !mounted.current) return
      setTrips(list)
      const resolved = resolveSlug(list)
      if (!resolved) { setLoading(false); return }
      setSlugState(resolved)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (skipInitialCityLoad.current) { skipInitialCityLoad.current = false; return }
    if (slug === null) return
    setLoading(true)
    void loadCity(slug)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  function setSlug(s: string) {
    localStorage.setItem(STORAGE_KEY, s)
    history.replaceState(null, '', `${location.pathname}?trip=${s}`)
    setSlugState(s)
  }

  async function refresh() {
    if (!slug) return
    // loadCity only ever clears `loading`; without setting it here the Refresh button never
    // says "Refreshing…" and the owner has nothing telling them the tap did anything.
    setLoading(true)
    try {
      await loadCity(slug)
    } finally {
      if (mounted.current) setLoading(false)
    }
  }

  const value: Trip = { trips, allAreas, slug, content, loading, offline, error, setSlug, refresh }
  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}

export function useTrip() {
  const v = useContext(TripContext)
  if (!v) throw new Error('useTrip outside TripProvider')
  return v
}
