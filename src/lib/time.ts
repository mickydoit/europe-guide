import type { AlertRow, DayRow, TripRow } from './types'

function partsOf(tz: string, at: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => parts.find(p => p.type === type)!.value
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') }
}

export function nowInTz(tz: string, at: Date = new Date()): { date: string; minutes: number; hhmm: string } {
  const p = partsOf(tz, at)
  const date = `${p.year}-${p.month}-${p.day}`
  const hour = p.hour === '24' ? 0 : +p.hour
  const minutes = hour * 60 + +p.minute
  const hhmm = `${String(hour).padStart(2, '0')}:${p.minute}`
  return { date, minutes, hhmm }
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// PostgREST returns Postgres `time` columns as HH:MM:SS; the app works in HH:MM throughout.
export function normaliseTime(t: string | null): string | null {
  return t ? t.slice(0, 5) : null
}

export function fmtTime(time: string | null, text: string | null): string {
  const t = normaliseTime(time)
  if (t) return t
  if (text && text.startsWith('~')) return text
  if (!text) return '—'
  return text
}

export function currentBlock(minutes: number): 'morning' | 'midday' | 'evening' {
  if (minutes < 690) return 'morning'
  if (minutes < 1020) return 'midday'
  return 'evening'
}

export function currentAndNext(
  alerts: AlertRow[], date: string, minutes: number,
): { current: AlertRow | null; next: AlertRow | null; minutesToNext: number | null } {
  const today = alerts
    .filter(a => a.date === date && a.time)
    .sort((a, b) => minutesOf(a.time!) - minutesOf(b.time!))

  let current: AlertRow | null = null
  let next: AlertRow | null = null
  for (const a of today) {
    if (minutesOf(a.time!) <= minutes) current = a
    else { next = a; break }
  }

  if (next) return { current, next, minutesToNext: minutesOf(next.time!) - minutes }

  const futureDates = Array.from(new Set(alerts.filter(a => a.time && a.date > date).map(a => a.date))).sort()
  for (const futureDate of futureDates) {
    const timed = alerts
      .filter(a => a.date === futureDate && a.time)
      .sort((a, b) => minutesOf(a.time!) - minutesOf(b.time!))
    if (timed.length === 0) continue
    const nextAlert = timed[0]
    const dayGap = Math.round(
      (Date.UTC(+futureDate.slice(0, 4), +futureDate.slice(5, 7) - 1, +futureDate.slice(8, 10))
        - Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)))
      / (24 * 60 * 60 * 1000),
    )
    const minutesToNext = (24 * 60 - minutes) + minutesOf(nextAlert.time!) + 24 * 60 * (dayGap - 1)
    return { current, next: nextAlert, minutesToNext }
  }

  return { current, next: null, minutesToNext: null }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function fmtDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  return `${WEEKDAYS[utc.getUTCDay()]} ${d} ${MONTHS[m - 1]}`
}

export function fmtCountdown(minutes: number): string {
  if (minutes <= 0) return 'now'
  if (minutes < 60) return `in ${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `in ${h} h ${String(m).padStart(2, '0')}`
}

export function dayIndex(days: DayRow[], date: string): number {
  return days.findIndex(d => d.date === date)
}

export function isToday(trip: TripRow, date: string, at: Date = new Date()): boolean {
  return nowInTz(trip.timezone, at).date === date
}

export function todayInTrip(trip: TripRow, at: Date = new Date()): string | null {
  const date = nowInTz(trip.timezone, at).date
  if (date < trip.start_date || date > trip.end_date) return null
  return date
}
