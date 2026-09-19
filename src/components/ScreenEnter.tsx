import { Outlet, useLocation } from 'react-router-dom'

/** Fades and lifts each screen in (base.css .screen-enter). Keyed by the first path segment, so a
 *  tab change or a detail open replays it and a date change on Day does not. The map is a
 *  full-screen fixed canvas: an animated ancestor would stack it under the tab bar mid-fade, so it
 *  renders bare. */
export function ScreenEnter() {
  const { pathname } = useLocation()
  const tab = pathname.split('/')[1] || 'home'
  if (tab === 'map') return <Outlet />
  return <div key={tab} className="screen-enter"><Outlet /></div>
}
