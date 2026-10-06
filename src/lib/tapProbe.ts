/**
 * Evidence for the "nothing responds to a tap, but the page still scrolls" spells.
 *
 * Native scrolling keeps working even when the page's JavaScript is wedged or when something
 * is hit-tested in front of the controls, so the symptom alone cannot tell three causes apart:
 *
 *  1. the main thread is blocked — no event reaches JavaScript at all;
 *  2. the touch reaches JavaScript but lands on the wrong element (an overlay, or iOS's
 *     hit-test regions out of step with what is drawn, as after a keyboard or a scrolled
 *     window on an overflow:hidden body);
 *  3. the touch is cancelled by the system before it can become a click.
 *
 * This records, for every touch that does NOT produce a click within DEAD_TAP_MS, what the
 * event hit, what `elementFromPoint` says is under the finger, and the viewport/scroll state —
 * one `deadtap` line per tap. A timer that fires far later than scheduled writes a `lag` line,
 * which is the only trace a blocked main thread can leave. Cause 3 is already logged by main.tsx.
 *
 * Everything is best-effort and guarded: the probe must never be the thing that breaks a tap.
 */
export const DEAD_TAP_MS = 600
export const TOUCH_HANG_MS = 2500
export const LAG_SAMPLE_MS = 1000
export const LAG_REPORT_MS = 400

type Log = (event: string, detail?: string) => void

export function describeEl(el: Element | null | undefined): string {
  if (!el) return 'none'
  const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean)[0] : ''
  return cls ? `${el.tagName}.${cls}` : el.tagName
}

type Point = { x: number; y: number }
function pointOf(e: Event): Point | null {
  const t = (e as TouchEvent).changedTouches?.[0]
  if (t) return { x: t.clientX, y: t.clientY }
  const p = e as PointerEvent
  return typeof p.clientX === 'number' ? { x: p.clientX, y: p.clientY } : null
}

function viewportState(doc: Document, win: Window): string {
  const vv = win.visualViewport
  const root = doc.getElementById('root')
  const vvText = vv ? `${Math.round(vv.offsetTop)}/${Math.round(vv.height)}` : 'n/a'
  return `scrollY=${Math.round(win.scrollY || 0)} root=${Math.round(root?.scrollTop ?? 0)} vv=${vvText} inner=${win.innerHeight} active=${describeEl(doc.activeElement)}`
}

export function installTapProbe(log: Log, { doc, win }: { doc: Document; win: Window }): () => void {
  let pending: { at: number; timer: ReturnType<typeof setTimeout>; target: string; under: string } | null = null
  let hang: ReturnType<typeof setTimeout> | null = null
  let moved = false
  const safe = (fn: () => void) => { try { fn() } catch { /* the probe never throws into the app */ } }

  const onStart = (e: Event) => safe(() => {
    moved = false
    if (hang) clearTimeout(hang)
    const target = describeEl(e.target as Element)
    hang = setTimeout(() => { hang = null; log('touchhang', `${target} ${viewportState(doc, win)}`) }, TOUCH_HANG_MS)
  })
  const onMove = () => { moved = true }
  const onEnd = (e: Event) => safe(() => {
    if (hang) { clearTimeout(hang); hang = null }
    if (moved) return                                      // a drag is a scroll, not a tap
    const p = pointOf(e)
    const target = describeEl(e.target as Element)
    const under = p ? describeEl(doc.elementFromPoint(p.x, p.y)) : 'n/a'
    const state = viewportState(doc, win)
    if (pending) clearTimeout(pending.timer)
    const at = Date.now()
    const timer = setTimeout(() => {
      // No click followed this tap: the one line that says where it died.
      log('deadtap', `target=${target} under=${under} ${state}`)
      pending = { at, timer, target, under }               // kept so a late click can be matched
    }, DEAD_TAP_MS)
    pending = { at, timer, target, under }
  })
  const onClick = (e: Event) => safe(() => {
    if (!pending) return
    const elapsed = Date.now() - pending.at
    clearTimeout(pending.timer)
    if (elapsed > DEAD_TAP_MS) log('lateclick', `${describeEl(e.target as Element)} after ${elapsed}ms`)
    pending = null
  })

  const opts = { capture: true, passive: true } as const
  doc.addEventListener('touchstart', onStart, opts)
  doc.addEventListener('touchmove', onMove, opts)
  doc.addEventListener('touchend', onEnd, opts)
  doc.addEventListener('click', onClick, { capture: true })

  // Event-loop lag: a one-second timer that fires late by more than LAG_REPORT_MS means the main
  // thread was busy or frozen for that long. Written once per late tick, never on time.
  let expected = Date.now() + LAG_SAMPLE_MS
  const lag = setInterval(() => safe(() => {
    const now = Date.now()
    const late = now - expected
    if (late > LAG_REPORT_MS) log('lag', `${late}ms`)
    expected = now + LAG_SAMPLE_MS
  }), LAG_SAMPLE_MS)

  return () => {
    doc.removeEventListener('touchstart', onStart, opts)
    doc.removeEventListener('touchmove', onMove, opts)
    doc.removeEventListener('touchend', onEnd, opts)
    doc.removeEventListener('click', onClick, { capture: true })
    clearInterval(lag)
    if (pending) clearTimeout(pending.timer)
    if (hang) clearTimeout(hang)
    pending = null
  }
}
