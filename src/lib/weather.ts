import { getWeatherCache, putWeatherCache } from './db'
import { nowInTz } from './time'
import type { CityContent, ItemRow, TripRow } from './types'

export interface DailyDay {
  date: string
  hi: number
  lo: number
  precipPct: number
  condition: string
  iconUri: string | null
  sunrise: string | null
  sunset: string | null
}

export interface DailyForecast { fetchedAt: string; days: DailyDay[]; stale: boolean }

export interface HourlyHour {
  time: string // HH:MM in trip tz
  date: string
  temp: number
  precipPct: number
  condition: string
  iconUri: string | null
}

export interface Hourly { fetchedAt: string; hours: HourlyHour[]; stale: boolean }

const DAILY_URL = 'https://weather.googleapis.com/v1/forecast/days:lookup'
const HOURLY_URL = 'https://weather.googleapis.com/v1/forecast/hours:lookup'
const DEFAULT_TTL_MS = 60 * 60 * 1000

interface RawWeatherCondition { description?: { text?: string }; iconBaseUri?: string }
interface RawTemperature { degrees?: number }
interface RawDisplayDate { year: number; month: number; day: number }
interface RawDisplayDateTime { year: number; month: number; day: number; hours: number; minutes: number }
interface RawForecastDay {
  displayDate: RawDisplayDate
  maxTemperature?: RawTemperature
  minTemperature?: RawTemperature
  daytimeForecast?: { weatherCondition?: RawWeatherCondition; precipitation?: { probability?: { percent?: number } } }
  sunEvents?: { sunriseTime?: string; sunsetTime?: string }
}
interface RawForecastHour {
  displayDateTime: RawDisplayDateTime
  temperature?: RawTemperature
  weatherCondition?: RawWeatherCondition
  precipitation?: { probability?: { percent?: number } }
}
function pad2(n: number): string { return String(n).padStart(2, '0') }
function ymd(year: number, month: number, day: number): string { return `${year}-${pad2(month)}-${pad2(day)}` }

export function mapDaily(json: { forecastDays?: RawForecastDay[] }, _tz: string): DailyDay[] {
  const days = json.forecastDays ?? []
  return days.map(d => {
    const day = d.daytimeForecast
    return {
      date: ymd(d.displayDate.year, d.displayDate.month, d.displayDate.day),
      hi: d.maxTemperature?.degrees ?? 0,
      lo: d.minTemperature?.degrees ?? 0,
      precipPct: day?.precipitation?.probability?.percent ?? 0,
      condition: day?.weatherCondition?.description?.text ?? '',
      iconUri: day?.weatherCondition?.iconBaseUri ?? null,
      sunrise: d.sunEvents?.sunriseTime ?? null,
      sunset: d.sunEvents?.sunsetTime ?? null,
    }
  })
}

export function mapHourly(json: { forecastHours?: RawForecastHour[] }, _tz: string): HourlyHour[] {
  const hours = json.forecastHours ?? []
  return hours.map(h => {
    const dt = h.displayDateTime
    return {
      time: `${pad2(dt.hours)}:${pad2(dt.minutes)}`,
      date: ymd(dt.year, dt.month, dt.day),
      temp: h.temperature?.degrees ?? 0,
      precipPct: h.precipitation?.probability?.percent ?? 0,
      condition: h.weatherCondition?.description?.text ?? '',
      iconUri: h.weatherCondition?.iconBaseUri ?? null,
    }
  })
}

interface FetchOpts { fetchImpl?: typeof fetch; now?: Date; ttlMs?: number }

