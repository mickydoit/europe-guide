/**
 * Evidence for the "nothing responds to a tap, but the page still scrolls" spells.
 *
 * Native scrolling keeps working even when the page's JavaScript is wedged or when something
 * is hit-tested in front of the controls, so the symptom alone cannot tell the causes apart:
 *
 *  1. the main thread is blocked — no event reaches JavaScript at all (only a `lag` line can
 *     show it);
 *  2. the touch reaches JavaScript but lands on the wrong element (an overlay, or iOS's
 *     hit-test regions out of step with what is drawn) — a `deadtap` line;
 *  3. the touch is CANCELLED by the system before it can become a click — a `touchcancel`
 *     line. The 6 Oct log showed exactly this: ten cancels in eight seconds, on cards, headings
 *     and the tab bar alike, with the main thread responsive. WebKit cancels a touch when a
 *     native gesture claims it or when the content under the finger is scrolled or replaced, so
 *     the cancel line records how long the finger was down, how far it moved, whether the
 *     scroller moved underneath it, whether the touched element was still in the page, and who
 *     last wrote the scroller's position.
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

/** The last programmatic write to the scroller's position, and the code that made it. */
type Writer = { at: number; by: string }
let lastWrite: Writer | null = null

/** Two frames of a stack, file and line only — enough to name the writer, short enough for a log line. */
function caller(): string {
  const stack = (new Error().stack ?? '').split('\n').map(s => s.trim()).filter(Boolean)
  // Drop the Error line and this function and the setter itself.
  const frames = stack.filter(f => !/^Error|caller|scrollTop|scrollTo/.test(f)).slice(0, 2)
  return frames.map(f => f.replace(/^at\s+/, '').replace(/https?:\/\/[^/]+\/[^ ]*?\/([^/)]+)\)?$/, '$1')).join(' < ') || '?'
}

/**
 * Record every programmatic write of #root.scrollTop and every window.scrollTo. A touch that was
 * cancelled while the scroller moved underneath it is explained by whichever of these ran last.
 */
export function traceScrollWrites(root: HTMLElement, win: Window): () => void {
  const proto = Object.getPrototypeOf(root) as object
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop') ?? findDescriptor(proto, 'scrollTop')
  if (desc?.set && desc.get && Object.getOwnPropertyDescriptor(root, 'scrollTop') === undefined) {
    Object.defineProperty(root, 'scrollTop', {
      configurable: true,
      get() { return desc.get!.call(root) as number },
      set(v: number) { lastWrite = { at: Date.now(), by: caller() }; desc.set!.call(root, v) },
    })
  }
  const original = win.scrollTo
  const wrapped = function (this: Window, ...args: unknown[]) {
    lastWrite = { at: Date.now(), by: `scrollTo < ${caller()}` }
    return (original as (...a: unknown[]) => void).apply(this, args)
  }
  try { win.scrollTo = wrapped as typeof win.scrollTo } catch { /* read-only in some hosts */ }
  return () => {
    try { delete (root as unknown as { scrollTop?: number }).scrollTop } catch { /* fine */ }
    try { win.scrollTo = original } catch { /* fine */ }
  }
}
function findDescriptor(o: object | null, key: string): PropertyDescriptor | undefined {
  for (let p = o; p; p = Object.getPrototypeOf(p) as object | null) {
    const d = Object.getOwnPropertyDescriptor(p, key); if (d) return d
  }
  return undefined
}
function lastWriteText(now: number): string {
  return lastWrite ? `lastWrite=${now - lastWrite.at}ms ago by ${lastWrite.by}` : 'lastWrite=none'
}

export function installTapProbe(log: Log, { doc, win }: { doc: Document; win: Window }): () => void {
  let pending: { at: number; timer: ReturnType<typeof setTimeout>; target: string; under: string } | null = null
  let hang: ReturnType<typeof setTimeout> | null = null
  // The touch in progress: where it started, what it hit, and what the scroller did meanwhile.
  let touch: { at: number; point: Point | null; target: Element | null; rootTop: number; maxMove: number; scrolled: boolean } | null = null
  const safe = (fn: () => void) => { try { fn() } catch { /* the probe never throws into the app */ } }
  const root = () => doc.getElementById('root')
  const untrace = root() ? traceScrollWrites(root()!, win) : () => {}

  const onStart = (e: Event) => safe(() => {
    if (hang) clearTimeout(hang)
    const target = e.target as Element | null
    touch = { at: Date.now(), point: pointOf(e), target, rootTop: root()?.scrollTop ?? 0, maxMove: 0, scrolled: false }
    const desc = describeEl(target)
    hang = setTimeout(() => { hang = null; log('touchhang', `${desc} ${viewportState(doc, win)}`) }, TOUCH_HANG_MS)
  })
  const onMove = (e: Event) => safe(() => {
    if (!touch) return
    const p = pointOf(e)
    if (p && touch.point) touch.maxMove = Math.max(touch.maxMove, Math.hypot(p.x - touch.point.x, p.y - touch.point.y))
    else touch.maxMove = Math.max(touch.maxMove, 1)
  })
  const onRootScroll = () => { if (touch) touch.scrolled = true }
  const onEnd = (e: Event) => safe(() => {
    if (hang) { clearTimeout(hang); hang = null }
    const t = touch; touch = null
    if (t && t.maxMove > 0) return                        // a drag is a scroll, not a tap
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
  const onCancel = (e: Event) => safe(() => {
    if (hang) { clearTimeout(hang); hang = null }
    const t = touch; touch = null
    const now = Date.now()
    const target = describeEl(e.target as Element)
    if (!t) { log('touchcancel', `${target} (no touchstart seen) ${viewportState(doc, win)}`); return }
    const under = t.point ? describeEl(doc.elementFromPoint(t.point.x, t.point.y)) : 'n/a'
    const rootNow = root()?.scrollTop ?? 0
    const connected = t.target ? (t.target.isConnected ? 'yes' : 'NO') : 'n/a'
    log('touchcancel', `${target} under=${under} after=${now - t.at}ms moved=${Math.round(t.maxMove)}px rootΔ=${Math.round(rootNow - t.rootTop)} scrolled=${t.scrolled ? 'yes' : 'no'} connected=${connected} ${viewportState(doc, win)} ${lastWriteText(now)}`)
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
  doc.addEventListener('touchcancel', onCancel, opts)
  doc.addEventListener('click', onClick, { capture: true })
  root()?.addEventListener('scroll', onRootScroll, { passive: true })

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
    doc.removeEventListener('touchcancel', onCancel, opts)
    doc.removeEventListener('click', onClick, { capture: true })
    root()?.removeEventListener('scroll', onRootScroll)
    clearInterval(lag)
    if (pending) clearTimeout(pending.timer)
    if (hang) clearTimeout(hang)
    pending = null
    touch = null
    untrace()
    lastWrite = null
  }
}
