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
        const className = `day-chip${isSel ? ' day-chip--selected' : ''}${day.date === today ? ' day-chip--today' : ''}`
        const face = <><span className="day-chip__wd">{wd}</span><span className="day-chip__d">{d}</span></>
        return (
          <li key={day.date} className="day-strip__item">
            {/* The day you are already on is not a navigation. As a <Link> it pointed at the
                current path, which react-router turns into a REPLACE — and a replace mints a
                fresh location.key, stranding the scroll offset saved under the old one so the
                next Back opened the itinerary at the top. */}
            {isSel
              ? <span className={className} aria-current="date" aria-label={`${wd} ${d}`}>{face}</span>
              : (
                <Link to={`/day/${day.date}`} className={className} aria-label={`${wd} ${d}`}>
                  {face}
                </Link>
              )}
          </li>
        )
      })}
    </ul>
  )
}