// Shared cache-or-fetch: serves a fresh cache entry unchanged, fetches and caches on a
// miss/stale entry, and falls back to a stale cache entry (marked `stale: true`) when the
// fetch itself fails — only throwing when there is nothing at all to fall back on.
async function cachedFetch<T extends object>(
  cacheKey: string,
  opts: FetchOpts,
  fetchAndMap: (fetchImpl: typeof fetch) => Promise<T>,
): Promise<T & { fetchedAt: string; stale: boolean }> {
  const { fetchImpl = fetch, now = new Date(), ttlMs = DEFAULT_TTL_MS } = opts
  const cached = await getWeatherCache<T & { fetchedAt: string }>(cacheKey)
  if (cached && now.getTime() - new Date(cached.fetchedAt).getTime() < ttlMs) {
    return { ...cached, stale: false }
  }
  try {
    const mapped = await fetchAndMap(fetchImpl)
    const record = { ...mapped, fetchedAt: now.toISOString() }
    await putWeatherCache(cacheKey, record)
    return { ...record, stale: false }
  } catch (e) {
    if (cached) return { ...cached, stale: true }
    throw e
  }
}

async function fetchJson(fetchImpl: typeof fetch, url: string, label: string): Promise<unknown> {
  const res = await fetchImpl(url, { referrerPolicy: 'no-referrer-when-downgrade' })
  if (!res.ok) throw new Error(`weather ${label} fetch failed: HTTP ${res.status}`)
  return res.json()
}

export async function getDailyForecast(
  trip: TripRow, lat: number, lng: number, key: string, opts: FetchOpts = {},
): Promise<DailyForecast> {
  const cacheKey = `${trip.slug}:daily`
  const url = `${DAILY_URL}?key=${key}&location.latitude=${lat}&location.longitude=${lng}&days=10&unitsSystem=METRIC`
  const result = await cachedFetch<{ days: DailyDay[] }>(cacheKey, opts, async fetchImpl => {
    const json = await fetchJson(fetchImpl, url, 'daily') as { forecastDays?: RawForecastDay[] }
    return { days: mapDaily(json, trip.timezone) }
  })
  return result
}

export async function getHourly(
  trip: TripRow, lat: number, lng: number, key: string, opts: FetchOpts = {},
): Promise<Hourly> {
  const cacheKey = `${trip.slug}:hourly`
  const url = `${HOURLY_URL}?key=${key}&location.latitude=${lat}&location.longitude=${lng}&hours=24&unitsSystem=METRIC`
  const result = await cachedFetch<{ hours: HourlyHour[] }>(cacheKey, opts, async fetchImpl => {
    const json = await fetchJson(fetchImpl, url, 'hourly') as { forecastHours?: RawForecastHour[] }
    return { hours: mapHourly(json, trip.timezone) }
  })
  return result
}

export function pickDay(forecast: DailyForecast, date: string): DailyDay | null {
  return forecast.days.find(d => d.date === date) ?? null
}

function meanCentre(items: ItemRow[]): { lat: number; lng: number } {
  const lat = items.reduce((s, i) => s + (i.lat as number), 0) / items.length
  const lng = items.reduce((s, i) => s + (i.lng as number), 0) / items.length
  return { lat, lng }
}

export function cityCentre(content: CityContent, date: string): { lat: number; lng: number } | null {
  const withCoords = (i: ItemRow) => i.lat != null && i.lng != null
  const forDate = content.items.filter(i => i.date === date && withCoords(i))
  if (forDate.length > 0) return meanCentre(forDate)
  const all = content.items.filter(withCoords)
  if (all.length > 0) return meanCentre(all)
  const area = content.areas[0]
  if (area) return { lat: (area.min_lat + area.max_lat) / 2, lng: (area.min_lng + area.max_lng) / 2 }
  return null
}

function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + delta))
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

// A `days:lookup` call always returns a 10-day window starting "today"; `date` first appears
// in that window once today has advanced to `date - 9 days`.
export function forecastOpensOn(trip: TripRow, date: string, now: Date = new Date()): string | null {
  const today = nowInTz(trip.timezone, now).date
  const windowEnd = addDays(today, 9)
  if (date <= windowEnd) return null
  return addDays(date, -9)
}
