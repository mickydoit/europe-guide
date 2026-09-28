import { useEffect, useLayoutEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// #root is the scroller (base.css) and React Router keeps its offset across client-side
// navigations. Tapping into a new screen must land at the top; coming BACK must return to where
// the list was, so a long Tickets list or Day does not snap to the top after peeking into an event.
// Offsets are remembered per history entry (location.key) AND path, and mirrored to
// localStorage so an update reload, or iOS dropping the page in the background, does not lose them.
//
// Path as well as key, because React Router gives the first entry of EVERY browsing context the
// key 'default': keyed on that alone, the offset saved on one launch's first screen came back on
// the next launch's first screen, whichever screen that was. Same key and same path is a relaunch
// of the screen the offset belongs to; anything else starts at the top.
const STORE = 'europe-guide.scroll-positions'
const positions = new Map<string, number>(load())
/**
 * localStorage, not sessionStorage. A sessionStorage area belongs to one browsing context and
 * dies with it — and iOS terminating a backgrounded standalone PWA destroys exactly that. The
 * offsets were therefore guaranteed to be missing on the relaunch they were written for, which
 * is the case this whole mechanism exists to serve. localStorage outlives the process.
 */
function load(): Array<[string, number]> {
  // Anything but a list of [key, offset] pairs is ignored: this runs at module load, before
  // React or the error boundary exist, and a throw here is a blank app with no way to clear it.
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORE) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((e): e is [string, number] => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number')
  } catch { return [] }
}
function entryKey(key: string, pathname: string): string { return `${key}|${pathname}` }
function remember(key: string, y: number) {
  // Re-insert so the Map's iteration order is least-recently-used first. Map.set on an existing
  // key keeps its original slot, so without the delete a long-lived screen like Day would sit at
  // the front and be the first thing `slice(-50)` dropped, while disposable detail-screen entries
  // survived — evicting precisely the offset worth keeping.
  positions.delete(key)
  positions.set(key, y)
  try { localStorage.setItem(STORE, JSON.stringify([...positions].slice(-50))) } catch { /* private mode: memory only */ }
}

/** Test seam: what the module currently holds, including what it loaded at import time. */
export function savedOffsets(): ReadonlyMap<string, number> { return positions }
function scroller(): HTMLElement | null { return document.getElementById('root') }

/**
 * How long to keep trying to reach a restored offset while the screen fills in. The content
 * path is unbounded — trip.tsx asks Supabase for ten tables and only falls back to IndexedDB
 * once that fails, with no timeout anywhere — so on a roaming connection the itinerary can be
 * many seconds away. The old 1.5s expired long before it arrived and gave up for good.
 */
const RESTORE_BUDGET_MS = 10_000
/**
 * A real gesture ends the restore immediately — the owner is driving now.
 *
 * `touchmove`, NOT `touchstart`: touchstart fires for any finger contact at all, including a
 * tap on a link or an impatient tap on a screen still showing "Loading…". Treating that as a
 * scroll abandoned the restore on a screen that had not filled in yet — landing exactly where
 * this is meant to prevent. A drag is a scroll; a tap is not.
 */
const TAKEOVER = ['touchmove', 'wheel', 'keydown'] as const
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
    const onScroll = () => { if (!restoring) remember(entryKey(key, pathname), root.scrollTop) }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [key, pathname])

  useLayoutEffect(() => {
    const y = (navType === 'POP' ? positions.get(entryKey(key, pathname)) : undefined) ?? 0
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
