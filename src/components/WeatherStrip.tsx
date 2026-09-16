import { useEffect, useState } from 'react'
import { getDailyForecast, getHourly, pickDay, cityCentre, forecastOpensOn } from '../lib/weather'
import type { DailyForecast, Hourly } from '../lib/weather'
import { fmtDay, nowInTz, todayInTrip } from '../lib/time'
import type { CityContent, TripRow } from '../lib/types'

export function conditionEmoji(condition: string): string {
  const c = condition.toLowerCase()
  if (c.includes('storm') || c.includes('thunder')) return '⛈️'
  if (c.includes('snow')) return '❄️'
  if (c.includes('rain') || c.includes('shower') || c.includes('drizzle')) return '🌧️'
  if (c.includes('cloud') || c.includes('overcast') || c.includes('fog') || c.includes('haze')) return '☁️'
  if (c.includes('sun') || c.includes('clear')) return '☀️'
  return '🌡️'
}

function WeatherIcon({ iconUri, condition, failed, onFail }: {
  iconUri: string | null
  condition: string
  failed: Set<string>
  onFail: (uri: string) => void
}) {
  // Google's icon SVGs are remote and uncached: offline (or behind a blocking proxy) the
  // <img> just fails, leaving a broken-image box. Swap in the emoji the moment it errors.
  if (!iconUri || failed.has(iconUri)) {
    return <span className="weather__icon weather__icon--fallback" aria-hidden="true">{conditionEmoji(condition)}</span>
  }
  return (
    <img
      className="weather__icon"
      src={`${iconUri}.svg`}
      alt=""
      width={28}
      height={28}
      onError={() => onFail(iconUri)}
    />
  )
}

export function WeatherStrip({ trip, content, date, variant = 'strip' }: { trip: TripRow; content: CityContent; date: string; variant?: 'strip' | 'hero' | 'line' }) {
  const key = import.meta.env.VITE_GOOGLE_BROWSER_KEY as string | undefined
  const centre = key ? cityCentre(content, date) : null
  const isToday = date === todayInTrip(trip)

  const [daily, setDaily] = useState<DailyForecast | null>(null)
  const [hourly, setHourly] = useState<Hourly | null>(null)
  const [loading, setLoading] = useState(true)
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set())
  const markIconFailed = (uri: string) => {
    setFailedIcons(prev => (prev.has(uri) ? prev : new Set(prev).add(uri)))
  }

  useEffect(() => {
    if (!key || !centre) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setDaily(null)
    setHourly(null)
    void (async () => {
      try {
        const d = await getDailyForecast(trip, centre.lat, centre.lng, key)
        if (!cancelled) setDaily(d)
      } catch {
        // Fetch failed with no cache to fall back on: the strip stays silent.
      }
      if (isToday) {
        try {
          const h = await getHourly(trip, centre.lat, centre.lng, key)
          if (!cancelled) setHourly(h)
        } catch {
          // Hourly is a nice-to-have on top of the daily summary; ignore failures.
        }
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.slug, centre?.lat, centre?.lng, date, isToday, key])

  if (!key || !centre) return null
  if (loading) return <div className={`weather weather--${variant}`}><p className="weather__loading caption">Weather…</p></div>
  if (!daily) return null

  const day = pickDay(daily, date)
  if (!day) {
    const opensOn = forecastOpensOn(trip, date)
    if (!opensOn) return null
    return <div className={`weather weather--${variant}`}><p className="weather__opens caption">Forecast opens on {fmtDay(date)}</p></div>
  }

  const hours = isToday && hourly && variant !== 'line' ? hourly.hours.slice(0, 8) : []

  return (
    <div className={`weather weather--${variant}`}>
      <div className="weather__summary">
        <WeatherIcon iconUri={day.iconUri} condition={day.condition} failed={failedIcons} onFail={markIconFailed} />
        {variant === 'hero'
          ? <span className="weather__text"><span className="weather__temp">{Math.round(day.hi)}°</span> {day.condition} · low {Math.round(day.lo)}° · ☂ {day.precipPct}%</span>
          : variant === 'line'
            ? <span className="weather__text">{Math.round(day.hi)}° {day.condition}</span>
            : <span className="weather__text">{day.condition} · {Math.round(day.hi)}° / {Math.round(day.lo)}° · ☂ {day.precipPct}%</span>}
      </div>
      {daily.stale && (
        <p className="weather__caption caption">as of {nowInTz(trip.timezone, new Date(daily.fetchedAt)).hhmm}</p>
      )}
      {hours.length > 0 && (
        <div className="weather__hours">
          {hours.map(h => (
            <div key={h.time} className="weather__hour">
              <span className="weather__hour-time">{h.time.slice(0, 2)}</span>
              <WeatherIcon iconUri={h.iconUri} condition={h.condition} failed={failedIcons} onFail={markIconFailed} />
              <span className="weather__hour-temp">{Math.round(h.temp)}°</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
