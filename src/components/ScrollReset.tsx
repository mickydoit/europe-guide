import { useEffect, useLayoutEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// #root is the scroller (base.css) and React Router keeps its offset across client-side
// navigations. Tapping into a new screen must land at the top; coming BACK must return to where
// the list was, so a long Tickets list or Day does not snap to the top after peeking into an event.
// Offsets are remembered per PATH, with the moment they were recorded, and mirrored to
// localStorage so an update reload, or iOS dropping the page in the background, does not lose them.
//
// Path, not history key. iOS recreates the page whenever it likes — reliably after a ticket PDF
// opens in a new window and the app sits behind it — and the new page has a fresh history: one
// entry, key 'default', and no memory of the entries before it. Keyed by history key, the saved
// offset could never be found again, so every Back after that landed at the top (and the Back
// button itself, with no entry to pop to, falls back to a REPLACE that never restored anything).
// The path is the one thing both pages agree on.
const STORE = 'europe-guide.scroll-positions'
type Entry = { y: number; at: number }
const positions = new Map<string, Entry>(load())
/**
 * How recent an offset must be for a (re)launch to restore it. A page iOS dropped ten minutes
 * ago should come back where it was; the app opened over breakfast the next day should not open
 * scrolled to wherever it was last night.
 */
const LAUNCH_RESTORE_MS = 60 * 60 * 1000
/**
 * localStorage, not sessionStorage. A sessionStorage area belongs to one browsing context and
 * dies with it — and iOS terminating a backgrounded standalone PWA destroys exactly that. The
 * offsets were therefore guaranteed to be missing on the relaunch they were written for, which
 * is the case this whole mechanism exists to serve. localStorage outlives the process.
 */
function load(): Array<[string, Entry]> {
  // Anything but a list of [path, { y, at }] pairs is ignored: this runs at module load, before
  // React or the error boundary exist, and a throw here is a blank app with no way to clear it.
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORE) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((e): e is [string, Entry] =>
      Array.isArray(e) && typeof e[0] === 'string' && !!e[1] && typeof e[1] === 'object'
      && typeof (e[1] as Entry).y === 'number' && typeof (e[1] as Entry).at === 'number')
  } catch { return [] }
}
function remember(key: string, y: number) {
  // Re-insert so the Map's iteration order is least-recently-used first. Map.set on an existing
  // key keeps its original slot, so without the delete a long-lived screen like Day would sit at
  // the front and be the first thing `slice(-50)` dropped, while disposable detail-screen entries
  // survived — evicting precisely the offset worth keeping.
  positions.delete(key)
  positions.set(key, { y, at: Date.now() })
  try { localStorage.setItem(STORE, JSON.stringify([...positions].slice(-50))) } catch { /* private mode: memory only */ }
}

/** Test seam: what the module currently holds, including what it loaded at import time. */
export function savedOffsets(): ReadonlyMap<string, number> { return new Map([...positions].map(([k, e]) => [k, e.y])) }
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
  const { pathname, key, state } = useLocation()
  const navType = useNavigationType()

  // Record where this entry is scrolled, continuously, so leaving it needs no cleanup timing.
  useEffect(() => {
    const root = scroller()
    if (!root) return
    const onScroll = () => { if (!restoring) remember(pathname, root.scrollTop) }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [pathname])

  useLayoutEffect(() => {
    // A Back inside this page (POP to an entry that is not the first) always restores. A launch
    // (POP onto the first entry) or a Back-fallback (a REPLACE that says `state.back`, made when
    // there was no entry to pop to) restores only a recent offset.
    const entry = positions.get(pathname)
    const back = navType === 'POP' || (navType === 'REPLACE' && (state as { back?: boolean } | null)?.back === true)
    const insidePage = navType === 'POP' && key !== 'default'
    const recent = !!entry && Date.now() - entry.at < LAUNCH_RESTORE_MS
    const y = entry && back && (insidePage || recent) ? entry.y : 0
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
