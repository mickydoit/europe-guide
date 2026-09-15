import { routeLink } from '../lib/links'
import type { RouteRow } from '../lib/types'

export function RouteStrip({ routes }: { routes: RouteRow[] }) {
  if (routes.length === 0) return null
  return (
    <div className="route-strip">
      {routes.map(r => (
        <div key={r.id} className="route-strip__item">
          <span className="route-strip__title">{r.title}</span>
          {r.distance_text && <span className="route-strip__distance">{r.distance_text}</span>}
          <a className="route-strip__link" href={routeLink(r)} target="_blank" rel="noopener noreferrer">
            Open route
          </a>
        </div>
      ))}
    </div>
  )
}
