import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { fetchCity, fetchCityWith, fetchTrips, fetchTripsWith } from './data'
import { getCachedCity, putCachedCity, getCachedTrips, putCachedTrips } from './db'
import { todayInTrip } from './time'
import type { CityContent, TripRow } from './types'

const STORAGE_KEY = 'europe-guide.trip'

interface Trip {
  trips: TripRow[]
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

function resolveSlug(trips: TripRow[]): string | null {
  if (trips.length === 0) return null
  const fromQuery = new URLSearchParams(location.search).get('trip')
  if (fromQuery) return fromQuery
  const fromStorage = localStorage.getItem(STORAGE_KEY)
  if (fromStorage) return fromStorage
  const current = trips.find(t => todayInTrip(t) !== null)
  return (current ?? trips[0]).slug
}

export function TripProvider({ children, client, initial }: {
  children: ReactNode
  client?: SupabaseClient
  initial?: { trips: TripRow[]; slug: string; content: CityContent }
}) {
  const [trips, setTrips] = useState<TripRow[]>(initial?.trips ?? [])
  const [slug, setSlugState] = useState<string | null>(initial?.slug ?? null)
  const [content, setContent] = useState<CityContent | null>(initial?.content ?? null)
  const [loading, setLoading] = useState(!initial)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const skipInitialCityLoad = useRef(!!initial)
  const loadSeq = useRef(0)

  const doFetchTrips = () => (client ? fetchTripsWith(client) : fetchTrips())
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
    if (slug) await loadCity(slug)
  }

  const value: Trip = { trips, slug, content, loading, offline, error, setSlug, refresh }
  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}

export function useTrip() {
  const v = useContext(TripContext)
  if (!v) throw new Error('useTrip outside TripProvider')
  return v
}
