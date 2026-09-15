import { NavLink } from 'react-router-dom'
const tabs = [
  { to: '/', label: 'Home' }, { to: '/day', label: 'Day' }, { to: '/map', label: 'Map' },
  { to: '/bookings', label: 'Bookings' }, { to: '/more', label: 'More' },
]
export function TabBar() {
  return (
    <nav style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: 'calc(64px + var(--safe-bottom))',
      paddingBottom: 'var(--safe-bottom)', background: 'var(--bg-nav)', borderTop: '1px solid rgba(255,255,255,.15)',
      display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
      {tabs.map(t => (
        <NavLink key={t.to} to={t.to} end={t.to === '/'} style={({ isActive }) => ({
          color: 'white', opacity: isActive ? 1 : 0.4, textDecoration: 'none', fontSize: 12, fontWeight: 700 })}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
