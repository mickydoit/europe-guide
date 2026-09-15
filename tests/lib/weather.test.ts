import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  mapDaily, mapHourly, mapCurrent,
  getDailyForecast, getHourly,
  pickDay, cityCentre, forecastOpensOn,
} from '../../src/lib/weather'
import { resetDbForTests } from '../../src/lib/db'
import type { CityContent, ItemRow, OfflineAreaRow, TripRow } from '../../src/lib/types'

const trip: TripRow = {
  slug: 'valle', name: 'Valle', country: 'Italy', country_code: 'it',
  start_date: '2026-11-01', end_date: '2026-11-03', base: null,
  timezone: 'UTC', intro: null, sort: 0,
}

function item(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: 'valle/2026-11-02/0830/x', trip: 'valle', date: '2026-11-02', block: 'morning',
    time: '08:30', time_text: null, approx: false, kind: 'stop', parent_item: null,
    plan: 'X', details: null, sort: 0, place_name: null, address: null,
    lat: null, lng: null, url: null, route_id: null,
    ...overrides,
  }
}

function content(overrides: Partial<CityContent> = {}): CityContent {
  return {
    trip, days: [], items: [], bookings: [], routes: [], legs: [], alerts: [], parked: [], notes: [], areas: [],
    ...overrides,
  }
}

// Hand-written fixtures in the documented Weather API response shapes.
const dailyFixture = {
  forecastDays: [
    {
      displayDate: { year: 2026, month: 11, day: 2 },
      maxTemperature: { degrees: 24, unit: 'CELSIUS' },
      minTemperature: { degrees: 15, unit: 'CELSIUS' },
      daytimeForecast: {
        weatherCondition: { description: { text: 'Sunny' }, iconBaseUri: 'https://example.com/weather/icon' },
        precipitation: { probability: { type: 'PERCENT', percent: 10 } },
      },
      sunEvents: { sunriseTime: '2026-11-02T06:30:00Z', sunsetTime: '2026-11-02T17:00:00Z' },
    },
  ],
  timeZone: { id: 'Europe/Rome' },
}

const hourlyFixture = {
  forecastHours: [
    {
      interval: { startTime: '2026-11-02T09:00:00Z' },
      displayDateTime: { year: 2026, month: 11, day: 2, hours: 9, minutes: 0, seconds: 0, nanos: 0, utcOffset: '3600s' },
      temperature: { degrees: 18, unit: 'CELSIUS' },
      weatherCondition: { description: { text: 'Sunny' }, iconBaseUri: 'https://example.com/weather/icon' },
      precipitation: { probability: { type: 'PERCENT', percent: 5 } },
    },
  ],
  timeZone: { id: 'Europe/Rome' },
}

const currentFixture = {
  weatherCondition: { description: { text: 'Sunny' }, iconBaseUri: 'https://example.com/weather/icon' },
  temperature: { degrees: 20, unit: 'CELSIUS' },
  feelsLikeTemperature: { degrees: 19, unit: 'CELSIUS' },
  relativeHumidity: 55,
  wind: { speed: { value: 12, unit: 'KILOMETERS_PER_HOUR' } },
  currentTime: '2026-11-02T09:00:00Z',
}

