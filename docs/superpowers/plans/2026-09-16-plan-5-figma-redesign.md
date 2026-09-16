# Europe Guide — Plan 5: Figma redesign (theme, tab bar, Home, Tickets, detail screens, restyle)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the live PWA to the Figma look (deep-teal / lavender / yellow cards, Overpass + Poppins, five-icon tab bar), rebuild Home around a next-up ticket, add a Tickets tab that replaces Bookings with an upcoming view grouped by country → city → day, and add ticket and place detail screens.

**Architecture:** Restyle in place. `tokens.css` is replaced and every component re-pointed; legacy tone aliases keep the suite green until the last task removes them. Ticket logic (kind inference, next-up selection, grouping, card lines, four-cell strip) lives in one pure module `src/lib/tickets.ts` with unit tests; two presentational components `TicketCard` and `PlaceCard` are used by Home, Tickets and Day; two route screens `TicketDetail` (`/ticket/:trip/:id`, choosing the boarding-pass or the place layout by kind) and `PlaceDetail` (`/place/:id`) reuse the booking form and attachments panel extracted from today's Bookings sheet. No database change: a booking's kind comes from `fields.kind` (the markdown `**kind:**` field, which the parser already stores in `fields`) or from title inference.

**Tech Stack:** unchanged (Vite 8, React 19, react-router 7, Vitest 5 + Testing Library, vite-plugin-pwa). Fonts and icon SVGs are already in `design/figma-assets/redesign/` (downloaded 16 Sep from Figma `KMHaWP7ikFa3IimN3cx520` and Google Fonts).

**Spec:** `docs/superpowers/specs/2026-09-16-figma-redesign-design.md` §3–§5, §7–§10 steps 1–5. Photos (§6, step 6) are Plan 6.

## Global Constraints

- Every task ends with `npx vitest run` green and `npm run build` succeeding. The suite is 453 tests at the start; it never drops below that count minus tests deliberately deleted with the screens they covered (Bookings.test.tsx, OptionsCard/TileRow coverage inside Home.test.tsx).
- Exact palette from the Figma fills: `--bg #070606`, `--surface #08353D`, `--accent #22DD85`, `--highlight #F7FF88`, `--lavender #BCA5ED`, dark text on yellow `#083740`, dark text on lavender `#070606`. Cards: 24 px radius, 24 px padding, kind icon 72 px at 50% opacity on the right.
- Card colour by kind: `transport → --surface`, `accommodation → --highlight`, `event → --lavender`, the single next-up card on Home `→ --highlight`, `past → #131313`.
- Fonts: Overpass (variable file, weights 400/600/800 used) for UI; Poppins 500/700 for ticket titles and faces only. Self-hosted under `public/fonts/`, `woff2` added to the workbox precache glob. System font stack as fallback.
- Tabs: Home `/`, Day `/day`, Map `/map`, Tickets `/tickets`, More `/more`. `/bookings` redirects to `/tickets`. Tab bar hidden on `/map` as today; `ScrollReset` stays in the Shell.
- Booking kind: `fields.kind` when it is one of `transport | accommodation | event`, otherwise inferred from the **title only** (spec §4 said title and notes; notes mention taxis incidentally and misfire, so this plan uses title only — spec amended).
- Walk-in bookings (`kind === 'walkin'`) are never tickets and never cards.
- Times shown in trip timezone via `nowInTz`; never `new Date().getHours()`.
- Screens never talk to Supabase directly; all writes go through `state.ts` hooks as today.
- Commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; never commit `content/`, `.env`, `.cache/`.
- Work on branch `feat/figma-redesign` created from `main` at the start of Task 1.

## File structure

```
public/fonts/{overpass-variable,poppins-500,poppins-700}.woff2      copied from design/figma-assets/redesign/fonts
public/icons/nav/{home,calendar,map,suitcase,profile}.svg           home/suitcase/profile from Figma; calendar/map authored (same 35-box weight)
public/icons/kind/{plane,car,hotel,event}.svg                       plane/car/hotel from Figma; event authored (ticket stub glyph)
src/styles/tokens.css        new palette + fonts + radii (+ legacy aliases until Task 8)
src/styles/base.css          @font-face, restyled blocks, new component styles
src/lib/tickets.ts           TicketKind, inferKind, isTicket, ticketsForDay, nextTicket, groupByDate, countriesOf, ticketLines, fourCells, effectiveStatus, cycleStatus, bookingForStop, stopsForCards
src/lib/config.ts            OWNER_NAME from VITE_OWNER_NAME
src/components/Icon.tsx      <Icon name kind size /> — CSS-mask coloured SVG from /icons
src/components/TabBar.tsx    five tabs with icons
src/components/TicketCard.tsx, PlaceCard.tsx, NextUpCard.tsx, StatusPill.tsx, StopRow.tsx
src/components/BookingForm.tsx, AttachmentsPanel.tsx   extracted from screens/Bookings.tsx
src/screens/Home.tsx (rebuilt), Tickets.tsx (new), TicketDetail.tsx (new), PlaceDetail.tsx (new), Day.tsx (rows), More.tsx (restyle, picker removed)
src/App.tsx                  routes
tests/lib/tickets.test.ts, tests/app/{TabBar,TicketCard,Home,Tickets,TicketDetail,PlaceDetail,Day,More}.test.tsx
tools/probe-session.mjs, tools/probe-screens.mjs   headless screenshot recipe (Task 9)
```

Deleted by the end: `src/screens/Bookings.tsx`, `tests/app/Bookings.test.tsx`, `src/components/{OptionsCard,TileRow,TripPicker,StopCard}.tsx`, `src/lib/home.ts` functions no longer used (`currentBlockOptions`, `toursToday`, `tripCountdowns`, `legsToday` — keep `openReminders`, `cityDot` and the LON/LAT constants).

---

### Task 1: Theme tokens, fonts, icon assets

**Files:**
- Create: `public/fonts/*.woff2`, `public/icons/nav/*.svg`, `public/icons/kind/*.svg`
- Modify: `src/styles/tokens.css`, `src/styles/base.css` (top of file), `vite.config.ts:24`
- Test: `tests/app/theme.test.ts`

**Interfaces:**
- Produces CSS custom properties consumed by every later task: `--bg --surface --surface-deep --card-dark --bg-nav --accent --highlight --lavender --text --text-soft --text-dim --text-on-light --text-on-lavender --border --muted --pill --radius-card --radius-panel --radius-pill --font --font-ticket --safe-top --safe-bottom`.
- Legacy aliases (removed in Task 8): `--card --card-alt --bg-2 --salmon --banana --granny --golden --columbia --coral`.

- [ ] **Step 1: Branch and copy assets**

```bash
cd ~/Developer/Github/europe-guide && git checkout main && git pull -q && git checkout -b feat/figma-redesign
mkdir -p public/fonts public/icons/nav public/icons/kind
cp design/figma-assets/redesign/fonts/*.woff2 public/fonts/
cp design/figma-assets/redesign/icons/nav-home.svg public/icons/nav/home.svg
cp design/figma-assets/redesign/icons/nav-suitcase.svg public/icons/nav/suitcase.svg
cp design/figma-assets/redesign/icons/nav-profile.svg public/icons/nav/profile.svg
cp design/figma-assets/redesign/icons/card-plane.svg public/icons/kind/plane.svg
cp design/figma-assets/redesign/icons/card-car.svg public/icons/kind/car.svg
cp design/figma-assets/redesign/icons/card-hotel.svg public/icons/kind/hotel.svg
```

- [ ] **Step 2: Author the two nav icons and the event icon the Figma lacks**

The Figma nav has no calendar or map-pin glyph. These are drawn to the same 35-box, filled, rounded weight as the Iconly Bold set the file uses. They are rendered through a CSS mask, so fill colour in the file is irrelevant.

`public/icons/nav/calendar.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 35 35"><path fill="#000" d="M11 3.5a1.5 1.5 0 0 1 3 0V6h7V3.5a1.5 1.5 0 0 1 3 0V6h1.5A4.5 4.5 0 0 1 30 10.5v16A4.5 4.5 0 0 1 25.5 31h-16A4.5 4.5 0 0 1 5 26.5v-16A4.5 4.5 0 0 1 9.5 6H11V3.5ZM8 14v12.5A1.5 1.5 0 0 0 9.5 28h16a1.5 1.5 0 0 0 1.5-1.5V14H8Zm3.5 4h4v4h-4v-4Zm8 0h4v4h-4v-4Z"/></svg>
```

`public/icons/nav/map.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 35 35"><path fill="#000" d="M17.5 2.5C11.15 2.5 6 7.55 6 13.8c0 7.2 8.7 15.9 10.4 17.55a1.6 1.6 0 0 0 2.2 0C20.3 29.7 29 21 29 13.8 29 7.55 23.85 2.5 17.5 2.5Zm0 15.6a4.3 4.3 0 1 1 0-8.6 4.3 4.3 0 0 1 0 8.6Z"/></svg>
```

`public/icons/kind/event.svg` (a ticket stub, used for event and tour cards until photos land in Plan 6):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 90"><path fill="#000" d="M12 22a6 6 0 0 1 6-6h54a6 6 0 0 1 6 6v12a7 7 0 0 0 0 14v12a6 6 0 0 1-6 6H18a6 6 0 0 1-6-6V48a7 7 0 0 0 0-14V22Zm44 0v46h4V22h-4Z"/></svg>
```

- [ ] **Step 3: Write the failing theme test**

`tests/app/theme.test.ts`:
```ts
import { readFileSync, existsSync } from 'node:fs'
import { test, expect } from 'vitest'

const tokens = readFileSync('src/styles/tokens.css', 'utf8')
const base = readFileSync('src/styles/base.css', 'utf8')

test('tokens carry the Figma palette', () => {
  for (const v of ['--bg: #070606', '--surface: #08353D', '--accent: #22DD85', '--highlight: #F7FF88', '--lavender: #BCA5ED']) {
    expect(tokens).toContain(v)
  }
  expect(tokens).toMatch(/--font: 'Overpass'/)
  expect(tokens).toMatch(/--font-ticket: 'Poppins'/)
  expect(tokens).toMatch(/--radius-card: 24px/)
})

test('fonts are self-hosted and declared', () => {
  for (const f of ['overpass-variable', 'poppins-500', 'poppins-700']) expect(existsSync(`public/fonts/${f}.woff2`)).toBe(true)
  expect(base).toMatch(/@font-face\s*\{[^}]*font-family: 'Overpass'[^}]*font-weight: 100 900/)
  expect(base).toMatch(/@font-face\s*\{[^}]*font-family: 'Poppins'[^}]*font-weight: 700/)
})

test('nav and kind icons exist', () => {
  for (const n of ['home', 'calendar', 'map', 'suitcase', 'profile']) expect(existsSync(`public/icons/nav/${n}.svg`)).toBe(true)
  for (const n of ['plane', 'car', 'hotel', 'event']) expect(existsSync(`public/icons/kind/${n}.svg`)).toBe(true)
})

