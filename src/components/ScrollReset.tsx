import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'

// #root is the scroller and React Router keeps its offset across client-side
// navigations. Tapping a tab from a long, scrolled screen to a shorter one therefore landed
// part-way down (Bookings) or, on iOS, left the body over-scrolled with the fixed tab bar
// lifted off the bottom. Reset to the top on every pathname change, before paint.
export function ScrollReset() {
  const { pathname } = useLocation()
  useLayoutEffect(() => {
    // #root is the scroller (base.css); the window call stays for any host where the body scrolls.
    const root = document.getElementById('root')
    if (root) root.scrollTop = 0
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}
