import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { installTapProbe, describeEl, DEAD_TAP_MS, LAG_SAMPLE_MS, LAG_REPORT_MS } from '../../src/lib/tapProbe'

function touch(type: string, target: Element, x: number, y: number) {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & { changedTouches: unknown }
  Object.defineProperty(ev, 'changedTouches', { value: [{ clientX: x, clientY: y, target }] })
  target.dispatchEvent(ev)
}

let lines: string[]
let uninstall: () => void
let tab: HTMLAnchorElement
let overlay: HTMLDivElement
let root: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  lines = []
  document.body.innerHTML = '<div id="root" style="overflow:auto"><a id="tab" class="tabbar__tab x" href="#">Day</a></div><div id="overlay" class="sheet-root"></div>'
  tab = document.getElementById('tab') as HTMLAnchorElement
  overlay = document.getElementById('overlay') as HTMLDivElement
  root = document.getElementById('root') as HTMLDivElement
  // jsdom has no layout: elementFromPoint is stubbed per test.
  document.elementFromPoint = () => tab
  uninstall = installTapProbe((event, detail) => { lines.push(`${event} ${detail ?? ''}`.trim()) }, { doc: document, win: window })
})
afterEach(() => { uninstall(); vi.useRealTimers(); document.body.innerHTML = '' })

describe('describeEl', () => {
  test('tag plus first class, or just the tag', () => {
    expect(describeEl(tab)).toBe('A.tabbar__tab')
    expect(describeEl(document.body)).toBe('BODY')
    expect(describeEl(null)).toBe('none')
  })
})

describe('dead taps', () => {
  test('a tap that becomes a click logs nothing', () => {
    touch('touchstart', tab, 40, 800)
    touch('touchend', tab, 40, 800)
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    vi.advanceTimersByTime(DEAD_TAP_MS + 10)
    expect(lines).toEqual([])
  })

  test('a tap with no click within the window logs a deadtap line with the hit-test target and viewport state', () => {
    document.elementFromPoint = () => overlay          // something else is under the finger
    touch('touchstart', tab, 40, 800)
    touch('touchend', tab, 40, 800)
    vi.advanceTimersByTime(DEAD_TAP_MS + 10)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^deadtap target=A\.tabbar__tab under=DIV\.sheet-root/)
    expect(lines[0]).toMatch(/scrollY=\d+/)
    expect(lines[0]).toMatch(/root=\d+/)
    expect(lines[0]).toMatch(/vv=/)
    expect(lines[0]).toMatch(/active=/)
  })

  test('a drag (touchmove between start and end) is a scroll, not a dead tap', () => {
    touch('touchstart', tab, 40, 800)
    touch('touchmove', tab, 40, 700)
    touch('touchend', tab, 40, 700)
    vi.advanceTimersByTime(DEAD_TAP_MS + 10)
    expect(lines).toEqual([])
  })

  test('a touchstart that never ends logs touchhang once', () => {
    touch('touchstart', tab, 40, 800)
    vi.advanceTimersByTime(3000)
    expect(lines.filter(l => l.startsWith('touchhang'))).toHaveLength(1)
  })

  test('a click that arrives late is still a dead tap followed by a lateclick line', () => {
    touch('touchstart', tab, 40, 800)
    touch('touchend', tab, 40, 800)
    vi.advanceTimersByTime(DEAD_TAP_MS + 10)
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(lines[0]).toMatch(/^deadtap/)
    expect(lines[1]).toMatch(/^lateclick A\.tabbar__tab after \d+ms/)
  })
})

describe('event-loop lag', () => {
  test('a timer that fires far later than scheduled logs a lag line; an on-time one does not', () => {
    vi.advanceTimersByTime(LAG_SAMPLE_MS)                 // on time
    expect(lines.filter(l => l.startsWith('lag'))).toEqual([])
    // Simulate the main thread being blocked: the clock jumps before the timer runs.
    vi.setSystemTime(Date.now() + LAG_SAMPLE_MS + LAG_REPORT_MS + 500)
    vi.advanceTimersByTime(LAG_SAMPLE_MS)
    const lag = lines.filter(l => l.startsWith('lag'))
    expect(lag).toHaveLength(1)
    expect(lag[0]).toMatch(/^lag \d+ms/)
  })
})

describe('cancelled touches', () => {
  test('a touch iOS cancels logs how long it was down, how far it moved, what the scroller did and what was under it', () => {
    document.elementFromPoint = () => overlay
    touch('touchstart', tab, 40, 800)
    vi.advanceTimersByTime(120)
    touch('touchcancel', tab, 40, 800)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^touchcancel A\.tabbar__tab under=DIV\.sheet-root after=12\dms moved=0px rootΔ=0 scrolled=no connected=yes /)
    expect(lines[0]).toMatch(/lastWrite=none$/)
    vi.advanceTimersByTime(3000)
    expect(lines).toHaveLength(1)                          // no touchhang after a cancel
  })

  test('a cancel after the scroller was written underneath the finger names the writer and the delta', () => {
    touch('touchstart', tab, 40, 800)
    root.scrollTop = 350                                   // programmatic write while the finger is down
    root.dispatchEvent(new Event('scroll'))
    touch('touchcancel', tab, 40, 800)
    expect(lines[0]).toMatch(/rootΔ=350 scrolled=yes/)
    expect(lines[0]).toMatch(/lastWrite=\d+ms ago by /)
    expect(lines[0]).not.toMatch(/lastWrite=none/)
  })

  test('a cancel whose target was removed from the page says so', () => {
    touch('touchstart', tab, 40, 800)
    tab.remove()                                            // the screen re-rendered under the finger
    touch('touchcancel', root, 40, 800)                     // the cancel arrives via the ancestor that is still in the page
    expect(lines[0]).toMatch(/connected=NO/)
  })

  test('a cancel after a drag reports the distance moved', () => {
    touch('touchstart', tab, 40, 800)
    touch('touchmove', tab, 40, 760)
    touch('touchcancel', tab, 40, 760)
    expect(lines[0]).toMatch(/moved=40px/)
  })

  test('window.scrollTo is traced as a writer too', () => {
    touch('touchstart', tab, 40, 800)
    window.scrollTo(0, 10)
    touch('touchcancel', tab, 40, 800)
    expect(lines[0]).toMatch(/lastWrite=\d+ms ago by scrollTo/)
  })
})

test('uninstall removes the listeners and timers', () => {
  uninstall()
  touch('touchstart', tab, 40, 800)
  touch('touchend', tab, 40, 800)
  vi.advanceTimersByTime(DEAD_TAP_MS + 3000)
  expect(lines).toEqual([])
  uninstall = () => {}
})
