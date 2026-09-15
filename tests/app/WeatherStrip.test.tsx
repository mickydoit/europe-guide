import { render, screen } from '@testing-library/react'
import { vi, describe, test, expect, afterEach } from 'vitest'
import type { CityContent, ItemRow, TripRow } from '../../src/lib/types'

const { getDailyForecastMock, getHourlyMock } = vi.hoisted(() => ({
  getDailyForecastMock: vi.fn(),
  getHourlyMock: vi.fn(),
}))
vi.mock('../../src/lib/weather', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/weather')>()
  return { ...actual, getDailyForecast: getDailyForecastMock, getHourly: getHourlyMock }
})

import { WeatherStrip } from '../../src/components/WeatherStrip'

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
    lat: 41.9, lng: 12.5, url: null, route_id: null,
    ...overrides,
  }
}

function content(overrides: Partial<CityContent> = {}): CityContent {
  return {
    trip, days: [], items: [item()], bookings: [], routes: [], legs: [], alerts: [], parked: [], notes: [], areas: [],
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  getDailyForecastMock.mockReset()
  getHourlyMock.mockReset()
})

describe('WeatherStrip', () => {
  test('shows condition, hi/lo and precipitation from the picked day', async () => {
    vi.stubEnv('VITE_GOOGLE_BROWSER_KEY', 'k')
    getDailyForecastMock.mockResolvedValue({
      fetchedAt: '2026-11-01T08:00:00Z', stale: false,
      days: [{
        date: '2026-11-02', hi: 24, lo: 15, precipPct: 10, condition: 'Sunny',
        iconUri: 'https://example.com/icon', sunrise: null, sunset: null,
      }],
    })

    render(<WeatherStrip trip={trip} content={content()} date="2026-11-02" />)

    expect(await screen.findByText(/24° \/ 15°/)).toBeInTheDocument()
    expect(screen.getByText(/☂ 10%/)).toBeInTheDocument()
    expect(screen.getByText(/Sunny/)).toBeInTheDocument()
  })

  test('shows "Forecast opens on" for a far date with an empty forecast', async () => {
    vi.stubEnv('VITE_GOOGLE_BROWSER_KEY', 'k')
    getDailyForecastMock.mockResolvedValue({ fetchedAt: '2026-11-01T08:00:00Z', stale: false, days: [] })

    render(<WeatherStrip trip={trip} content={content()} date="2030-01-01" />)

    expect(await screen.findByText(/Forecast opens on/)).toBeInTheDocument()
  })

  test('renders nothing when the browser key is missing', () => {
    vi.stubEnv('VITE_GOOGLE_BROWSER_KEY', '')
    const { container } = render(<WeatherStrip trip={trip} content={content()} date="2026-11-02" />)
    expect(container).toBeEmptyDOMElement()
    expect(getDailyForecastMock).not.toHaveBeenCalled()
  })
})
