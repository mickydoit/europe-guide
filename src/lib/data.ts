import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { normaliseTime } from './time'
import type { AlertRow, BookingRow, CityContent, ItemRow, TripRow } from './types'
type Q = { data: unknown[] | null; error: { message: string } | null }
async function rows<T>(p: PromiseLike<Q>, table: string): Promise<T[]> {
  const { data, error } = await p; if (error) throw new Error(`load ${table}: ${error.message}`); return (data ?? []) as T[]
}
export async function fetchCityWith(c: SupabaseClient, slug: string): Promise<CityContent> {
  const f = c.from.bind(c)
  const [trips, days, items, bookings, routes, legs, alerts, parked, notes, areas] = await Promise.all([
    rows<TripRow>(f('trips').select('*').eq('slug', slug), 'trips'),
    rows(f('days').select('*').eq('trip', slug).order('date'), 'days'),
    rows<ItemRow>(f('items').select('*').eq('trip', slug).order('date').order('sort'), 'items'),
    rows<BookingRow>(f('bookings').select('*').eq('trip', slug).order('sort'), 'bookings'),
    rows(f('routes').select('*').eq('trip', slug).order('sort'), 'routes'),
    rows(f('legs').select('*').eq('trip', slug).order('route_id').order('seq'), 'legs'),
    rows<AlertRow>(f('alerts').select('*').eq('trip', slug).order('date').order('seq'), 'alerts'),
    rows(f('parked_venues').select('*').eq('trip', slug).order('seq'), 'parked_venues'),
    rows(f('standing_notes').select('*').eq('trip', slug).order('seq'), 'standing_notes'),
    rows(f('offline_areas').select('*').eq('trip', slug).order('seq'), 'offline_areas'),
  ])
  if (!trips[0]) throw new Error(`trip "${slug}" not found`)
  // Postgres `time` columns come back from PostgREST as HH:MM:SS; normalise at the boundary.
  const normItems = items.map(i => ({ ...i, time: normaliseTime(i.time) }))
  const normBookings = bookings.map(b => ({ ...b, time: normaliseTime(b.time) }))
  const normAlerts = alerts.map(a => ({ ...a, time: normaliseTime(a.time) }))
  return { trip: trips[0], days, items: normItems, bookings: normBookings, routes, legs, alerts: normAlerts, parked, notes, areas } as CityContent
}
export const fetchCity = (slug: string) => fetchCityWith(supabase, slug)
export async function fetchTripsWith(c: SupabaseClient) { return rows<TripRow>(c.from('trips').select('*').order('sort').order('start_date'), 'trips') }
export const fetchTrips = () => fetchTripsWith(supabase)
