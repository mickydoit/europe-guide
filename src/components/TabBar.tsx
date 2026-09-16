import { NavLink, useLocation } from 'react-router-dom'
import { Icon } from './Icon'

export const TABS = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/day', label: 'Day', icon: 'calendar' },
  { to: '/map', label: 'Map', icon: 'map' },
  { to: '/tickets', label: 'Tickets', icon: 'suitcase' },
  { to: '/more', label: 'More', icon: 'profile' },
] as const

export function TabBar() {
  const location = useLocation()
  if (location.pathname.startsWith('/map')) return null
  return (
    <nav className="tabbar">
      {TABS.map(t => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          aria-label={t.label}
          className={({ isActive }) => `tabbar__tab${isActive ? ' tabbar__tab--active' : ''}`}
        >
          <Icon set="nav" name={t.icon} size={32} />
        </NavLink>
      ))}
    </nav>
  )
}
