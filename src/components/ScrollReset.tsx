import { useEffect, useLayoutEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// #root is the scroller (base.css) and React Router keeps its offset across client-side
// navigations. Tapping into a new screen must land at the top; coming BACK must return to where
// the list was, so a long Tickets list or Day does not snap to the top after peeking into an event.
// Offsets are remembered per history entry (location.key) for the life of the page.
// Mirrored to sessionStorage so an update reload, or iOS dropping the page in the background, does
// not lose them; sessionStorage is per tab and dies with it, which is exactly the lifetime wanted.
const STORE = 'scroll-positions'
const positions = new Map<string, number>(load())
function load(): Array<[string, number]> {
  try { return JSON.parse(sessionStorage.getItem(STORE) ?? '[]') as Array<[string, number]> } catch { return [] }
}
function remember(key: string, y: number) {
  positions.set(key, y)
  try { sessionStorage.setItem(STORE, JSON.stringify([...positions].slice(-50))) } catch { /* private mode: memory only */ }
}
function scroller(): HTMLElement | null { return document.getElementById('root') }

export function ScrollReset() {
  const { pathname, key } = useLocation()
  const navType = useNavigationType()

  // Record where this entry is scrolled, continuously, so leaving it needs no cleanup timing.
  useEffect(() => {
    const root = scroller()
    if (!root) return
    const onScroll = () => { remember(key, root.scrollTop) }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [key])

  useLayoutEffect(() => {
    const y = (navType === 'POP' ? positions.get(key) : undefined) ?? 0
    const root = scroller()
    if (root) root.scrollTop = y
    // The window call stays for any host where the body scrolls.
    window.scrollTo(0, y)
    // A restored screen may still be filling in (photos, async rows); re-apply once it has painted.
    if (y) requestAnimationFrame(() => { const r = scroller(); if (r && r.scrollTop !== y) r.scrollTop = y })
    // Keyed on pathname, not key: a tap on the tab you are already on is a no-op (see ScrollReset.test).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
  return null
}
