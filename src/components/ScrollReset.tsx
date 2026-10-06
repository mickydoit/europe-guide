import { useLayoutEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { diag } from '../lib/diag'

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
 * many seconds away.
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
 * The screen the scroller currently belongs to, set in the layout effect — synchronously, in
 * the same commit that resets the scroller. The scroll listener is installed ONCE and charges
 * every event to this path.
 *
 * It used to be one listener per screen, swapped in a passive effect. The reset-to-top on the
 * way into a detail screen fires a scroll event, and the browser dispatches it before React has
 * run the passive effects that swap the listener — so the OLD screen's listener heard it and
 * wrote 0 over the offset it had just saved. Back then had nothing to restore. Whether the race
 * was lost depended on timing, which is why it hit some screens and not others.
 */
let currentPath: string | null = null
/**
 * True while a restore is re-applying. The clamped scrollTop it produces against a not-yet-filled
 * screen fires scroll events like any other; recording those would overwrite the very offset being
 * restored with 0, and the next attempt would have nothing left to aim at.
 */
let restoring = false
let listening = false
function listen(root: HTMLElement) {
  if (listening) return
  listening = true
  root.addEventListener('scroll', () => { if (!restoring && currentPath) remember(currentPath, root.scrollTop) }, { passive: true })
}

/**
 * Re-apply `y` whenever the content changes size, until it takes, the budget runs out or the
 * owner scrolls. NOT every animation frame: a list can come back shorter than the offset (a
 * collapsed "earlier days" list, a screen still loading), and a loop that writes scrollTop
 * sixty times a second for ten seconds — 1,203 writes measured in a real browser — is a
 * scroller being driven under the owner's finger. On iOS that swallows every tap.
 */
function restoreUntilSettled(root: HTMLElement, y: number, pathname: string): () => void {
  restoring = true
  let stopped = false
  let writes = 0
  const deadline = Date.now() + RESTORE_BUDGET_MS
  let observer: ResizeObserver | MutationObserver | null = null
  const stop = (reason: 'settled' | 'gesture' | 'timeout' | 'left') => () => {
    if (stopped) return
    stopped = true
    restoring = false
    observer?.disconnect()
    for (const ev of TAKEOVER) root.removeEventListener(ev, onGesture)
    clearTimeout(timer)
    diag('restore', `${reason} at ${Math.round(root.scrollTop)} after ${writes} write${writes === 1 ? '' : 's'}`)
  }
  const onGesture = stop('gesture')
  const timer = setTimeout(stop('timeout'), RESTORE_BUDGET_MS)
  const apply = () => {
    if (stopped) return
    if (Date.now() > deadline) { stop('timeout')(); return }
    if (Math.abs(root.scrollTop - y) > 1) { root.scrollTop = y; writes += 1 }
    if (Math.abs(root.scrollTop - y) <= 1) stop('settled')()
  }
  for (const ev of TAKEOVER) root.addEventListener(ev, onGesture, { passive: true })
  apply()
  if (stopped) return stop('left')
  // Content growing is the only thing that can make an unreachable offset reachable.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(apply)
    ro.observe(root)
    for (const child of Array.from(root.children)) ro.observe(child)
    observer = ro
  } else if (typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(apply)
    mo.observe(root, { childList: true, subtree: true })
    observer = mo
  }
  return stop('left')
}

export function ScrollReset() {
  const { pathname, key, state } = useLocation()
  const navType = useNavigationType()

  useLayoutEffect(() => {
    const root = scroller()
    if (root) listen(root)
    // Charged before the reset below, so the scroll event that reset fires lands on the new screen.
    currentPath = pathname
    // A Back inside this page (POP to an entry that is not the first) always restores. A launch
    // (POP onto the first entry) or a Back-fallback (a REPLACE that says `state.back`, made when
    // there was no entry to pop to) restores only a recent offset.
    const entry = positions.get(pathname)
    const back = navType === 'POP' || (navType === 'REPLACE' && (state as { back?: boolean } | null)?.back === true)
    const insidePage = navType === 'POP' && key !== 'default'
    const recent = !!entry && Date.now() - entry.at < LAUNCH_RESTORE_MS
    const y = entry && back && (insidePage || recent) ? entry.y : 0
    // Always to the top in this commit. The restore itself is written two frames LATER.
    //
    // ROOT CAUSE of the dead-tap spells (owner's phone, 6 Oct 2026, reproduced at will with
    // Day → open a stop → Back): writing #root.scrollTop here, in the layout effect of the very
    // commit that swaps one screen's DOM for another, left iOS swallowing every touch afterwards —
    // none reached the page, not even as touchcancel, while the main thread stayed alive — until
    // the app was killed. The same write made two animation frames after the commit, once iOS
    // has laid out and composited the new screen, never did (A/B on the device: "immediate"
    // froze every time, "deferred" never). #root is an async overflow scroller with the fixed
    // tab bar inside it; the exact WebKit mechanism is not pinned down, the trigger and its
    // removal are.
    if (root) root.scrollTop = 0
    // The window call stays for any host where the body scrolls.
    window.scrollTo(0, 0)
    if (!y || !root) return
    diag('restore', `start ${pathname} y=${y}`)
    let cleanup: (() => void) | null = null
    // Declared before the first request: a host that runs frames synchronously (tests) would
    // otherwise assign `raf` inside the callback before the `let` had initialised it.
    let raf = 0
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        root.scrollTop = y
        // Getting here with an EMPTY screen is the normal case, not the edge case: iOS reloads a
        // backgrounded PWA, and the itinerary then arrives asynchronously. scrollTop is clamped to
        // the content that exists, so the write above may have landed short of `y`.
        cleanup = restoreUntilSettled(root, y, pathname)
      })
    })
    return () => { cancelAnimationFrame(raf); cleanup?.() }
    // Keyed on pathname, not key: a tap on the tab you are already on is a no-op (see ScrollReset.test).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
  return null
}