beforeEach(async () => {
  await resetDbForTests()
  await new Promise<void>(resolve => {
    const req = indexedDB.deleteDatabase('europe-guide')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
})

describe('mapDaily', () => {
  test('maps a forecastDays fixture to DailyDay[]', () => {
    const days = mapDaily(dailyFixture, 'Europe/Rome')
    expect(days).toEqual([{
      date: '2026-11-02', hi: 24, lo: 15, precipPct: 10, condition: 'Sunny',
      iconUri: 'https://example.com/weather/icon',
      sunrise: '2026-11-02T06:30:00Z', sunset: '2026-11-02T17:00:00Z',
    }])
  })
})

describe('mapHourly', () => {
  test('maps a forecastHours fixture to HourlyHour[] with HH:MM time', () => {
    const hours = mapHourly(hourlyFixture, 'Europe/Rome')
    expect(hours).toEqual([{
      time: '09:00', date: '2026-11-02', temp: 18, precipPct: 5, condition: 'Sunny',
      iconUri: 'https://example.com/weather/icon',
    }])
  })
})

describe('mapCurrent', () => {
  test('maps a currentConditions fixture', () => {
    expect(mapCurrent(currentFixture)).toEqual({
      temp: 20, feelsLike: 19, condition: 'Sunny', iconUri: 'https://example.com/weather/icon',
      humidity: 55, windKph: 12,
    })
  })
})

describe('getDailyForecast caching', () => {
  test('a fresh cache hit skips the fetch entirely', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(dailyFixture), { status: 200 }))
    const now = new Date('2026-11-01T08:00:00Z')
    const first = await getDailyForecast(trip, 41.9, 12.5, 'k', { fetchImpl, now })
    expect(first.stale).toBe(false)
    expect(first.days[0].date).toBe('2026-11-02')
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const later = new Date(now.getTime() + 5 * 60 * 1000) // 5 min later, within the 60 min TTL
    const second = await getDailyForecast(trip, 41.9, 12.5, 'k', { fetchImpl, now: later })
    expect(second).toEqual({ ...first })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('falls back to a stale cache entry when the fetch fails', async () => {
    const okFetch = vi.fn(async () => new Response(JSON.stringify(dailyFixture), { status: 200 }))
    const now = new Date('2026-11-01T08:00:00Z')
    await getDailyForecast(trip, 41.9, 12.5, 'k', { fetchImpl: okFetch, now })

    const failFetch = vi.fn(async () => { throw new Error('network down') })
    const muchLater = new Date(now.getTime() + 2 * 60 * 60 * 1000) // past the 60 min TTL
    const result = await getDailyForecast(trip, 41.9, 12.5, 'k', { fetchImpl: failFetch, now: muchLater })
    expect(result.stale).toBe(true)
    expect(result.days[0].date).toBe('2026-11-02')
  })

  test('throws with no cache to fall back on', async () => {
    const failFetch = vi.fn(async () => new Response('boom', { status: 500 }))
    await expect(getDailyForecast(trip, 41.9, 12.5, 'k', { fetchImpl: failFetch, now: new Date() }))
      .rejects.toThrow(/500/)
  })
})

describe('getHourly caching', () => {
  test('maps and caches hourly forecasts', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(hourlyFixture), { status: 200 }))
    const result = await getHourly(trip, 41.9, 12.5, 'k', { fetchImpl, now: new Date('2026-11-02T08:00:00Z') })
    expect(result.stale).toBe(false)
    expect(result.hours[0]).toEqual({
      time: '09:00', date: '2026-11-02', temp: 18, precipPct: 5, condition: 'Sunny',
      iconUri: 'https://example.com/weather/icon',
    })
  })
})

describe('pickDay', () => {
  test('finds the matching day and returns null otherwise', () => {
    const forecast = { fetchedAt: '2026-11-01T00:00:00Z', stale: false, days: mapDaily(dailyFixture, 'Europe/Rome') }
    expect(pickDay(forecast, '2026-11-02')?.hi).toBe(24)
    expect(pickDay(forecast, '2026-12-25')).toBeNull()
  })
})

describe('cityCentre', () => {
  test('means the coordinates of the selected date\'s stops', () => {
    const c = content({
      items: [
        item({ id: 'a', date: '2026-11-02', lat: 40, lng: 10 }),
        item({ id: 'b', date: '2026-11-02', lat: 42, lng: 12 }),
        item({ id: 'c', date: '2026-11-03', lat: 0, lng: 0 }),
      ],
    })
    expect(cityCentre(c, '2026-11-02')).toEqual({ lat: 41, lng: 11 })
  })

  test('falls back to the mean of all stops when the date has none', () => {
    const c = content({
      items: [
        item({ id: 'a', date: '2026-11-03', lat: 40, lng: 10 }),
        item({ id: 'b', date: '2026-11-03', lat: 42, lng: 12 }),
      ],
    })
    expect(cityCentre(c, '2026-11-02')).toEqual({ lat: 41, lng: 11 })
  })

  test('falls back to the first area\'s bbox centre when no items have coords', () => {
    const area: OfflineAreaRow = {
      trip: 'valle', seq: 1, name: 'Old Town', min_lng: 10, min_lat: 40, max_lng: 12, max_lat: 42,
      pmtiles_path: 'valle/1.pmtiles', size_bytes: 100, built_at: '2026-01-01',
    }
    const c = content({ items: [item({ lat: null, lng: null })], areas: [area] })
    expect(cityCentre(c, '2026-11-02')).toEqual({ lat: 41, lng: 11 })
  })

  test('returns null when nothing has coordinates', () => {
    const c = content({ items: [item({ lat: null, lng: null })] })
    expect(cityCentre(c, '2026-11-02')).toBeNull()
  })
})

describe('forecastOpensOn', () => {
  test('a date beyond the 10-day window opens on date - 9 days', () => {
    const now = new Date('2026-09-15T12:00:00Z')
    expect(forecastOpensOn(trip, '2026-09-29', now)).toBe('2026-09-20')
  })

  test('a date already within the 10-day window returns null', () => {
    const now = new Date('2026-09-15T12:00:00Z')
    expect(forecastOpensOn(trip, '2026-09-20', now)).toBeNull()
    expect(forecastOpensOn(trip, '2026-09-15', now)).toBeNull()
  })
})
