import { Link } from 'react-router-dom'
import type { DayRow } from '../lib/types'

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function parts(date: string): { wd: string; d: number } {
  const [y, m, d] = date.split('-').map(Number)
  return { wd: WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()], d }
}

/** One chip per day of the city: weekday over day number; the shown day in yellow, today dotted. Tap to switch. */
export function DayStrip({ days, selected, today }: { days: DayRow[]; selected: string; today: string | null }) {
  return (
    <ul className="day-strip" aria-label="Days">
      {days.map(day => {
        const { wd, d } = parts(day.date)
        const isSel = day.date === selected
        return (
          <li key={day.date} className="day-strip__item">
            <Link
              to={`/day/${day.date}`}
              className={`day-chip${isSel ? ' day-chip--selected' : ''}${day.date === today ? ' day-chip--today' : ''}`}
              aria-current={isSel ? 'date' : undefined}
              aria-label={`${wd} ${d}`}
            >
              <span className="day-chip__wd">{wd}</span>
              <span className="day-chip__d">{d}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
