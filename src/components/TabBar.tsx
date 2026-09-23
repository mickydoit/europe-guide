import { NavLink, useLocation } from 'react-router-dom'
import { Icon } from './Icon'

export const TABS = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/day', label: 'Day', icon: 'calendar' },
  { to: '/map', label: 'Map', icon: 'map' },
  { to: '/tickets', label: 'Tickets', icon: 'suitcase' },
  { to: '/more', label: 'More', icon: 'profile' },
] as const

/**
 * `mapsPending` marks the Map tab when a city you still have ahead of you has no offline map
 * on the phone. It is a dot rather than a count: the bar is glyph-only by design (Figma 1:85),
 * so the label carries the meaning for screen readers instead.
 */
export function TabBar({ mapsPending = false }: { mapsPending?: boolean } = {}) {
  const location = useLocation()
  if (location.pathname.startsWith('/map')) return null
  return (
    <nav className="tabbar">
      {TABS.map(t => {
        const marked = mapsPending && t.to === '/map'
        return (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            aria-label={marked ? `${t.label} — offline map not downloaded` : t.label}
            className={({ isActive }) => `tabbar__tab${isActive ? ' tabbar__tab--active' : ''}`}
          >
            <Icon set="nav" name={t.icon} size={32} />
            {marked && <span className="tabbar__dot" aria-hidden="true" />}
          </NavLink>
        )
      })}
    </nav>
  )
}