test('workbox precaches woff2', () => {
  expect(readFileSync('vite.config.ts', 'utf8')).toMatch(/globPatterns: \['\*\*\/\*\.\{[^}]*woff2/)
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run tests/app/theme.test.ts`
Expected: FAIL on the palette assertions (tokens still `#202123`).

- [ ] **Step 5: Replace tokens.css**

```css
:root {
  /* Figma KMHaWP7ikFa3IimN3cx520 — sampled from card fills, not the style-guide labels */
  --bg: #070606; --surface: #08353D; --surface-deep: #083740; --card-dark: #131313;
  --bg-nav: rgba(7, 6, 6, .9);
  --accent: #22DD85; --highlight: #F7FF88; --lavender: #BCA5ED;
  --text: #ffffff; --text-soft: rgba(255,255,255,.7); --text-dim: rgba(255,255,255,.45);
  --text-on-light: #083740; --text-on-lavender: #070606;
  --border: rgba(255,255,255,.12); --muted: rgba(255,255,255,.18); --pill: rgba(255,255,255,.1);
  --radius-card: 24px; --radius-panel: 20px; --radius-pill: 9999px;
  --font: 'Overpass', -apple-system, "SF Pro Text", system-ui, sans-serif;
  --font-ticket: 'Poppins', 'Overpass', -apple-system, system-ui, sans-serif;
  --safe-top: env(safe-area-inset-top); --safe-bottom: env(safe-area-inset-bottom);

  /* Legacy aliases — every remaining use is re-pointed and these lines deleted in Task 8. */
  --card: var(--surface); --card-alt: #0a2b31; --bg-2: #0a2b31;
  --salmon: var(--lavender); --banana: var(--highlight); --granny: var(--accent); --golden: var(--highlight);
  --columbia: var(--lavender); --coral: var(--lavender);
}
```

- [ ] **Step 6: Add @font-face and base type to base.css**

Replace lines 1–10 of `src/styles/base.css` with:
```css
@import './tokens.css';
@font-face { font-family: 'Overpass'; font-style: normal; font-weight: 100 900; font-display: swap;
  src: url('/europe-guide/fonts/overpass-variable.woff2') format('woff2'); }
@font-face { font-family: 'Poppins'; font-style: normal; font-weight: 500; font-display: swap;
  src: url('/europe-guide/fonts/poppins-500.woff2') format('woff2'); }
@font-face { font-family: 'Poppins'; font-style: normal; font-weight: 700; font-display: swap;
  src: url('/europe-guide/fonts/poppins-700.woff2') format('woff2'); }
*, *::before, *::after { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font-family: var(--font); -webkit-font-smoothing: antialiased; }
a { color: var(--accent); }
button { font: inherit; }
.screen { padding: calc(var(--safe-top) + 16px) 16px calc(var(--safe-bottom) + 96px); min-height: 100%; }
.h5 { font-size: 20px; font-weight: 800; line-height: 1; margin: 0 0 16px; }
.caption { font-size: 14px; line-height: 16px; color: var(--text-dim); }
```

- [ ] **Step 7: Precache fonts**

In `vite.config.ts` change the glob to `globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,pbf,json,mjs,woff2}'],`.

- [ ] **Step 8: Run the whole suite and build**

Run: `npx vitest run && npm run build`
Expected: all green (453 + 4 new); build lists `fonts/*.woff2` in the precache manifest.

- [ ] **Step 9: Commit**

```bash
git add public/fonts public/icons src/styles vite.config.ts tests/app/theme.test.ts design/figma-assets/redesign
git commit -m "feat(theme): Figma palette, self-hosted Overpass/Poppins, nav and kind icons

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Icon component and the five-tab bar

**Files:**
- Create: `src/components/Icon.tsx`
- Modify: `src/components/TabBar.tsx`, `src/styles/base.css` (append), `src/App.tsx` (add placeholder `/tickets` route)
- Test: `tests/app/TabBar.test.tsx`

**Interfaces:**
- Produces `Icon({ set: 'nav' | 'kind'; name: string; size?: number; className?: string })` rendering `<span class="icon" style="--icon-url: url(...)">` coloured by `currentColor` via CSS mask.
- Produces the tab list `TABS` exported from `TabBar.tsx`: `{ to, label, icon }[]`.

- [ ] **Step 1: Write the failing test**

`tests/app/TabBar.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { test, expect } from 'vitest'
import { TabBar, TABS } from '../../src/components/TabBar'

function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><TabBar /></MemoryRouter>)
}

test('five tabs in order with icons', () => {
  mount('/')
  expect(TABS.map(t => t.label)).toEqual(['Home', 'Day', 'Map', 'Tickets', 'More'])
  const links = screen.getAllByRole('link')
  expect(links.map(l => l.textContent)).toEqual(['Home', 'Day', 'Map', 'Tickets', 'More'])
  expect(links.map(l => l.getAttribute('href'))).toEqual(['/', '/day', '/map', '/tickets', '/more'])
  for (const l of links) expect(l.querySelector('.icon')).not.toBeNull()
})

test('active tab is marked and only one is active', () => {
  mount('/tickets')
  const active = screen.getAllByRole('link').filter(l => l.classList.contains('tabbar__tab--active'))
  expect(active).toHaveLength(1)
  expect(active[0]).toHaveTextContent('Tickets')
})

test('hidden on the map route', () => {
  const { container } = mount('/map/2026-10-05')
  expect(container.querySelector('nav')).toBeNull()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/app/TabBar.test.tsx`
Expected: FAIL — `TABS` not exported, four labels differ.

- [ ] **Step 3: Icon component**

`src/components/Icon.tsx`:
```tsx
/**
 * Any SVG under public/icons rendered as a CSS mask, so it takes `currentColor` and needs no
 * per-colour file. `size` is the box in px; the SVG is contained and centred inside it.
 */
export function Icon({ set, name, size = 24, className }: {
  set: 'nav' | 'kind'
  name: string
  size?: number
  className?: string
}) {
  const url = `url(${import.meta.env.BASE_URL}icons/${set}/${name}.svg)`
  return (
    <span
      className={`icon${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      style={{ width: size, height: size, WebkitMaskImage: url, maskImage: url }}
    />
  )
}
```

- [ ] **Step 4: TabBar**

Replace `src/components/TabBar.tsx`:
```tsx
import { NavLink, useLocation } from 'react-router-dom'
import { Icon } from './Icon'

export const TABS = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/day', label: 'Day', icon: 'calendar' },
  { to: '/map', label: 'Map', icon: 'map' },
  { to: '/tickets', label: 'Tickets', icon: 'suitcase' },
  { to: '/more', label: 'More', icon: 'profile' },
] as const

export function TabBar() {
  const location = useLocation()
  if (location.pathname.startsWith('/map')) return null
  return (
    <nav className="tabbar">
      {TABS.map(t => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className={({ isActive }) => `tabbar__tab${isActive ? ' tabbar__tab--active' : ''}`}
        >
          <Icon set="nav" name={t.icon} size={24} />
          <span className="tabbar__label">{t.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
```

- [ ] **Step 5: Styles (append to base.css)**

```css
/* Icons */
.icon { display: inline-block; flex-shrink: 0; background-color: currentColor;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-position: center; mask-position: center;
  -webkit-mask-size: contain; mask-size: contain; }

/* Tab bar — Figma 1:85 */
.tabbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; height: calc(64px + var(--safe-bottom));
  padding: 0 8px var(--safe-bottom); background: var(--bg-nav); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px);
  border-top: 1px solid var(--border); display: flex; justify-content: space-around; align-items: center; }
.tabbar__tab { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 56px;
  color: rgba(255,255,255,.4); text-decoration: none; font-size: 11px; font-weight: 700; padding: 6px 0; }
.tabbar__tab--active { color: var(--highlight); }
.tabbar__tab--active::after { content: ''; position: absolute; bottom: -1px; width: 20px; height: 3px; border-radius: 2px; background: var(--highlight); }
.tabbar__label { line-height: 1; }
```

- [ ] **Step 6: Placeholder Tickets route**

In `src/App.tsx` add, next to the `/bookings` route: `<Route path="/tickets" element={<Bookings />} />` (temporary; Task 6 replaces it). The import already exists.

- [ ] **Step 7: Run tests and build**

Run: `npx vitest run && npm run build` — expected all green. `tests/app/ScrollReset.test.tsx` still passes because the tab labels are unchanged for Home/Day/More/Bookings? No — it clicks a link named "Bookings". Update that test's two `getByRole('link', { name: 'Bookings' })` to `{ name: 'Tickets' }` and its `/bookings` route to `/tickets`.

- [ ] **Step 8: Commit**

```bash
git add src/components/Icon.tsx src/components/TabBar.tsx src/styles/base.css src/App.tsx tests/app/TabBar.test.tsx tests/app/ScrollReset.test.tsx
git commit -m "feat(nav): five-tab bar with Figma icons, Tickets tab

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Ticket logic module

**Files:**
- Create: `src/lib/tickets.ts`, `src/lib/config.ts`
- Test: `tests/lib/tickets.test.ts`

**Interfaces (produced, used by Tasks 4–8):**
```ts
export type TicketKind = 'transport' | 'accommodation' | 'event'
export type Status = 'not_booked' | 'booked' | 'confirmed' | 'cancelled' | 'undecided' | null
export function inferKind(b: Pick<BookingRow, 'title' | 'fields'>): TicketKind
export function isTicket(b: BookingRow): boolean                                  // kind !== 'walkin'
export function ticketsForDay(bookings: BookingRow[], date: string): BookingRow[] // tickets on date, time asc (null last), then sort
export function nextTicket(content: CityContent, date: string, minutes: number): { booking: BookingRow; date: string } | null
export function groupByDate(bookings: BookingRow[]): { date: string | null; bookings: BookingRow[] }[] // dated asc, undated last
export function countriesOf(trips: TripRow[]): { country: string; code: string; trips: TripRow[] }[]
export function ticketLines(b: BookingRow, kind: TicketKind): { label: string; value: string; sub: string | null }
export function fourCells(b: BookingRow): { key: string; value: string }[]      // ≤ 4
export function effectiveStatus(b: BookingRow, row: { status: string | null } | undefined): Status
export function cycleStatus(s: Status): Exclude<Status, null>
export function bookingForStop(bookings: BookingRow[], item: ItemRow): BookingRow | null
export function stopsForCards(content: CityContent, date: string): ItemRow[]     // timed named stops not matching a booking
export function kindIcon(kind: TicketKind, title: string): 'plane' | 'car' | 'hotel' | 'event'
export const OWNER_NAME: string | null   // from src/lib/config.ts
```

- [ ] **Step 1: Write the failing tests**

`tests/lib/tickets.test.ts`:
```ts
import { describe, test, expect, beforeEach } from 'vitest'
import { loadValle } from '../helpers/content'
import type { BookingRow, CityContent } from '../../src/lib/types'
import {
  inferKind, isTicket, ticketsForDay, nextTicket, groupByDate, countriesOf, ticketLines, fourCells,
  effectiveStatus, cycleStatus, bookingForStop, stopsForCards, kindIcon,
} from '../../src/lib/tickets'

let content: CityContent
beforeEach(async () => { content = await loadValle() })

const b = (over: Partial<BookingRow>): BookingRow => ({
  id: 'X1', trip: 'valle', kind: 'todo', title: 'Thing', date: '2026-11-02', time: '10:00', priority: null,
  book_by: null, decide_by: null, contact: null, address: null, notes: null, fallback: null, relates_to: null,
  options: null, status_from_file: null, fields: {}, sort: 0, ...over,
})

describe('inferKind', () => {
  test('title keywords', () => {
    expect(inferKind(b({ title: 'Train south' }))).toBe('transport')
    expect(inferKind(b({ title: 'AVE Seville → Barcelona' }))).toBe('transport')
    expect(inferKind(b({ title: 'Airport taxi, Sunday departure' }))).toBe('transport')
    expect(inferKind(b({ title: 'Stay at Hotel Arch' }))).toBe('accommodation')
    expect(inferKind(b({ title: 'Trattoria Alba — dinner' }))).toBe('event')
  })
  test('fields.kind wins over the title', () => {
    expect(inferKind(b({ title: 'Train south', fields: { kind: 'event' } }))).toBe('event')
    expect(inferKind(b({ title: 'Dinner', fields: { kind: 'nonsense' } }))).toBe('event')
  })
  test('notes are not consulted', () => {
    expect(inferKind(b({ title: 'Dinner', notes: 'take a taxi' }))).toBe('event')
  })
})

test('isTicket excludes walk-ins', () => {
  expect(isTicket(b({ kind: 'walkin' }))).toBe(false)
  expect(isTicket(b({ kind: 'booked' }))).toBe(true)
  expect(isTicket(b({ kind: 'todo' }))).toBe(true)
})

test('ticketsForDay sorts by time, undated-time last, walk-ins out', () => {
  const list = [b({ id: 'a', time: '20:00' }), b({ id: 'w', kind: 'walkin' }), b({ id: 'n', time: null, sort: 9 }), b({ id: 'c', time: '09:10' })]
  expect(ticketsForDay(list, '2026-11-02').map(x => x.id)).toEqual(['c', 'a', 'n'])
})

describe('nextTicket', () => {
  test('first booking later than now on the day', () => {
    // Valle fixture: B01 Trattoria Alba 2026-11-01 20:00; B02 Train south 2026-11-03 09:10; T01 same dinner; T02 decide.
    const r = nextTicket(content, '2026-11-01', 12 * 60)
    expect(r?.booking.id).toBe('B01'); expect(r?.date).toBe('2026-11-01')
  })
  test('falls back to the first of the day when all have passed', () => {
    const r = nextTicket(content, '2026-11-01', 23 * 60)
    expect(r?.booking.id).toBe('B01')
  })
  test('rolls to the next dated booking when the day has none', () => {
    const r = nextTicket(content, '2026-11-02', 9 * 60)
    expect(r?.booking.id).toBe('B02'); expect(r?.date).toBe('2026-11-03')
  })
  test('null when nothing dated remains', () => {
    expect(nextTicket({ ...content, bookings: [] }, '2026-11-02', 0)).toBeNull()
  })
})

test('groupByDate: dated ascending, undated last, walk-ins excluded', () => {
  const g = groupByDate([b({ id: 'u', date: null }), b({ id: 'w', kind: 'walkin' }), b({ id: 'late', date: '2026-11-03' }), b({ id: 'early', date: '2026-11-01' })])
  expect(g.map(x => x.date)).toEqual(['2026-11-01', '2026-11-03', null])
  expect(g[2].bookings.map(x => x.id)).toEqual(['u'])
})

test('countriesOf groups trips in sort order', () => {
  const t = (slug: string, country: string, code: string, sort: number) => ({ ...content.trip, slug, name: slug, country, country_code: code, sort })
  const c = countriesOf([t('istanbul', 'Turkey', 'tr', 0), t('lisbon', 'Portugal', 'pt', 1), t('seville', 'Spain', 'es', 2), t('barcelona', 'Spain', 'es', 3)])
  expect(c.map(x => x.country)).toEqual(['Turkey', 'Portugal', 'Spain'])
  expect(c[2].trips.map(x => x.slug)).toEqual(['seville', 'barcelona'])
})

describe('ticketLines', () => {
  test('transport: time and reference/cost', () => {
    const l = ticketLines(b({ title: 'Train south', time: '09:10', fields: { cost: '€45' }, contact: '+34 600' }), 'transport')
    expect(l).toEqual({ label: 'Departs', value: '09:10', sub: '€45 · +34 600' })
  })
  test('accommodation: check-in date', () => {
    const l = ticketLines(b({ title: 'Hotel', date: '2026-11-01', time: null, fields: { ref: 'ABC' } }), 'accommodation')
    expect(l.label).toBe('Check-in'); expect(l.value).toBe('Sunday 1 November'); expect(l.sub).toBe('ABC')
  })
  test('event: time, cost or address; no sub when nothing', () => {
    expect(ticketLines(b({ time: '20:00', address: 'Via Alba 3' }), 'event')).toEqual({ label: 'At', value: '20:00', sub: 'Via Alba 3' })
    expect(ticketLines(b({ time: null }), 'event')).toEqual({ label: 'At', value: '—', sub: null })
  })
})

test('fourCells: cost, contact, book by, then other fields, max four, empties dropped', () => {
  const cells = fourCells(b({ book_by: '2026-10-01', contact: '+351 1', fields: { cost: '€32', tier: '1', book_at: 'their site', for_note: 'x', book_by_note: 'y', kind: 'event', extra: 'z' } }))
  expect(cells).toEqual([
    { key: 'Cost', value: '€32' }, { key: 'Contact', value: '+351 1' }, { key: 'Book by', value: '1 Oct' }, { key: 'Book at', value: 'their site' },
  ])
  expect(fourCells(b({}))).toEqual([])
})

test('effectiveStatus and cycleStatus', () => {
  expect(effectiveStatus(b({ kind: 'booked' }), undefined)).toBe('booked')
  expect(effectiveStatus(b({ kind: 'todo' }), undefined)).toBeNull()
  expect(effectiveStatus(b({ kind: 'todo', status_from_file: 'not booked' }), undefined)).toBe('not_booked')
  expect(effectiveStatus(b({ kind: 'todo' }), { status: 'confirmed' })).toBe('confirmed')
  expect(cycleStatus(null)).toBe('booked'); expect(cycleStatus('not_booked')).toBe('booked')
  expect(cycleStatus('booked')).toBe('confirmed'); expect(cycleStatus('confirmed')).toBe('not_booked'); expect(cycleStatus('cancelled')).toBe('not_booked')
})

test('bookingForStop matches by name, case-insensitive, either direction of containment', () => {
  const dinner = content.bookings.find(x => x.id === 'B01')!
  const stop = content.items.find(i => i.kind === 'stop' && /Trattoria Alba/i.test(i.plan))!
  expect(bookingForStop(content.bookings, stop)?.id).toBe('B01')
  expect(bookingForStop(content.bookings, { ...stop, plan: 'Unrelated', place_name: 'Nowhere' })).toBeNull()
  expect(dinner.title).toMatch(/Trattoria Alba/)
})

test('stopsForCards: timed, named, not a booking, sorted', () => {
  const stops = stopsForCards(content, '2026-11-01')
  expect(stops.every(s => s.kind === 'stop' && s.place_name && (s.time || s.time_text))).toBe(true)
  expect(stops.some(s => /Trattoria Alba/i.test(s.plan))).toBe(false)
})

test('kindIcon', () => {
  expect(kindIcon('transport', 'Flight to Seville')).toBe('plane')
  expect(kindIcon('transport', 'AVE Seville → Barcelona')).toBe('car')   // trains and taxis share the car glyph until Plan 6 photos
  expect(kindIcon('accommodation', 'Hotel')).toBe('hotel')
  expect(kindIcon('event', 'Dinner')).toBe('event')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/tickets.test.ts` — expected FAIL: module not found.

- [ ] **Step 3: Implement**

`src/lib/config.ts`:
```ts
/** First name for the Home greeting; a build variable because the app has no profile. */
export const OWNER_NAME: string | null = (import.meta.env.VITE_OWNER_NAME as string | undefined)?.trim() || null
```

`src/lib/tickets.ts`:
```ts
import type { BookingRow, CityContent, ItemRow, TripRow } from './types'
import { fmtDay, minutesOf } from './time'

export type TicketKind = 'transport' | 'accommodation' | 'event'
export type Status = 'not_booked' | 'booked' | 'confirmed' | 'cancelled' | 'undecided' | null

const KINDS = new Set<string>(['transport', 'accommodation', 'event'])
// Title only: notes mention taxis and hotels in passing ("10 min by taxi") and would misfire.
const TRANSPORT_RE = /\b(flight|fly|plane|train|ave|rail|taxi|bolt|uber|cab|airport|transfer|ferry|bus|metro|tram|drive|car hire)\b/i
const PLANE_RE = /\b(flight|fly|plane|airport)\b/i
const STAY_RE = /\b(hotel|hostel|stay|flat|apartment|airbnb|check-?in|check-?out|nights?|riad|guesthouse)\b/i

export function inferKind(b: Pick<BookingRow, 'title' | 'fields'>): TicketKind {
  const explicit = b.fields?.kind?.trim().toLowerCase()
  if (explicit && KINDS.has(explicit)) return explicit as TicketKind
  if (TRANSPORT_RE.test(b.title)) return 'transport'
  if (STAY_RE.test(b.title)) return 'accommodation'
  return 'event'
}

export function kindIcon(kind: TicketKind, title: string): 'plane' | 'car' | 'hotel' | 'event' {
  if (kind === 'accommodation') return 'hotel'
  if (kind === 'transport') return PLANE_RE.test(title) ? 'plane' : 'car'
  return 'event'
}

export function isTicket(b: BookingRow): boolean { return b.kind !== 'walkin' }

function byTimeThenSort(a: BookingRow, b: BookingRow): number {
  if (a.time && b.time) return minutesOf(a.time) - minutesOf(b.time) || a.sort - b.sort
  if (a.time) return -1
  if (b.time) return 1
  return a.sort - b.sort
}

export function ticketsForDay(bookings: BookingRow[], date: string): BookingRow[] {
  return bookings.filter(b => isTicket(b) && b.date === date).sort(byTimeThenSort)
}

export function nextTicket(content: CityContent, date: string, minutes: number): { booking: BookingRow; date: string } | null {
  const today = ticketsForDay(content.bookings, date)
  const later = today.find(b => b.time && minutesOf(b.time) >= minutes)
  if (later) return { booking: later, date }
  if (today[0]) return { booking: today[0], date }
  const futureDates = Array.from(new Set(content.bookings.filter(b => isTicket(b) && b.date && b.date > date).map(b => b.date!))).sort()
  for (const d of futureDates) {
    const list = ticketsForDay(content.bookings, d)
    if (list[0]) return { booking: list[0], date: d }
  }
  return null
}

export function groupByDate(bookings: BookingRow[]): { date: string | null; bookings: BookingRow[] }[] {
  const tickets = bookings.filter(isTicket)
  const dates = Array.from(new Set(tickets.filter(b => b.date).map(b => b.date!))).sort()
  const groups = dates.map(date => ({ date: date as string | null, bookings: ticketsForDay(tickets, date) }))
  const undated = tickets.filter(b => !b.date).sort((a, b) => a.sort - b.sort)
  if (undated.length) groups.push({ date: null, bookings: undated })
  return groups
}

export function countriesOf(trips: TripRow[]): { country: string; code: string; trips: TripRow[] }[] {
  const out: { country: string; code: string; trips: TripRow[] }[] = []
  for (const t of [...trips].sort((a, b) => a.sort - b.sort || a.start_date.localeCompare(b.start_date))) {
    const g = out.find(x => x.country === t.country)
    if (g) g.trips.push(t); else out.push({ country: t.country, code: t.country_code, trips: [t] })
  }
  return out
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function shortDate(iso: string): string { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS_SHORT[m - 1]}` }
function joinParts(parts: Array<string | null | undefined>): string | null { const p = parts.filter((x): x is string => !!x && x.trim() !== ''); return p.length ? p.join(' · ') : null }

export function ticketLines(b: BookingRow, kind: TicketKind): { label: string; value: string; sub: string | null } {
  const time = b.time ?? '—'
  if (kind === 'transport') return { label: 'Departs', value: time, sub: joinParts([b.fields.cost, b.contact]) }
  if (kind === 'accommodation') return { label: 'Check-in', value: b.date ? fmtDay(b.date) : '—', sub: joinParts([b.fields.ref, b.contact]) }
  return { label: 'At', value: time, sub: joinParts([b.fields.cost ?? b.address]) }
}

const HIDDEN_FIELDS = new Set(['for_note', 'book_by_note', 'decide_by_note', 'tier', 'kind', 'cost'])
function humanize(key: string): string { const w = key.replace(/_/g, ' '); return w.charAt(0).toUpperCase() + w.slice(1) }

export function fourCells(b: BookingRow): { key: string; value: string }[] {
  const cells: { key: string; value: string }[] = []
  if (b.fields.cost) cells.push({ key: 'Cost', value: b.fields.cost })
  if (b.contact) cells.push({ key: 'Contact', value: b.contact })
  if (b.book_by) cells.push({ key: 'Book by', value: shortDate(b.book_by) })
  else if (b.decide_by) cells.push({ key: 'Decide by', value: shortDate(b.decide_by) })
  for (const [k, v] of Object.entries(b.fields)) {
    if (cells.length >= 4) break
    if (HIDDEN_FIELDS.has(k) || !v) continue
    cells.push({ key: humanize(k), value: v })
  }
  return cells.slice(0, 4)
}

export function effectiveStatus(b: BookingRow, row: { status: string | null } | undefined): Status {
  const raw = row?.status ?? b.status_from_file ?? (b.kind === 'booked' ? 'booked' : null)
  if (!raw) return null
  const s = raw.toLowerCase().trim().replace(/\s+/g, '_')
  if (s === 'booked' || s === 'confirmed' || s === 'cancelled' || s === 'undecided' || s === 'not_booked') return s
  if (s.startsWith('booked')) return 'booked'
  return 'not_booked'
}

export function cycleStatus(s: Status): Exclude<Status, null> {
  if (s === 'booked') return 'confirmed'
  if (s === 'confirmed') return 'not_booked'
  return 'booked'
}

function norm(s: string): string { return s.replace(/\*\*/g, '').toLowerCase().replace(/[^a-z0-9à-ÿ ]+/g, ' ').replace(/\s+/g, ' ').trim() }

export function bookingForStop(bookings: BookingRow[], item: ItemRow): BookingRow | null {
  const names = [item.place_name, item.plan].filter((x): x is string => !!x).map(norm).filter(n => n.length >= 4)
  for (const b of bookings) {
    if (!isTicket(b)) continue
    const t = norm(b.title.split(/ — | - /)[0])
    if (t.length < 4) continue
    if (names.some(n => n.includes(t) || t.includes(n))) return b
  }
  return null
}

export function stopsForCards(content: CityContent, date: string): ItemRow[] {
  return content.items
    .filter(i => i.kind === 'stop' && i.date === date && i.place_name && (i.time || i.time_text))
    .filter(i => !bookingForStop(content.bookings, i))
    .sort((a, b) => a.sort - b.sort)
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/lib/tickets.test.ts` — expected PASS. If `bookingForStop` fails on the fixture, read `tests/fixtures/valle/Valle-Itinerary-Full.md` for the exact dinner stop wording and adjust the regex in the test, not the matcher.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tickets.ts src/lib/config.ts tests/lib/tickets.test.ts
git commit -m "feat(tickets): kind inference, next-up, grouping, card lines, status helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: TicketCard, PlaceCard, NextUpCard, StatusPill

**Files:**
- Create: `src/components/TicketCard.tsx`, `src/components/PlaceCard.tsx`, `src/components/NextUpCard.tsx`, `src/components/StatusPill.tsx`
- Modify: `src/styles/base.css` (append)
- Test: `tests/app/TicketCard.test.tsx`

**Interfaces:**
```ts
TicketCard({ booking, kind, status, tone?, to, onCycleStatus?, photoSrc? }): tone defaults by kind; `to` is the detail route
PlaceCard({ item, to, photoSrc? })
NextUpCard({ booking, kind, date, to })
StatusPill({ status, onClick? })   // label: Booked / Confirmed / Not booked / Cancelled / Undecided / —
```

- [ ] **Step 1: Failing test**

`tests/app/TicketCard.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { test, expect, vi } from 'vitest'
import { TicketCard } from '../../src/components/TicketCard'
import { StatusPill } from '../../src/components/StatusPill'
import type { BookingRow } from '../../src/lib/types'

const booking: BookingRow = {
  id: 'T04', trip: 'seville', kind: 'todo', title: 'AVE Seville → Barcelona', date: '2026-10-07', time: '08:45', priority: 'critical',
  book_by: '2026-09-17', decide_by: null, contact: null, address: null, notes: null, fallback: null, relates_to: null, options: null,
  status_from_file: 'not booked', fields: { cost: '€120 for two' }, sort: 3,
}

test('transport card: teal tone, Poppins title, lines, icon, link', () => {
  render(<MemoryRouter><TicketCard booking={booking} kind="transport" status="not_booked" to="/ticket/seville/T04" /></MemoryRouter>)
  const link = screen.getByRole('link', { name: /AVE Seville/ })
  expect(link).toHaveAttribute('href', '/ticket/seville/T04')
  expect(link.className).toContain('ticket-card--transport')
  expect(screen.getByText('Departs')).toBeInTheDocument()
  expect(screen.getByText('08:45')).toBeInTheDocument()
  expect(screen.getByText('€120 for two')).toBeInTheDocument()
  expect(link.querySelector('.icon')).not.toBeNull()
  expect(screen.getByText('Not booked')).toBeInTheDocument()
})

test('tone override and status tap', () => {
  const cycle = vi.fn()
  render(<MemoryRouter><TicketCard booking={booking} kind="event" status="booked" tone="highlight" to="/x" onCycleStatus={cycle} /></MemoryRouter>)
  expect(screen.getByRole('link').className).toContain('ticket-card--highlight')
  fireEvent.click(screen.getByRole('button', { name: /Booked/ }))
  expect(cycle).toHaveBeenCalledTimes(1)
})

test('StatusPill labels', () => {
  const { rerender } = render(<StatusPill status={null} />)
  expect(screen.getByText('—')).toBeInTheDocument()
  rerender(<StatusPill status="confirmed" />)
  expect(screen.getByText('Confirmed')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/app/TicketCard.test.tsx`, expected module-not-found.

- [ ] **Step 3: Components**

`src/components/StatusPill.tsx`:
```tsx
import type { Status } from '../lib/tickets'

const LABEL: Record<Exclude<Status, null>, string> = {
  not_booked: 'Not booked', booked: 'Booked', confirmed: 'Confirmed', cancelled: 'Cancelled', undecided: 'Undecided',
}

export function StatusPill({ status, onClick }: { status: Status; onClick?: () => void }) {
  const label = status ? LABEL[status] : '—'
  const cls = `status-pill status-pill--${status ?? 'none'}`
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={e => { e.preventDefault(); e.stopPropagation(); onClick() }} aria-label={`Status: ${label}. Tap to change`}>
        {label}
      </button>
    )
  }
  return <span className={cls}>{label}</span>
}
```

`src/components/TicketCard.tsx`:
```tsx
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'
import { kindIcon, ticketLines } from '../lib/tickets'
import type { Status, TicketKind } from '../lib/tickets'
import type { BookingRow } from '../lib/types'

export type CardTone = 'transport' | 'accommodation' | 'event' | 'highlight' | 'past'

/** The Figma 1:208 card: Poppins title, one label+value line, one light sub line, faded kind icon right. */
export function TicketCard({ booking, kind, status, tone, to, onCycleStatus, photoSrc }: {
  booking: BookingRow
  kind: TicketKind
  status: Status
  tone?: CardTone
  to: string
  onCycleStatus?: () => void
  photoSrc?: string | null
}) {
  const t = tone ?? kind
  const lines = ticketLines(booking, kind)
  return (
    <Link to={to} className={`ticket-card ticket-card--${t}`} aria-label={booking.title}>
      <span className="ticket-card__body">
        <span className="ticket-card__title">{booking.title}</span>
        <span className="ticket-card__line"><span className="ticket-card__label">{lines.label}</span> <span className="ticket-card__value">{lines.value}</span></span>
        {lines.sub && <span className="ticket-card__sub">{lines.sub}</span>}
        <span className="ticket-card__status"><StatusPill status={status} onClick={onCycleStatus} /></span>
      </span>
      <span className="ticket-card__art">
        {photoSrc ? <img className="ticket-card__photo" src={photoSrc} alt="" /> : <Icon set="kind" name={kindIcon(kind, booking.title)} size={72} className="ticket-card__icon" />}
      </span>
    </Link>
  )
}
```

`src/components/PlaceCard.tsx`:
```tsx
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { Md } from './Md'
import { fmtTime } from '../lib/time'
import type { ItemRow } from '../lib/types'

function firstLine(s: string | null): string | null { if (!s) return null; const i = s.indexOf('\n'); return i === -1 ? s : s.slice(0, i) }

/** The Figma 1103:161 wide card: image or glyph left, name in Poppins, first details line, time. */
export function PlaceCard({ item, to, photoSrc }: { item: ItemRow; to: string; photoSrc?: string | null }) {
  const name = item.place_name ?? item.plan.replace(/\*\*/g, '')
  return (
    <Link to={to} className="place-card" aria-label={name}>
      <span className="place-card__media">
        {photoSrc ? <img className="place-card__photo" src={photoSrc} alt="" /> : <Icon set="kind" name="event" size={56} className="place-card__icon" />}
      </span>
      <span className="place-card__body">
        <span className="place-card__title">{name}</span>
        {item.details && <span className="place-card__text"><Md text={firstLine(item.details)} /></span>}
        <span className="place-card__meta">{fmtTime(item.time, item.time_text)}</span>
      </span>
    </Link>
  )
}
```

`src/components/NextUpCard.tsx`:
```tsx
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { kindIcon } from '../lib/tickets'
import type { TicketKind } from '../lib/tickets'
import { fmtDay } from '../lib/time'
import type { BookingRow } from '../lib/types'

const KIND_LABEL: Record<TicketKind, string> = { transport: 'Transport', accommodation: 'Stay', event: 'Next up' }

function phoneHref(contact: string | null): string | null {
  if (!contact || !/^[+\d]/.test(contact.trim())) return null
  return `tel:${contact.replace(/(?!^\+)[^\d]/g, '')}`
}

/** The Figma 1:129 "Airport Cab" card: kind label, big green reference or title, address line, icon and call button. */
export function NextUpCard({ booking, kind, date, to }: { booking: BookingRow; kind: TicketKind; date: string; to: string }) {
  const ref = booking.fields.ref ?? booking.fields.confirmation ?? null
  const tel = phoneHref(booking.contact)
  return (
    <section className="nextup" aria-label="Next up">
      <Link to={to} className="nextup__link">
        <span className="nextup__kind">{KIND_LABEL[kind]} · {fmtDay(date)}{booking.time ? ` · ${booking.time}` : ''}</span>
        <span className="nextup__ref">{ref ?? booking.title}</span>
        {ref && <span className="nextup__title">{booking.title}</span>}
        {(booking.address || booking.contact) && (
          <span className="nextup__address"><Icon set="nav" name="map" size={14} /> {booking.address ?? booking.contact}</span>
        )}
        <span className="nextup__foot">
          <Icon set="kind" name={kindIcon(kind, booking.title)} size={40} className="nextup__icon" />
        </span>
      </Link>
      {tel && <a className="nextup__call" href={tel} aria-label={`Call ${booking.title}`}>Call</a>}
    </section>
  )
}
```

- [ ] **Step 4: Styles (append to base.css)**

```css
/* Status pill */
.status-pill { display: inline-block; padding: 4px 10px; border-radius: var(--radius-pill); font-size: 11px; font-weight: 700; letter-spacing: .03em; white-space: nowrap; border: 0; font: inherit; font-size: 11px; cursor: default; }
button.status-pill { cursor: pointer; }
.status-pill--booked, .status-pill--confirmed { background: var(--accent); color: var(--text-on-lavender); }
.status-pill--not_booked { background: rgba(0,0,0,.35); color: #fff; }
.status-pill--undecided { background: var(--highlight); color: var(--text-on-light); }
.status-pill--cancelled, .status-pill--none { background: rgba(0,0,0,.25); color: rgba(255,255,255,.7); }
.ticket-card--accommodation .status-pill--not_booked, .ticket-card--event .status-pill--not_booked, .ticket-card--highlight .status-pill--not_booked { background: rgba(0,0,0,.12); color: inherit; }

/* Ticket card — Figma 1:208 */
.ticket-card { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 12px;
  border-radius: var(--radius-card); padding: 20px; min-height: 140px; text-decoration: none; color: var(--text); overflow: hidden; }
.ticket-card--transport { background: var(--surface); }
.ticket-card--accommodation, .ticket-card--highlight { background: var(--highlight); color: var(--text-on-light); }
.ticket-card--event { background: var(--lavender); color: var(--text-on-lavender); box-shadow: 0 10px 20px rgba(188,165,237,.16); }
.ticket-card--past { background: var(--card-dark); color: var(--text-dim); }
.ticket-card__body { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1; }
.ticket-card__title { font-family: var(--font-ticket); font-weight: 700; font-size: 22px; line-height: 1.2; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ticket-card__line { letter-spacing: .75px; line-height: 1.25; }
.ticket-card__label { font-weight: 300; font-size: 14px; }
.ticket-card__value { font-weight: 700; font-size: 20px; }
.ticket-card__sub { font-weight: 300; font-size: 14px; letter-spacing: .75px; opacity: .9; overflow-wrap: anywhere; }
.ticket-card__status { margin-top: 4px; }
.ticket-card__art { flex-shrink: 0; width: 72px; height: 72px; display: flex; align-items: center; justify-content: center; }
.ticket-card__icon { opacity: .5; }
.ticket-card__photo { width: 72px; height: 72px; border-radius: 16px; object-fit: cover; }

/* Place card — Figma 1103:161 */
.place-card { display: flex; gap: 14px; border-radius: var(--radius-card); background: var(--lavender); color: var(--text-on-lavender);
  text-decoration: none; overflow: hidden; min-height: 120px; }
.place-card__media { width: 40%; min-width: 110px; background: rgba(0,0,0,.08); display: flex; align-items: center; justify-content: center; }
.place-card__photo { width: 100%; height: 100%; object-fit: cover; display: block; }
.place-card__icon { opacity: .5; }
.place-card__body { display: flex; flex-direction: column; gap: 6px; padding: 14px 14px 14px 0; min-width: 0; flex: 1; }
.place-card__title { font-family: var(--font-ticket); font-weight: 700; font-size: 20px; line-height: 1.15; text-transform: uppercase; letter-spacing: .02em;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.place-card__text { font-size: 13px; line-height: 1.3; opacity: .85; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.place-card__meta { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; margin-top: auto; }

/* Next-up card — Figma 1:129 */
.nextup { position: relative; background: var(--surface); border-radius: var(--radius-card); padding: 20px; margin: 0 0 20px; color: var(--text); }
.nextup__link { display: flex; flex-direction: column; gap: 6px; text-decoration: none; color: inherit; }
.nextup__kind { font-size: 15px; font-weight: 600; color: var(--text-soft); }
.nextup__ref { font-family: var(--font-ticket); font-weight: 700; font-size: 30px; line-height: 1.1; color: var(--accent); overflow-wrap: anywhere; }
.nextup__title { font-size: 15px; color: var(--text-soft); }
.nextup__address { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-soft); }
.nextup__foot { display: flex; align-items: center; margin-top: 10px; }
.nextup__icon { color: var(--accent); opacity: .9; }
.nextup__call { position: absolute; right: 20px; bottom: 20px; min-width: 44px; min-height: 44px; display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-pill); background: rgba(34,221,133,.15); color: var(--accent); font-weight: 700; font-size: 13px; text-decoration: none; padding: 0 14px; }

/* Horizontal card rows on Home */
.card-row { display: flex; gap: 12px; list-style: none; margin: 0 -16px; padding: 0 16px 4px; overflow-x: auto; -webkit-overflow-scrolling: touch; scroll-snap-type: x mandatory; }
.card-row > li { flex: 0 0 82%; max-width: 340px; scroll-snap-align: start; }
.card-row--tickets > li { flex: 0 0 88%; }
```

- [ ] **Step 5: Run tests** — `npx vitest run tests/app/TicketCard.test.tsx` expected PASS; then `npx vitest run` all green.

- [ ] **Step 6: Commit**

```bash
git add src/components/TicketCard.tsx src/components/PlaceCard.tsx src/components/NextUpCard.tsx src/components/StatusPill.tsx src/styles/base.css tests/app/TicketCard.test.tsx
git commit -m "feat(cards): TicketCard, PlaceCard, NextUpCard, StatusPill from the Figma cards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Home rebuilt

**Files:**
- Modify: `src/screens/Home.tsx` (rewrite), `src/components/WorldHero.tsx` (drop weather overlay), `src/components/WeatherStrip.tsx` (add `variant="hero"`), `src/components/ReminderChips.tsx` (link to `/tickets`), `src/styles/base.css`, `.env.example`, `.github/workflows/deploy.yml`
- Test: `tests/app/Home.test.tsx` (rewrite)

**Interfaces:**
- Consumes `nextTicket`, `ticketsForDay`, `stopsForCards`, `inferKind`, `effectiveStatus`, `cycleStatus` from `src/lib/tickets.ts`; `OWNER_NAME` from `src/lib/config.ts`; `openReminders`, `cityDot` from `src/lib/home.ts`.
- Routes linked: `/ticket/:trip/:id`, `/place/:id`, `/tickets`, `/map`.

- [ ] **Step 1: Read the current Home test to keep what still applies**

Run: `sed -n 60,400p tests/app/Home.test.tsx` and note the tests for: loading/error/no-trips states, the pre-trip "Plans for" caption, reminders labels, world hero dots. Those survive; Options/Tours/Itineraries/Walking-routes tests are deleted with their sections.

- [ ] **Step 2: Write the new Home test (replace the file)**

`tests/app/Home.test.tsx`:
```tsx
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'

const { useBookingStateMock, saveMock, warmMock } = vi.hoisted(() => ({
  useBookingStateMock: vi.fn(),
  saveMock: vi.fn(async () => ({ queued: false })),
  warmMock: vi.fn(async () => ({ cached: 0, total: 0 })),
}))
vi.mock('../../src/lib/attachmentsWarm', () => ({ warmTripAttachments: warmMock }))
vi.mock('../../src/lib/state', () => ({ useBookingState: useBookingStateMock, QUEUED_COPY: 'Saved on this phone — will sync when online' }))
vi.mock('../../src/lib/sync', () => ({ useSync: () => ({ pending: 0, failed: 0, syncing: false, lastError: undefined, retryFailed: vi.fn() }) }))
// Weather is exercised in WeatherStrip.test.tsx; here it must simply not fetch.
vi.mock('../../src/lib/weather', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/weather')>()
  return { ...actual, getDailyForecast: vi.fn(async () => { throw new Error('offline') }), getHourly: vi.fn(async () => { throw new Error('offline') }) }
})
vi.mock('../../src/lib/config', () => ({ OWNER_NAME: 'Michael' }))

import { Home } from '../../src/screens/Home'

const throwingClient = new Proxy({}, { get() { throw new Error('no network in tests') } }) as never
const SUNDAY_1200 = new Date('2026-11-01T11:00:00Z')   // 12:00 Europe/Rome, day one of the Valle fixture
const PRE_TRIP = new Date('2026-10-20T08:00:00Z')

function renderHome(content: CityContent) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TripProvider initial={{ trips: [content.trip], slug: 'valle', content }} client={throwingClient}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/ticket/:trip/:id" element={<p>Ticket screen</p>} />
          <Route path="/place/:id" element={<p>Place screen</p>} />
          <Route path="/tickets" element={<p>Tickets screen</p>} />
          <Route path="/map" element={<p>Map screen</p>} />
        </Routes>
      </TripProvider>
    </MemoryRouter>,
  )
}

let content: CityContent
beforeEach(async () => {
  content = await loadValle()
  useBookingStateMock.mockReturnValue({ state: {}, loading: false, save: saveMock })
  saveMock.mockClear()
  vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(SUNDAY_1200)
})
afterEach(() => { vi.useRealTimers() })

test('greeting with the owner name, date and trip-local time', () => {
  renderHome(content)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello... Michael')
  expect(screen.getByText(/Sunday 1 November · 12:00/)).toBeInTheDocument()
})

test('no country pills on Home', () => {
  renderHome(content)
  expect(screen.queryByRole('button', { name: content.trip.country })).toBeNull()
})

test('next-up card is the first booking still ahead today and opens its ticket', () => {
  renderHome(content)
  const next = screen.getByRole('region', { name: 'Next up' })
  expect(next).toHaveTextContent('Trattoria Alba')
  fireEvent.click(within(next).getByRole('link'))
  expect(screen.getByText('Ticket screen')).toBeInTheDocument()
})

test('tickets row lists the rest of today without the next-up booking', () => {
  renderHome(content)
  const row = screen.getByRole('heading', { name: 'Tickets' }).closest('section') as HTMLElement
  // Valle day one has one dated booking (B01 dinner) and the todo T01 for the same dinner.
  expect(within(row).queryByText(/Trattoria Alba — dinner/)).not.toBeNull()
  expect(within(row).getAllByRole('link').length).toBeGreaterThan(0)
})

test('tours and events row shows timed, named stops that are not bookings', () => {
  renderHome(content)
  const row = screen.getByRole('heading', { name: 'Tours and events' }).closest('section') as HTMLElement
  const links = within(row).getAllByRole('link')
  expect(links.length).toBeGreaterThan(0)
  expect(links.every(l => l.getAttribute('href')!.startsWith('/place/'))).toBe(true)
  expect(within(row).queryByText(/Trattoria Alba/)).toBeNull()
})

test('reminders link to the Tickets tab', () => {
  renderHome(content)
  const chips = screen.getByRole('heading', { name: 'Reminders' }).closest('section') as HTMLElement
  const first = within(chips).getAllByRole('link')[0]
  expect(first).toHaveAttribute('href', '/tickets')
})

test('world map hero stays and opens the map', () => {
  renderHome(content)
  expect(screen.getByTestId('world-hero-map')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: 'Open map' }))
  expect(screen.getByText('Map screen')).toBeInTheDocument()
})

test('before the trip, Home says which day it is showing and still has a next-up', () => {
  vi.setSystemTime(PRE_TRIP)
  renderHome(content)
  expect(screen.getByText(/Plans for Sunday 1 November/)).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Next up' })).toHaveTextContent('Trattoria Alba')
})

test('loading, error and empty states', () => {
  render(<MemoryRouter><TripProvider initial={{ trips: [], slug: '', content: null as unknown as CityContent }} client={throwingClient}><Home /></TripProvider></MemoryRouter>)
  expect(screen.getByText(/No trips yet/)).toBeInTheDocument()
})
```

- [ ] **Step 3: Run to verify it fails** — `npx vitest run tests/app/Home.test.tsx`: FAIL (old Home renders pills, no "Next up" region).

- [ ] **Step 4: WeatherStrip hero variant and WorldHero without weather**

In `src/components/WeatherStrip.tsx` change the signature to `export function WeatherStrip({ trip, content, date, variant = 'strip' }: { trip: TripRow; content: CityContent; date: string; variant?: 'strip' | 'hero' })` and change the root of the rendered summary to:
```tsx
    <div className={`weather weather--${variant}`}>
      <div className="weather__summary">
        <WeatherIcon iconUri={day.iconUri} condition={day.condition} failed={failedIcons} onFail={markIconFailed} />
        {variant === 'hero'
          ? <span className="weather__text"><span className="weather__temp">{Math.round(day.hi)}°</span> {day.condition} · low {Math.round(day.lo)}° · ☂ {day.precipPct}%</span>
          : <span className="weather__text">{day.condition} · {Math.round(day.hi)}° / {Math.round(day.lo)}° · ☂ {day.precipPct}%</span>}
      </div>
```
(the rest unchanged). In `src/components/WorldHero.tsx` delete the `current`/`iconFailed` state, the `getCurrent` effect and imports, and the `.world-hero__weather` block, leaving the overlay with only the "Open map" link.

- [ ] **Step 5: ReminderChips target**

In `src/components/ReminderChips.tsx` change `to="/bookings"` to `to="/tickets"`; class names unchanged.

- [ ] **Step 6: Rewrite Home.tsx**

```tsx
import { useEffect, useState } from 'react'
import { useTrip } from '../lib/trip'
import { useBookingState } from '../lib/state'
import { fmtDay, nowInTz, todayInTrip } from '../lib/time'
import { openReminders } from '../lib/home'
import { cycleStatus, effectiveStatus, inferKind, nextTicket, stopsForCards, ticketsForDay } from '../lib/tickets'
import { OWNER_NAME } from '../lib/config'
import { SyncBadge } from '../components/SyncBadge'
import { WorldHero } from '../components/WorldHero'
import { WeatherStrip } from '../components/WeatherStrip'
import { NextUpCard } from '../components/NextUpCard'
import { TicketCard } from '../components/TicketCard'
import { PlaceCard } from '../components/PlaceCard'
import { ReminderChips } from '../components/ReminderChips'
import { warmTripAttachments } from '../lib/attachmentsWarm'

const NOW_TICK_MS = 30_000

export function Home() {
  const { trips, content, loading, error, refresh } = useTrip()
  const { state, save } = useBookingState(content?.trip.slug ?? '')
  const [now, setNow] = useState(() => new Date())
  const warmSlug = content?.trip.slug ?? null

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), NOW_TICK_MS)
    return () => clearInterval(id)
  }, [])

  // Home is the screen the owner opens over breakfast, on hotel wifi — the best moment to
  // get the day's tickets onto the phone. Once per trip per session, shared with More.
  useEffect(() => {
    if (!warmSlug) return
    void warmTripAttachments(warmSlug).catch(() => {})
  }, [warmSlug])

  if (loading && !content) return <main className="screen"><p className="caption">Loading…</p></main>
  if (error && !content) {
    return (
      <main className="screen">
        <p className="caption">{error}</p>
        <button type="button" className="btn--text" onClick={() => { void refresh() }}>Retry</button>
      </main>
    )
  }
  if (trips.length === 0) return <main className="screen"><p className="caption">No trips yet. Run the import on your laptop.</p></main>
  if (!content) return null

  const trip = content.trip
  const { date: todayISO, minutes, hhmm } = nowInTz(trip.timezone, now)
  const today = todayInTrip(trip, now)
  const date = today ?? content.days[0]?.date ?? todayISO

  const next = nextTicket(content, date, today ? minutes : 0)
  const restToday = ticketsForDay(content.bookings, date).filter(b => b.id !== next?.booking.id)
  const stops = stopsForCards(content, date)
  const reminders = openReminders(content.bookings, state, todayISO).map(r => ({ id: r.booking.id, label: r.label, overdue: r.overdue }))

  const cycle = (id: string) => {
    const b = content.bookings.find(x => x.id === id)!
    void save(id, { status: cycleStatus(effectiveStatus(b, state[id])) }).catch(() => {})
  }

  return (
    <main className="screen home">
      <header className="home-header">
        <div className="home-header__text">
          <h1 className="home-header__title">Hello...{OWNER_NAME ? ` ${OWNER_NAME}` : ''}</h1>
          <p className="home-header__date">{fmtDay(todayISO)} · {hhmm}</p>
          {!today && <p className="caption home-header__caption">Plans for {fmtDay(date)}</p>}
        </div>
        <SyncBadge />
      </header>

      <WeatherStrip trip={trip} content={content} date={date} variant="hero" />

      <WorldHero trips={trips} trip={trip} content={content} date={date} />

      {next && (
        <NextUpCard booking={next.booking} kind={inferKind(next.booking)} date={next.date} to={`/ticket/${trip.slug}/${next.booking.id}`} />
      )}

      <section className="home-row">
        <h2 className="h5 home-row__heading">Tickets</h2>
        {restToday.length === 0 ? <p className="caption home-row__empty">No more tickets today</p> : (
          <ul className="card-row card-row--tickets">
            {restToday.map(b => (
              <li key={b.id}>
                <TicketCard booking={b} kind={inferKind(b)} status={effectiveStatus(b, state[b.id])} to={`/ticket/${trip.slug}/${b.id}`} onCycleStatus={() => cycle(b.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {stops.length > 0 && (
        <section className="home-row">
          <h2 className="h5 home-row__heading">Tours and events</h2>
          <ul className="card-row">
            {stops.map(s => <li key={s.id}><PlaceCard item={s} to={`/place/${encodeURIComponent(s.id)}`} /></li>)}
          </ul>
        </section>
      )}

      <ReminderChips reminders={reminders} />
    </main>
  )
}
```

- [ ] **Step 7: Home styles** — in `base.css` replace the `/* Home */` header rules with:
```css
/* Home */
.home { display: flex; flex-direction: column; gap: 0; }
.home-header { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 12px; }
.home-header__text { flex: 1; min-width: 0; }
.home-header__title { font-size: 40px; font-weight: 800; line-height: 1; letter-spacing: -.02em; margin: 0; overflow-wrap: anywhere; }
.home-header__date { margin: 8px 0 0; font-size: 15px; color: var(--text-dim); font-weight: 600; letter-spacing: .04em; }
.home-header__caption { margin: 4px 0 0; }
.weather--hero { background: var(--surface); border-radius: var(--radius-panel); padding: 14px 16px; margin: 0 0 16px; }
.weather--hero .weather__temp { font-size: 28px; font-weight: 800; margin-right: 6px; }
```
Delete the `.home-trips` rules and `.options-card*`, `.option-circle*`, `.tile*`, `.tile-row*` rules (their components go in Task 8; deleting CSS now is safe since Task 8 removes the components — if the build warns about nothing, fine). Keep `.home-row*` and `.reminder-chip*`; change `.reminder-chip` background to `var(--surface)` and `.reminder-chip--overdue` colour to `var(--highlight)`.

- [ ] **Step 8: Owner name variable**

Append `VITE_OWNER_NAME=` under the browser block in `.env.example`; add `VITE_OWNER_NAME: ${{ secrets.VITE_OWNER_NAME }}` next to the other `VITE_` lines in `.github/workflows/deploy.yml`; add `VITE_OWNER_NAME=Michael` to the local `.env` (not committed). Run `gh secret set VITE_OWNER_NAME -b "Michael"`.

- [ ] **Step 9: Run tests and build** — `npx vitest run && npm run build`. `WorldHero`/`WeatherStrip` tests: update any assertion on the hero weather overlay (search `world-hero__weather` in tests) to the strip instead.

- [ ] **Step 10: Commit**

```bash
git add src/screens/Home.tsx src/components/WorldHero.tsx src/components/WeatherStrip.tsx src/components/ReminderChips.tsx src/styles/base.css tests .env.example .github/workflows/deploy.yml
git commit -m "feat(home): greeting, weather row, next-up ticket, ticket and place card rows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Tickets screen and the /bookings redirect

**Files:**
- Create: `src/screens/Tickets.tsx`
- Modify: `src/App.tsx`, `src/styles/base.css`
- Test: `tests/app/Tickets.test.tsx`

**Interfaces:**
- Consumes `countriesOf`, `groupByDate`, `inferKind`, `effectiveStatus`, `cycleStatus` from `src/lib/tickets.ts`; `useTrip().setSlug`.

- [ ] **Step 1: Failing test**

`tests/app/Tickets.test.tsx`:
```tsx
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent, TripRow } from '../../src/lib/types'

const { useBookingStateMock, saveMock } = vi.hoisted(() => ({ useBookingStateMock: vi.fn(), saveMock: vi.fn(async () => ({ queued: false })) }))
vi.mock('../../src/lib/state', () => ({ useBookingState: useBookingStateMock, QUEUED_COPY: 'Saved on this phone — will sync when online' }))
vi.mock('../../src/lib/sync', () => ({ useSync: () => ({ pending: 0, failed: 0, syncing: false, lastError: undefined, retryFailed: vi.fn() }) }))

import { Tickets } from '../../src/screens/Tickets'
import App from '../../src/App'

const throwingClient = new Proxy({}, { get() { throw new Error('no network in tests') } }) as never

function mount(content: CityContent, trips: TripRow[] = [content.trip]) {
  return render(
    <MemoryRouter initialEntries={['/tickets']}>
      <TripProvider initial={{ trips, slug: 'valle', content }} client={throwingClient}>
        <Routes>
          <Route path="/tickets" element={<Tickets />} />
          <Route path="/ticket/:trip/:id" element={<p>Ticket screen</p>} />
        </Routes>
      </TripProvider>
    </MemoryRouter>,
  )
}

let content: CityContent
beforeEach(async () => {
  content = await loadValle()
  useBookingStateMock.mockReturnValue({ state: {}, loading: false, save: saveMock })
  saveMock.mockClear()
  vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-20T08:00:00Z'))
})
afterEach(() => vi.useRealTimers())

test('country tabs from trips; city chips only when a country has several trips', () => {
  const es1 = { ...content.trip, slug: 'seville', name: 'Seville', country: 'Spain', country_code: 'es', sort: 2 }
  const es2 = { ...content.trip, slug: 'barcelona', name: 'Barcelona', country: 'Spain', country_code: 'es', sort: 3 }
  mount(content, [content.trip, es1, es2])
  const tabs = screen.getByRole('tablist', { name: 'Country' })
  expect(within(tabs).getAllByRole('tab').map(t => t.textContent)).toEqual([content.trip.country, 'Spain'])
  expect(screen.queryByRole('tablist', { name: 'City' })).toBeNull()
  fireEvent.click(within(tabs).getByRole('tab', { name: 'Spain' }))
  const cities = screen.getByRole('tablist', { name: 'City' })
  expect(within(cities).getAllByRole('tab').map(t => t.textContent)).toEqual(['Seville', 'Barcelona'])
})

test('bookings grouped by day with headers, walk-ins absent, cards link to detail', () => {
  mount(content)
  expect(screen.getByRole('heading', { name: 'Sunday 1 November' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Tuesday 3 November' })).toBeInTheDocument()
  const walkin = content.bookings.find(b => b.kind === 'walkin')
  if (walkin) expect(screen.queryByText(walkin.title)).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: /Train south/ }))
  expect(screen.getByText('Ticket screen')).toBeInTheDocument()
})

test('tapping the status pill cycles through save()', () => {
  mount(content)
  const card = screen.getByRole('link', { name: /Train south/ })
  fireEvent.click(within(card).getByRole('button', { name: /Status/ }))
  expect(saveMock).toHaveBeenCalledWith('B02', { status: 'confirmed' })
})

test('earlier days collapse once the trip is underway', () => {
  vi.setSystemTime(new Date('2026-11-03T08:00:00Z'))
  mount(content)
  expect(screen.getByRole('button', { name: /earlier day/ })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Sunday 1 November' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /earlier day/ }))
  expect(screen.getByRole('heading', { name: 'Sunday 1 November' })).toBeInTheDocument()
})

test('/bookings redirects to /tickets', () => {
  // App wraps everything in AuthProvider/RequireAuth; only the redirect is under test here.
  render(
    <MemoryRouter initialEntries={['/bookings']}>
      <Routes>
        <Route path="/bookings" element={App.bookingsRedirect} />
        <Route path="/tickets" element={<p>Tickets screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByText('Tickets screen')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails** — expected module-not-found for `Tickets`.

- [ ] **Step 3: Tickets screen**

`src/screens/Tickets.tsx`:
```tsx
import { useState } from 'react'
import { useTrip } from '../lib/trip'
import { useBookingState } from '../lib/state'
import { fmtDay, nowInTz, todayInTrip } from '../lib/time'
import { countriesOf, cycleStatus, effectiveStatus, groupByDate, inferKind } from '../lib/tickets'
import { TicketCard } from '../components/TicketCard'
import { SyncBadge } from '../components/SyncBadge'
import { Icon } from '../components/Icon'

const COUNTRY_ICON: Record<string, string> = { tr: 'plane', pt: 'car', es: 'hotel', eg: 'event' }

export function Tickets() {
  const { trips, slug, content, loading, error, setSlug, refresh } = useTrip()
  const { state, save } = useBookingState(content?.trip.slug ?? '')
  const [showEarlier, setShowEarlier] = useState(false)

  if (loading && !content) return <main className="screen"><p className="caption">Loading…</p></main>
  if (error && !content) {
    return (
      <main className="screen">
        <p className="caption">{error}</p>
        <button type="button" className="btn--text" onClick={() => { void refresh() }}>Retry</button>
      </main>
    )
  }
  if (trips.length === 0) return <main className="screen"><p className="caption">No trips yet. Run the import on your laptop.</p></main>
  if (!content) return null

  const trip = content.trip
  const countries = countriesOf(trips)
  const activeCountry = countries.find(c => c.trips.some(t => t.slug === slug)) ?? countries[0]
  const today = todayInTrip(trip) ?? nowInTz(trip.timezone).date
  const groups = groupByDate(content.bookings)
  const earlier = groups.filter(g => g.date && g.date < today)
  const current = groups.filter(g => !g.date || g.date >= today)

  const cycle = (id: string) => {
    const b = content.bookings.find(x => x.id === id)!
    void save(id, { status: cycleStatus(effectiveStatus(b, state[id])) }).catch(() => {})
  }

  const renderGroup = (g: { date: string | null; bookings: typeof content.bookings }) => (
    <section key={g.date ?? 'undated'} className="tickets-day">
      <h2 className="tickets-day__heading">{g.date ? fmtDay(g.date) : 'Undated'}</h2>
      <ul className="tickets-list">
        {g.bookings.map(b => {
          const past = !!g.date && g.date < today
          return (
            <li key={b.id}>
              <TicketCard booking={b} kind={inferKind(b)} status={effectiveStatus(b, state[b.id])} tone={past ? 'past' : undefined}
                to={`/ticket/${trip.slug}/${b.id}`} onCycleStatus={() => cycle(b.id)} />
            </li>
          )
        })}
      </ul>
    </section>
  )

  return (
    <main className="screen tickets">
      <header className="tickets-header">
        <h1 className="h5">Tickets</h1>
        <SyncBadge />
      </header>

      <div className="seg" role="tablist" aria-label="Country">
        {countries.map(c => (
          <button key={c.country} type="button" role="tab" aria-selected={c === activeCountry}
            className={`seg__tab${c === activeCountry ? ' seg__tab--active' : ''}`}
            onClick={() => { if (c !== activeCountry) setSlug(c.trips[0].slug) }}>
            <Icon set="kind" name={COUNTRY_ICON[c.code?.toLowerCase()] ?? 'event'} size={18} />
            {c.country}
          </button>
        ))}
      </div>

      {activeCountry.trips.length > 1 && (
        <div className="chips" role="tablist" aria-label="City">
          {activeCountry.trips.map(t => (
            <button key={t.slug} type="button" role="tab" aria-selected={t.slug === slug}
              className={`chips__chip${t.slug === slug ? ' chips__chip--active' : ''}`} onClick={() => setSlug(t.slug)}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {earlier.length > 0 && !showEarlier && (
        <button type="button" className="tickets-earlier" onClick={() => setShowEarlier(true)}>
          {earlier.length} earlier {earlier.length === 1 ? 'day' : 'days'}
        </button>
      )}
      {showEarlier && earlier.map(renderGroup)}
      {current.length === 0 && earlier.length === 0 && <p className="caption">No tickets for {trip.name}.</p>}
      {current.map(renderGroup)}
    </main>
  )
}
```

- [ ] **Step 4: Routes**

In `src/App.tsx`: import `Navigate`; import `Tickets` from `./screens/Tickets`; remove the `Bookings` import and the `/bookings` element; add
```tsx
export const bookingsRedirect = <Navigate to="/tickets" replace />
```
above `export default function App()` and attach it as a static: after the function, `App.bookingsRedirect = bookingsRedirect` is not valid TS on a function declaration — instead export it as a named export and in the test import `{ bookingsRedirect }` (adjust the test's import line to `import App, { bookingsRedirect } from '../../src/App'` and use `element={bookingsRedirect}`). Routes:
```tsx
<Route path="/tickets" element={<Tickets />} />
<Route path="/bookings" element={bookingsRedirect} />
```

- [ ] **Step 5: Styles (append)**

```css
/* Tickets */
.tickets-header { display: flex; align-items: center; gap: 8px; }
.seg { display: flex; gap: 8px; overflow-x: auto; margin: 0 -16px 12px; padding: 0 16px 2px; -webkit-overflow-scrolling: touch; }
.seg__tab { display: flex; align-items: center; gap: 8px; flex-shrink: 0; min-height: 40px; padding: 0 16px; border: 0; border-radius: 12px;
  background: var(--surface); color: var(--text); font-weight: 700; font-size: 14px; cursor: pointer; }
.seg__tab--active { background: var(--highlight); color: var(--text-on-light); }
.chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.chips__chip { min-height: 32px; padding: 0 14px; border: 1px solid var(--border); border-radius: var(--radius-pill); background: none; color: var(--text-soft); font-weight: 600; font-size: 13px; cursor: pointer; }
.chips__chip--active { background: var(--accent); border-color: var(--accent); color: var(--text-on-lavender); }
.tickets-day { margin-bottom: 20px; }
.tickets-day__heading { position: sticky; top: 0; z-index: 2; margin: 0 -16px 12px; padding: 10px 16px; background: var(--bg); font-size: 15px; font-weight: 800; letter-spacing: .02em; color: var(--text-soft); }
.tickets-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.tickets-earlier { width: 100%; min-height: 44px; margin-bottom: 16px; border: 1px dashed var(--border); border-radius: var(--radius-panel); background: none; color: var(--text-dim); font-weight: 600; cursor: pointer; }
```

- [ ] **Step 6: Run, build, commit**

`npx vitest run && npm run build`. Then:
```bash
git add src/screens/Tickets.tsx src/App.tsx src/styles/base.css tests/app/Tickets.test.tsx
git commit -m "feat(tickets): upcoming view by country, city and day; /bookings redirects

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Ticket detail and place detail screens; retire Bookings

**Files:**
- Create: `src/components/BookingForm.tsx`, `src/components/AttachmentsPanel.tsx`, `src/screens/TicketDetail.tsx`, `src/screens/PlaceDetail.tsx`
- Modify: `src/App.tsx`, `src/styles/base.css`
- Delete: `src/screens/Bookings.tsx`, `tests/app/Bookings.test.tsx`
- Test: `tests/app/TicketDetail.test.tsx`, `tests/app/PlaceDetail.test.tsx`

**Interfaces:**
- `BookingForm({ booking, row, save })` — the status/ref/cost/currency/notes form lifted verbatim from `BookingSheet` in `Bookings.tsx` lines 192–235 and 341–372.
- `AttachmentsPanel({ tripSlug, bookingId })` — the attachments block lifted from `BookingSheet` lines 188–190, 237–280, 374–408; it calls `useAuth` itself.
- Routes: `/ticket/:trip/:id` → `TicketDetail`; `/place/:id` → `PlaceDetail`.

- [ ] **Step 1: Failing tests**

`tests/app/TicketDetail.test.tsx`:
```tsx
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, test, expect } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'
import type { AttachmentRow } from '../../src/lib/state'

const { useBookingStateMock, useAttachmentsMock } = vi.hoisted(() => ({
  useBookingStateMock: vi.fn(() => ({ state: {}, loading: false, save: vi.fn(async () => ({ queued: false })) })),
  useAttachmentsMock: vi.fn(() => ({ list: [] as AttachmentRow[], loading: false, upload: vi.fn(), url: vi.fn(), remove: vi.fn(), error: null as string | null, cached: new Set<string>() })),
}))
vi.mock('../../src/lib/state', () => ({ useBookingState: useBookingStateMock, useAttachments: useAttachmentsMock, useChecks: () => ({ done: new Set(), loading: false, toggle: vi.fn() }), QUEUED_COPY: 'q' }))
vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'owner-1' } } }) }))

import { TicketDetail } from '../../src/screens/TicketDetail'

const throwingClient = new Proxy({}, { get() { throw new Error('no network in tests') } }) as never
function mount(content: CityContent, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TripProvider initial={{ trips: [content.trip], slug: 'valle', content }} client={throwingClient}>
        <Routes><Route path="/ticket/:trip/:id" element={<TicketDetail />} /></Routes>
      </TripProvider>
    </MemoryRouter>,
  )
}
let content: CityContent
beforeEach(async () => { content = await loadValle() })

test('transport booking renders the boarding pass: route strip, title, cells, stub with form and attachments', () => {
  mount(content, '/ticket/valle/B02')
  const pass = screen.getByRole('article', { name: /Train south/ })
  expect(pass.className).toContain('pass')
  expect(within(pass).getByText('Tuesday 3 November')).toBeInTheDocument()
  expect(within(pass).getByText('09:10')).toBeInTheDocument()
  expect(screen.getByLabelText('Status')).toBeInTheDocument()          // BookingForm
  expect(screen.getByRole('heading', { name: 'Attachments' })).toBeInTheDocument()
})

test('event booking renders the place layout instead', () => {
  mount(content, '/ticket/valle/B01')
  expect(screen.getByRole('article', { name: /Trattoria Alba/ }).className).toContain('place-detail')
  expect(screen.getByLabelText('Status')).toBeInTheDocument()
})

test('unknown id shows a not-found line', () => {
  mount(content, '/ticket/valle/NOPE')
  expect(screen.getByText(/No ticket NOPE/)).toBeInTheDocument()
})
```

`tests/app/PlaceDetail.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, test, expect } from 'vitest'
import { TripProvider } from '../../src/lib/trip'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'

const { toggle } = vi.hoisted(() => ({ toggle: vi.fn(async () => ({ queued: false })) }))
vi.mock('../../src/lib/state', () => ({ useChecks: () => ({ done: new Set<string>(), loading: false, toggle }), QUEUED_COPY: 'q' }))

import { PlaceDetail } from '../../src/screens/PlaceDetail'

const throwingClient = new Proxy({}, { get() { throw new Error('no network in tests') } }) as never
let content: CityContent
beforeEach(async () => { content = await loadValle(); toggle.mockClear() })

test('shows the stop, its details, walk link and options; tick calls toggle', () => {
  const stop = content.items.find(i => i.kind === 'stop' && content.items.some(o => o.kind === 'option' && o.parent_item === i.id))!
  render(
    <MemoryRouter initialEntries={[`/place/${encodeURIComponent(stop.id)}`]}>
      <TripProvider initial={{ trips: [content.trip], slug: 'valle', content }} client={throwingClient}>
        <Routes><Route path="/place/:id" element={<PlaceDetail />} /></Routes>
      </TripProvider>
    </MemoryRouter>,
  )
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(stop.place_name ?? stop.plan.replace(/\*\*/g, ''))
  const options = content.items.filter(o => o.kind === 'option' && o.parent_item === stop.id)
  for (const o of options) expect(screen.getByText(new RegExp((o.place_name ?? o.plan).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 12)))).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Mark done/ }))
  expect(toggle).toHaveBeenCalledWith(stop.id)
})
```

- [ ] **Step 2: Run to verify they fail** — module-not-found.

- [ ] **Step 3: Extract BookingForm and AttachmentsPanel from Bookings.tsx**

Create `src/components/BookingForm.tsx` by moving these pieces of `BookingSheet` unchanged: the `STATUS_OPTIONS` constant, the state hooks for status/confirmationRef/cost/currency/notes/saving/saved/saveError/saveQueued and `savedTimer`, `handleSave`, and the `<div className="form booking-form">…</div>` JSX. Signature:
```tsx
export function BookingForm({ booking, row, save }: {
  booking: BookingRow
  row: BookingStateRow | undefined
  save(bookingId: string, patch: Partial<Omit<BookingStateRow, 'trip' | 'booking_id' | 'updated_at'>>): Promise<WriteResult>
})
```
Create `src/components/AttachmentsPanel.tsx` by moving: `fmtSize`, `handleOpenAttachment`, `handleDeleteAttachment`, `handleFileChange`, the `uploading/uploadQueued/actionError/uploadMsgTimer` state, the `useAuth` + `useAttachments` calls, and the `<div className="attachments">…</div>` JSX. Signature `export function AttachmentsPanel({ tripSlug, bookingId }: { tripSlug: string; bookingId: string })`; it returns `null` when `ownerId` is empty.

- [ ] **Step 4: TicketDetail**

`src/screens/TicketDetail.tsx`:
```tsx
import { Fragment } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTrip } from '../lib/trip'
import { useBookingState } from '../lib/state'
import { fmtDay } from '../lib/time'
import { effectiveStatus, fourCells, inferKind, kindIcon } from '../lib/tickets'
import { walkLink } from '../lib/links'
import { Icon } from '../components/Icon'
import { Md } from '../components/Md'
import { StatusPill } from '../components/StatusPill'
import { BookingForm } from '../components/BookingForm'
import { AttachmentsPanel } from '../components/AttachmentsPanel'
import type { BookingRow } from '../lib/types'

/** "Lisbon → Seville" / "LIS - SVQ" / "Airport to Benfica" → two labels; otherwise the title and the address. */
export function routeEnds(b: BookingRow): { from: string; to: string } {
  const m = b.title.match(/^(.*?)\s*(?:→|->|—>|\bto\b)\s*(.+)$/i)
  if (m && m[1].trim() && m[2].trim()) return { from: m[1].trim().replace(/^(AVE|Flight|Train|Taxi|Bolt)\s+/i, ''), to: m[2].trim() }
  return { from: b.title, to: b.address ?? '' }
}

export function TicketDetail() {
  const { trip: tripParam, id } = useParams<{ trip: string; id: string }>()
  const navigate = useNavigate()
  const { content, loading } = useTrip()
  const { state, save } = useBookingState(content?.trip.slug ?? '')

  if (loading && !content) return <main className="screen"><p className="caption">Loading…</p></main>
  if (!content) return null
  const booking = content.bookings.find(b => b.id === id && (!tripParam || b.trip === tripParam))
  if (!booking) return <main className="screen"><p className="caption">No ticket {id} in {content.trip.name}.</p><Link to="/tickets" className="btn--text">All tickets</Link></main>

  const kind = inferKind(booking)
  const status = effectiveStatus(booking, state[booking.id])
  const back = () => (history.length > 1 ? navigate(-1) : navigate('/tickets'))

  if (kind === 'event') {
    const walk = walkLink({ lat: null, lng: null, name: booking.title, address: booking.address }, content.trip.name)
    return (
      <main className="screen">
        <button type="button" className="back" onClick={back}>‹ Back</button>
        <article className="place-detail" aria-label={booking.title}>
          <div className="place-detail__hero place-detail__hero--event">
            <Icon set="kind" name="event" size={64} className="place-detail__glyph" />
            <h1 className="place-detail__title">{booking.title}</h1>
          </div>
          <div className="place-detail__facts">
            {booking.date && <span>{fmtDay(booking.date)}</span>}
            {booking.time && <span>{booking.time}</span>}
            {booking.fields.cost && <span>{booking.fields.cost}</span>}
            <StatusPill status={status} />
          </div>
          {booking.notes && <p className="place-detail__text"><Md text={booking.notes} /></p>}
          {booking.address && <p className="place-detail__address"><Icon set="nav" name="map" size={14} /> {booking.address}</p>}
          <div className="place-detail__actions">
            {walk && <a className="btn--text" href={walk} target="_blank" rel="noopener noreferrer">Walk there</a>}
            {booking.contact && /^[+\d]/.test(booking.contact) && <a className="btn--text" href={`tel:${booking.contact.replace(/(?!^\+)[^\d]/g, '')}`}>Call</a>}
          </div>
          <BookingForm booking={booking} row={state[booking.id]} save={save} />
          <AttachmentsPanel tripSlug={content.trip.slug} bookingId={booking.id} />
        </article>
      </main>
    )
  }

  const ends = routeEnds(booking)
  const cells = fourCells(booking)
  return (
    <main className="screen">
      <button type="button" className="back" onClick={back}>‹ Back</button>
      <article className={`pass pass--${kind}`} aria-label={booking.title}>
        <section className="pass__route">
          <div className="pass__end"><span className="pass__date">{booking.date ? fmtDay(booking.date) : '—'}</span><span className="pass__time">{booking.time ?? '—'}</span><span className="pass__place">{ends.from}</span></div>
          <div className="pass__mid"><Icon set="kind" name={kindIcon(kind, booking.title)} size={26} className="pass__glyph" /><span className="pass__dots" /></div>
          <div className="pass__end pass__end--to"><span className="pass__date">{kind === 'accommodation' ? 'Check-out' : ''}</span><span className="pass__time">{kind === 'accommodation' && booking.fields.nights ? `${booking.fields.nights} nights` : ''}</span><span className="pass__place">{ends.to}</span></div>
        </section>
        <section className="pass__body">
          <div className="pass__head">
            <div><span className="pass__label">Booking</span><span className="pass__name">{booking.title}</span></div>
            <div className="pass__right"><span className="pass__label">Ref</span><span className="pass__ref">{state[booking.id]?.confirmation_ref ?? booking.fields.ref ?? booking.id}</span></div>
          </div>
          {cells.length > 0 && (
            <dl className="pass__cells">
              {cells.map(c => <Fragment key={c.key}><div className="pass__cell"><dt>{c.key}</dt><dd>{c.value}</dd></div></Fragment>)}
            </dl>
          )}
          {booking.priority && <p className="caption">Priority: {booking.priority}</p>}
        </section>
        <section className="pass__stub">
          <div className="pass__status"><StatusPill status={status} />{booking.notes && <p className="pass__notes"><Md text={booking.notes} /></p>}{booking.fallback && <p className="pass__notes"><strong>Fallback:</strong> {booking.fallback}</p>}</div>
          <BookingForm booking={booking} row={state[booking.id]} save={save} />
          <AttachmentsPanel tripSlug={content.trip.slug} bookingId={booking.id} />
        </section>
      </article>
    </main>
  )
}
```

- [ ] **Step 5: PlaceDetail**

`src/screens/PlaceDetail.tsx`:
```tsx
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTrip } from '../lib/trip'
import { useChecks } from '../lib/state'
import { fmtDay, fmtTime } from '../lib/time'
import { bookingForStop } from '../lib/tickets'
import { walkLink } from '../lib/links'
import { Icon } from '../components/Icon'
import { Md } from '../components/Md'

const DURATION_RE = /(\d+(?:[.,]\d+)?)\s*(?:h(?:ours?|rs?)?|min(?:utes?|s)?)\b/i

export function PlaceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { content, loading } = useTrip()
  const { done, toggle } = useChecks(content?.trip.slug ?? '')

  if (loading && !content) return <main className="screen"><p className="caption">Loading…</p></main>
  if (!content) return null
  const item = content.items.find(i => i.id === id)
  if (!item) return <main className="screen"><p className="caption">No stop {id}.</p><Link to="/day" className="btn--text">Day</Link></main>

  const name = item.place_name ?? item.plan.replace(/\*\*/g, '')
  const options = content.items.filter(o => o.kind === 'option' && o.parent_item === item.id).sort((a, b) => a.sort - b.sort)
  const walk = walkLink({ lat: item.lat, lng: item.lng, name: item.place_name, address: item.address }, content.trip.name)
  const booking = bookingForStop(content.bookings, item)
  const duration = item.details?.match(DURATION_RE)?.[0] ?? null
  const isDone = done.has(item.id)

  return (
    <main className="screen">
      <button type="button" className="back" onClick={() => (history.length > 1 ? navigate(-1) : navigate(`/day/${item.date}`))}>‹ Back</button>
      <article className="place-detail" aria-label={name}>
        <div className="place-detail__hero">
          <Icon set="kind" name="event" size={64} className="place-detail__glyph" />
          <h1 className="place-detail__title">{name}</h1>
        </div>
        <div className="place-detail__facts">
          <span>{fmtDay(item.date)}</span>
          <span>{fmtTime(item.time, item.time_text)}</span>
          {duration && <span>{duration}</span>}
          <button type="button" className={`tick${isDone ? ' tick--done' : ''}`} aria-label={isDone ? 'Mark not done' : 'Mark done'} onClick={() => { void toggle(item.id).catch(() => {}) }}>✓</button>
        </div>
        {item.plan && item.place_name && <p className="place-detail__plan"><Md text={item.plan} /></p>}
        {item.details && <p className="place-detail__text"><Md text={item.details} /></p>}
        {item.address && <p className="place-detail__address"><Icon set="nav" name="map" size={14} /> {item.address}</p>}
        <div className="place-detail__actions">
          {walk && <a className="btn--text" href={walk} target="_blank" rel="noopener noreferrer">Walk there</a>}
          {booking && <Link className="btn--text" to={`/ticket/${content.trip.slug}/${booking.id}`}>Open ticket</Link>}
        </div>
        {options.length > 0 && (
          <section className="place-detail__options">
            <h2 className="h5">Pick one</h2>
            <ul className="option-list">
              {options.map(o => {
                const ow = walkLink({ lat: o.lat, lng: o.lng, name: o.place_name, address: o.address }, content.trip.name)
                return (
                  <li key={o.id} className="option-card">
                    <p className="option-card__name"><Md text={o.place_name ?? o.plan} /></p>
                    {o.details && <p className="option-card__details"><Md text={o.details} /></p>}
                    {ow && <a className="btn--text" href={ow} target="_blank" rel="noopener noreferrer">Walk there</a>}
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </article>
    </main>
  )
}
```

- [ ] **Step 6: Routes, delete Bookings**

In `src/App.tsx` import `TicketDetail` and `PlaceDetail`; add `<Route path="/ticket/:trip/:id" element={<TicketDetail />} />` and `<Route path="/place/:id" element={<PlaceDetail />} />` inside the Shell route. Then `git rm src/screens/Bookings.tsx tests/app/Bookings.test.tsx`. Search for remaining imports: `grep -rn "screens/Bookings" src tests` must return nothing.

- [ ] **Step 7: Styles (append)**

```css
/* Back */
.back { background: none; border: 0; color: var(--accent); font-weight: 700; font-size: 15px; padding: 0 0 12px; cursor: pointer; }

/* Boarding pass — Figma 1103:45 */
.pass { display: flex; flex-direction: column; gap: 12px; font-family: var(--font-ticket); }
.pass__route, .pass__body, .pass__stub { background: var(--surface); border-radius: var(--radius-card); padding: 20px; }
.pass__route { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; }
.pass__end { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pass__end--to { text-align: right; align-items: flex-end; }
.pass__date { font-size: 12px; color: var(--text-soft); }
.pass__time { font-size: 26px; font-weight: 700; color: var(--accent); line-height: 1.1; }
.pass__place { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.pass__mid { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 90px; }
.pass__glyph { color: var(--highlight); }
.pass__dots { width: 90px; border-top: 2px dotted rgba(255,255,255,.35); }
.pass__head { display: flex; justify-content: space-between; gap: 12px; }
.pass__head > div { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.pass__right { text-align: right; align-items: flex-end; }
.pass__label { font-size: 13px; color: var(--text-soft); }
.pass__name { font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.pass__ref { font-size: 16px; font-weight: 700; color: var(--accent); }
.pass__cells { display: grid; grid-template-columns: repeat(auto-fit, minmax(72px, 1fr)); gap: 12px; margin: 16px 0 0; padding: 14px 16px; background: var(--bg); border-radius: 14px; }
.pass__cell dt { font-size: 12px; color: var(--text-soft); margin-bottom: 4px; }
.pass__cell dd { margin: 0; font-size: 15px; font-weight: 700; overflow-wrap: anywhere; }
.pass__stub { position: relative; margin-top: 10px; font-family: var(--font); }
.pass__stub::before { content: ''; position: absolute; left: 24px; right: 24px; top: -11px; border-top: 2px dashed rgba(255,255,255,.35); }
.pass__stub::after, .pass__body::after { content: ''; position: absolute; width: 22px; height: 22px; border-radius: 50%; background: var(--bg); }
.pass__body { position: relative; }
.pass__body::after { left: -11px; bottom: -22px; box-shadow: calc(100% + 0px) 0 0 0 transparent; }
.pass__stub::after { right: -11px; top: -22px; }
.pass__status { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
.pass__notes { margin: 0; font-size: 14px; color: var(--text-soft); }

/* Place detail — Figma 1103:161 as a screen */
.place-detail { display: flex; flex-direction: column; gap: 14px; }
.place-detail__hero { position: relative; min-height: 220px; border-radius: var(--radius-card); background: var(--lavender); color: var(--text-on-lavender);
  display: flex; flex-direction: column; justify-content: flex-end; padding: 20px; overflow: hidden; }
.place-detail__hero--event { background: var(--surface); color: var(--text); }
.place-detail__glyph { position: absolute; right: 20px; top: 20px; opacity: .35; }
.place-detail__title { margin: 0; font-family: var(--font-ticket); font-weight: 700; font-size: 28px; line-height: 1.1; text-transform: uppercase; letter-spacing: .02em; overflow-wrap: anywhere; }
.place-detail__facts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; font-size: 14px; font-weight: 700; color: var(--text-soft); }
.place-detail__plan, .place-detail__text { margin: 0; font-size: 15px; line-height: 1.4; color: var(--text-soft); overflow-wrap: anywhere; }
.place-detail__address { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 14px; color: var(--text-soft); }
.place-detail__actions { display: flex; gap: 18px; }
.option-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.option-card { background: var(--surface); border-radius: var(--radius-panel); padding: 14px 16px; }
.option-card__name { margin: 0; font-weight: 700; }
.option-card__details { margin: 6px 0 8px; font-size: 14px; color: var(--text-soft); }
.tick { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--border); background: none; color: var(--text-dim); cursor: pointer; margin-left: auto; }
.tick--done { color: var(--text-on-lavender); background: var(--accent); border-color: var(--accent); }
```

- [ ] **Step 8: Run, build, commit**

`npx vitest run && npm run build`. Then:
```bash
git add -A src/components/BookingForm.tsx src/components/AttachmentsPanel.tsx src/screens/TicketDetail.tsx src/screens/PlaceDetail.tsx src/App.tsx src/styles/base.css tests/app/TicketDetail.test.tsx tests/app/PlaceDetail.test.tsx
git rm -q src/screens/Bookings.tsx tests/app/Bookings.test.tsx 2>/dev/null; git add -A src tests
git commit -m "feat(detail): boarding-pass ticket and place detail screens; Bookings retired

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Day rows, More, Map sheet link, auth restyle, remove legacy aliases and dead components

**Files:**
- Create: `src/components/StopRow.tsx`
- Modify: `src/screens/Day.tsx`, `src/screens/More.tsx`, `src/components/MapSheet.tsx`, `src/screens/Map.tsx` (sheet props), `src/components/Pill.tsx`, `src/components/SyncBadge.tsx`, `src/screens/Routes.tsx`, `src/styles/tokens.css`, `src/styles/base.css`, `src/lib/home.ts`
- Delete: `src/components/{OptionsCard,TileRow,TripPicker,StopCard}.tsx` and their tests if any (`grep -rln "OptionsCard\|TileRow\|TripPicker\|StopCard" tests`)
- Test: `tests/app/Day.test.tsx` (update), `tests/app/More.test.tsx` (update)

- [ ] **Step 1: Failing test additions**

Append to `tests/app/Day.test.tsx` (inside the existing describe/setup, using its `renderDay` and `content`):
```tsx
test('stops render as rows; a booked stop shows a ticket glyph linking to its ticket; others open the place', () => {
  renderDay('2026-11-01', content)
  const rows = document.querySelectorAll('.stop-row')
  expect(rows.length).toBeGreaterThan(0)
  const ticketLink = screen.getByRole('link', { name: /Open ticket/ })
  expect(ticketLink).toHaveAttribute('href', '/ticket/valle/B01')
  const placeLinks = screen.getAllByRole('link').filter(l => l.getAttribute('href')?.startsWith('/place/'))
  expect(placeLinks.length).toBeGreaterThan(0)
})

test('no weather strip and no trip picker on Day', () => {
  renderDay('2026-11-01', content)
  expect(document.querySelector('.weather')).toBeNull()
  expect(document.querySelector('.trip-picker')).toBeNull()
})
```
Also delete any existing Day tests that assert on `.stop-card`, "Details" expanders, or the weather strip — the row replaces the card and Details moved to the place screen. Add to `tests/app/More.test.tsx`: `expect(document.querySelector('.trip-picker')).toBeNull()` inside its main render test.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: StopRow**

`src/components/StopRow.tsx`:
```tsx
import { Link } from 'react-router-dom'
import { Md } from './Md'
import { Icon } from './Icon'
import { fmtTime } from '../lib/time'
import type { BookingRow, ItemRow } from '../lib/types'

function firstLine(text: string | null): string | null { if (!text) return null; const i = text.indexOf('\n'); return i === -1 ? text : text.slice(0, i) }

/** One compact timeline row: time in green, name, first details line, tick. Tap opens the place; a matching booking adds a ticket link. */
export function StopRow({ item, tripSlug, booking, done, onToggle }: {
  item: ItemRow
  tripSlug: string
  booking: BookingRow | null
  done: boolean
  onToggle: () => void
}) {
  const details = firstLine(item.details)
  return (
    <div className={`stop-row${done ? ' is-done' : ''}`}>
      <span className="stop-row__time">{fmtTime(item.time, item.time_text)}</span>
      <Link to={`/place/${encodeURIComponent(item.id)}`} className="stop-row__main">
        <span className="stop-row__plan"><Md text={item.plan} /></span>
        {details && <span className="stop-row__details"><Md text={details} /></span>}
        {booking && <span className="stop-row__ticket"><Icon set="nav" name="suitcase" size={14} /> ticket</span>}
      </Link>
      {booking && <Link to={`/ticket/${tripSlug}/${booking.id}`} className="stop-row__ticket-link" aria-label={`Open ticket ${booking.title}`}>Open ticket</Link>}
      <button type="button" className={`tick${done ? ' tick--done' : ''}`} aria-label={done ? 'Mark not done' : 'Mark done'} onClick={onToggle}>✓</button>
    </div>
  )
}
```

- [ ] **Step 4: Day.tsx edits**

- Remove imports of `TripPicker`, `StopCard`, `WeatherStrip`; import `StopRow` and `bookingForStop` from `../lib/tickets`.
- Delete the `<TripPicker …/>` line, the `goTrip` function, `setSlug`/`slug` from the destructure, and the `<WeatherStrip …/>` line.
- Replace the `StopCard` render with:
```tsx
<StopRow key={item.id} item={item} tripSlug={trip.slug} booking={bookingForStop(content.bookings, item)} done={done.has(item.id)} onToggle={() => { void handleToggle(item.id) }} />
```
- Options are no longer rendered inline (they live on the place screen); drop `optionsByParent`.

- [ ] **Step 5: More.tsx edits** — remove the `TripPicker` import and the `{trips.length > 1 && <TripPicker …/>}` line; `slug`/`setSlug` leave the destructure. Wrap each `more-section` content in the existing markup (no structural change); CSS below restyles.

- [ ] **Step 6: MapSheet ticket link** — add prop `ticketHref?: string | null` to `MapSheetProps` and render `{ticketHref && <Link className="btn--text" to={ticketHref}>Open ticket</Link>}` after the walk link (import `Link` from react-router-dom). In `src/screens/Map.tsx`, find the `<MapSheet` element (line ≈738) and pass `ticketHref={sheet.kind === 'stop' && sheetItem ? (bookingForStop(content.bookings, sheetItem) ? `/ticket/${content.trip.slug}/${bookingForStop(content.bookings, sheetItem)!.id}` : null) : null}` — read the surrounding code for the variable that holds the selected stop item (search `kind: 'stop'` in Map.tsx) and use its real name; compute the booking once into a `const` above the JSX rather than calling twice.

- [ ] **Step 7: Re-point tones and delete aliases**

- `src/components/Pill.tsx`: `export type PillTone = 'accent' | 'highlight' | 'lavender' | 'muted'`; CSS `.pill--highlight { background: var(--highlight); color: var(--text-on-light); } .pill--lavender { background: var(--lavender); color: var(--text-on-lavender); }`; delete the salmon/banana/columbia/coral pill rules.
- `src/components/SyncBadge.tsx`: `salmon → lavender`, `columbia → highlight`.
- `src/screens/Routes.tsx`: replace any tone names with `accent`/`muted` (grep it).
- `src/lib/home.ts`: delete `currentBlockOptions`, `deriveOptionsHeading`, `toursToday`, `tripCountdowns`, `daysBetween`, `legsToday` and their imports; keep `openReminders`, `fmtShortDate`, `LON*`/`LAT*`, `cityDot`. Delete the matching tests in `tests/lib/home.test.ts` (if present) for the removed functions.
- `git rm src/components/OptionsCard.tsx src/components/TileRow.tsx src/components/TripPicker.tsx src/components/StopCard.tsx` and any test files that import them.
- `src/styles/tokens.css`: delete the legacy-alias block. Then `grep -n "var(--card)\|var(--card-alt)\|var(--bg-2)\|var(--salmon)\|var(--banana)\|var(--granny)\|var(--golden)\|var(--columbia)\|var(--coral)" src/styles/base.css` and re-point each: `--card`→`--surface`, `--card-alt`/`--bg-2`→`--surface`, `--salmon`→`--lavender`, `--banana`/`--golden`→`--highlight`, `--columbia`/`--coral`/`--granny`→`--accent`. Delete the `.trip-picker*`, `.stop-card*` rules.

- [ ] **Step 8: Restyle blocks (edit in base.css)**

```css
/* Day rows */
.day-block__heading { font-size: 20px; font-weight: 800; }
.stop-row { display: grid; grid-template-columns: 52px 1fr auto auto; align-items: center; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.stop-row.is-done { opacity: .5; }
.stop-row.is-done .stop-row__plan { text-decoration: line-through; }
.stop-row__time { font-size: 14px; font-weight: 800; color: var(--accent); }
.stop-row__main { display: flex; flex-direction: column; gap: 3px; min-width: 0; text-decoration: none; color: inherit; }
.stop-row__plan { font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.stop-row__details { font-size: 13px; color: var(--text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stop-row__ticket { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--highlight); font-weight: 700; }
.stop-row__ticket-link { font-size: 12px; font-weight: 700; white-space: nowrap; }

/* More */
.more-section { background: var(--surface); border-radius: var(--radius-card); padding: 18px 20px; margin-bottom: 14px; }
.more-section__heading { margin: 0 0 12px; font-size: 16px; }
.btn--secondary { background: rgba(255,255,255,.08); color: var(--text); border: 1px solid var(--border); width: 100%; margin-bottom: 12px; border-radius: 14px; }

/* Auth */
.auth__brand { color: var(--accent); }
.field__input { background: var(--surface); border-color: transparent; border-radius: 14px; }
.btn--primary { background: var(--highlight); color: var(--text-on-light); border-radius: 14px; }

/* Map chrome */
.map-close, .map-seg, .map-places-toggle, .map-locate { background: var(--surface); border-color: transparent; }
.map-seg__btn.is-active { background: var(--accent); color: var(--text-on-lavender); }
.map-locate { color: var(--accent); }
```

- [ ] **Step 9: Run everything**

`npx vitest run && npm run build && grep -rn "salmon\|banana\|granny\|golden\|columbia\|coral\|--card\b\|--card-alt\|--bg-2" src` — the grep must print nothing.

- [ ] **Step 10: Commit**

```bash
git add -A src tests
git commit -m "feat(restyle): Day rows with ticket links, More cards, Map sheet ticket link, auth theme; drop legacy tones and dead components

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Headless screenshots for the owner's eye, notes, PR

**Files:**
- Create: `tools/probe-session.mjs`, `tools/probe-screens.mjs`, `docs/superpowers/plans/2026-09-16-plan-5-notes.md`
- Modify: `README.md` (one paragraph on the tools)

- [ ] **Step 1: Session helper (committed, reads .env, writes a fragment file outside the repo)**

`tools/probe-session.mjs`:
```js
// Creates a signed-in session for the owner and writes the URL fragment supabase-js accepts to argv[2].
// Usage: node tools/probe-session.mjs /tmp/frag.txt   (needs SUPABASE_SERVICE_KEY in .env; never prints tokens)
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '').replace(/\r/g, '')] }))
const email = process.argv[3] ?? 'housestudio.sc@gmail.com'
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
if (error) { console.error('generateLink failed:', error.message); process.exit(1) }
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const v = await anon.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
if (v.error) { console.error('verifyOtp failed:', v.error.message); process.exit(1) }
const s = v.data.session
writeFileSync(process.argv[2], `access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=${s.expires_in}&token_type=bearer&type=magiclink`)
console.log('session written')
```

- [ ] **Step 2: Screens probe**

`tools/probe-screens.mjs`:
```js
// Usage: node tools/probe-screens.mjs <fragFile> <outDir> [baseUrl] [tripSlug] [date]
// Default base: http://localhost:5173/europe-guide (run `npx vite preview --port 5173` first).
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
const [,, fragFile, outDir, base = 'http://localhost:5173/europe-guide', trip = 'seville', date = '2026-10-05'] = process.argv
const frag = readFileSync(fragFile, 'utf8').trim()
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME ?? '/Users/michaeldewet/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage(); const log = []
page.on('pageerror', e => log.push('[pageerror] ' + e.message))
await page.goto(`${base}/reset#${frag}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500)
const shots = [
  ['home', `/?trip=${trip}`], ['day', `/day/${date}?trip=${trip}`], ['tickets', `/tickets?trip=${trip}`], ['more', `/more?trip=${trip}`], ['map', `/map/${date}?trip=${trip}`],
]
for (const [name, path] of shots) {
  await page.goto(base + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(name === 'map' ? 7000 : 2500)
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: name !== 'map' })
  log.push(`${name}: ${page.url()}`)
}
// First ticket and first place from the Tickets and Day screens
await page.goto(`${base}/tickets?trip=${trip}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(2000)
const ticket = await page.locator('a.ticket-card').first().getAttribute('href'); if (ticket) { await page.goto(base + ticket.replace('/europe-guide', ''), { waitUntil: 'networkidle' }); await page.waitForTimeout(2000); await page.screenshot({ path: `${outDir}/ticket.png`, fullPage: true }) }
await page.goto(`${base}/day/${date}?trip=${trip}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(2000)
const place = await page.locator('a.stop-row__main').first().getAttribute('href'); if (place) { await page.goto(base + place.replace('/europe-guide', ''), { waitUntil: 'networkidle' }); await page.waitForTimeout(2000); await page.screenshot({ path: `${outDir}/place.png`, fullPage: true }) }
console.log(log.join('\n')); await browser.close()
```

- [ ] **Step 3: Run it against the built branch**

```bash
npm run build && (npx vite preview --port 5173 --strictPort > /dev/null 2>&1 &) && sleep 2
node tools/probe-session.mjs /tmp/eg-frag.txt && mkdir -p /tmp/eg-shots && node tools/probe-screens.mjs /tmp/eg-frag.txt /tmp/eg-shots
node tools/probe-screens.mjs /tmp/eg-frag.txt /tmp/eg-shots-lisbon http://localhost:5173/europe-guide lisbon 2026-10-01
pkill -f "vite preview --port 5173"
```
Open every PNG and check: fonts are Overpass/Poppins (letterforms, not system), tab bar has five icons with the yellow active one, Home shows greeting → weather → map → next-up → rows, Tickets shows country tabs and day headers, ticket screen shows the three-part pass, place screen shows the lavender hero. Fix anything visibly wrong before proceeding; re-run.

- [ ] **Step 4: Notes and README**

Write `docs/superpowers/plans/2026-09-16-plan-5-notes.md` with: per-task commit hashes, test count, anything deviating from the plan, and the screenshot checklist results. Add to `README.md` a short "Visual check" paragraph naming the two tools and their usage lines.

- [ ] **Step 5: Commit and open the PR**

```bash
git add tools README.md docs/superpowers/plans/2026-09-16-plan-5-notes.md
git commit -m "chore: headless screenshot tools and Plan 5 notes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/figma-redesign
gh pr create --title "Figma redesign: theme, tab bar, Home, Tickets, detail screens" --body "$(cat <<'EOF'
Plan 5 of the Europe Guide. Spec: docs/superpowers/specs/2026-09-16-figma-redesign-design.md.

- Figma palette and self-hosted Overpass/Poppins
- Five-tab bar with the Figma icons
- Home: greeting, weather row, world map, next-up ticket, ticket and place card rows, reminders
- Tickets tab (replaces Bookings): country tabs → city chips → day groups of ticket cards, status cycling
- Ticket detail (boarding pass) and place detail screens
- Day as compact rows with ticket links; More, Map chrome and auth restyled

Screenshots from tools/probe-screens.mjs attached in the first comment. Merge gate: the owner's eye on the look.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Attach the PNGs to the PR as a comment (`gh pr comment --body-file` with the images uploaded via the GitHub UI, or paste them into the chat for the owner). Do not merge; the owner approves the look first.

---

## Self-review

**Spec coverage.** §3 theme → Task 1; §5.1 tab bar → Task 2; §4 kind → Task 3 (title-only; spec amended); §5.2 Home → Task 5; §5.3 Tickets → Task 6 (single loaded city per selection — the app loads one city at a time, the country/city tabs switch it; spec amended to say so); §5.4–5.5 detail screens → Task 7; §5.6–5.9 Day/Map/More/auth → Task 8; §7 pure functions → Task 3; §9 testing → every task plus Task 9 screenshots; §10 delivery order → Tasks 1–9 on one branch. §6 photos → Plan 6 (`TicketCard`/`PlaceCard` already accept `photoSrc`).

**Placeholders.** None: every code step has its code; the two "read the surrounding code" instructions in Task 8 step 6 name the exact search strings.

**Type consistency.** `Status`, `TicketKind`, `effectiveStatus`, `cycleStatus`, `inferKind`, `kindIcon`, `ticketLines`, `fourCells`, `nextTicket`, `ticketsForDay`, `stopsForCards`, `bookingForStop`, `groupByDate`, `countriesOf` are defined once in Task 3 and used with those exact names in Tasks 4–8. `TicketCard` props `{ booking, kind, status, tone?, to, onCycleStatus?, photoSrc? }` match every call site. `BookingForm`/`AttachmentsPanel` signatures in Task 7 match their two call sites.
