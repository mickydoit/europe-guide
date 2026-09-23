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

/** How long to keep trying to reach a restored offset while the screen fills in. */
const RESTORE_BUDGET_MS = 1500
/** A real gesture on the scroller ends the restore immediately — the owner is driving now. */
const TAKEOVER = ['touchstart', 'wheel', 'keydown'] as const
/**
 * True while a restore is re-applying. The clamped scrollTop it produces against a not-yet-filled
 * screen fires scroll events like any other; recording those would overwrite the very offset being
 * restored with 0, and the next attempt would have nothing left to aim at.
 */
let restoring = false

export function ScrollReset() {
  const { pathname, key } = useLocation()
  const navType = useNavigationType()

  // Record where this entry is scrolled, continuously, so leaving it needs no cleanup timing.
  useEffect(() => {
    const root = scroller()
    if (!root) return
    const onScroll = () => { if (!restoring) remember(key, root.scrollTop) }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [key])

  useLayoutEffect(() => {
    const y = (navType === 'POP' ? positions.get(key) : undefined) ?? 0
    const root = scroller()
    if (root) root.scrollTop = y
    // The window call stays for any host where the body scrolls.
    window.scrollTo(0, y)
    if (!y || !root) return

    // Getting here with an EMPTY screen is the normal case, not the edge case: iOS reloads a
    // backgrounded PWA, and the itinerary then arrives asynchronously (Supabase, or IndexedDB
    // when there is no signal). scrollTop is clamped to the content that exists, so the offset
    // above just became 0 and the saved position was applied to nothing. A single re-apply on
    // the next frame is far too early — the content is still hundreds of milliseconds away.
    //
    // So keep re-applying until it takes, the budget runs out, or the owner starts scrolling —
    // whichever comes first. Their own scroll always wins; nothing here fights a real gesture.
    restoring = true
    let stopped = false
    const deadline = Date.now() + RESTORE_BUDGET_MS
    const give_up = () => {
      if (stopped) return
      stopped = true
      restoring = false
      for (const ev of TAKEOVER) root.removeEventListener(ev, give_up)
    }
    const tick = () => {
      if (stopped) return
      if (root.scrollTop !== y) root.scrollTop = y
      // Settled, or out of time. Either way stop touching the scroller.
      if (root.scrollTop === y || Date.now() > deadline) { give_up(); return }
      requestAnimationFrame(tick)
    }
    for (const ev of TAKEOVER) root.addEventListener(ev, give_up, { passive: true })
    requestAnimationFrame(tick)
    return give_up
    // Keyed on pathname, not key: a tap on the tab you are already on is a no-op (see ScrollReset.test).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
  return null
}
