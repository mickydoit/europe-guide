import { useTrip } from '../lib/trip'
import { fmtDay } from '../lib/time'
import { routeLink, legLink } from '../lib/links'
import { Md } from '../components/Md'
import { Pill } from '../components/Pill'
import type { PillTone } from '../components/Pill'
import type { LegRow, RouteRow } from '../lib/types'

const MODE_LABEL: Record<RouteRow['mode'], string> = { walking: 'Walk', driving: 'Taxi', transit: 'Transit' }
const MODE_TONE: Record<RouteRow['mode'], PillTone> = { walking: 'accent', driving: 'banana', transit: 'columbia' }

function fmtDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`
  return `${Math.round(m)} m`
}

function fmtDuration(s: number): string {
  return `${Math.round(s / 60)} min`
}

function legMetric(leg: LegRow): string | null {
  const parts: string[] = []
  if (leg.distance_m != null) parts.push(fmtDistance(leg.distance_m))
  if (leg.duration_s != null) parts.push(fmtDuration(leg.duration_s))
  return parts.length > 0 ? parts.join(' · ') : null
}

export function Routes() {
  const { trips, content, loading, error } = useTrip()

  if (loading && !content) {
    return <main className="screen"><p className="caption">Loading…</p></main>
  }
  if (trips.length === 0) {
    return <main className="screen"><p className="caption">No trips yet. Run the import on your laptop.</p></main>
  }
  if (error && !content) {
    return <main className="screen"><p className="caption">{error}</p></main>
  }
  if (!content) return null

  const groups = new Map<string, RouteRow[]>()
  for (const r of content.routes) {
    const key = r.date ?? ''
    const arr = groups.get(key) ?? []
    arr.push(r)
    groups.set(key, arr)
  }
  const dateKeys = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b))

  return (
    <main className="screen routes">
      <h1 className="h5">Routes</h1>
      {dateKeys.length === 0 && <p className="caption">No routes yet.</p>}
      {dateKeys.map(date => (
        <section key={date || 'undated'} className="routes-section">
          <h2 className="h5 routes-section__heading">{date ? fmtDay(date) : 'Undated'}</h2>
          {groups.get(date)!.map(route => {
            const legs = content.legs.filter(l => l.route_id === route.id).slice().sort((a, b) => a.seq - b.seq)
            return (
              <div key={route.id} className="route-card">
                <div className="route-card__header">
                  <span className="route-card__title">{route.title}</span>
                  <Pill tone={MODE_TONE[route.mode]}>{MODE_LABEL[route.mode]}</Pill>
                </div>
                {route.distance_text && <p className="route-card__distance">{route.distance_text}</p>}
                {route.note && <p className="route-card__note"><Md text={route.note} /></p>}
                <a className="route-card__link" href={routeLink(route)} target="_blank" rel="noopener noreferrer">
                  Open whole route
                </a>
                {legs.length > 0 && (
                  <ul className="route-card__legs">
                    {legs.map(leg => {
                      const metric = legMetric(leg)
                      return (
                        <li key={leg.seq} className="route-leg">
                          <span className="route-leg__names">{leg.from_name} → {leg.to_name}</span>
                          {metric && <span className="route-leg__metric">{metric}</span>}
                          <a className="route-leg__link" href={legLink(leg)} target="_blank" rel="noopener noreferrer">
                            Walk there
                          </a>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </section>
      ))}
    </main>
  )
}
