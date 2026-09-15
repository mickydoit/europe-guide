# Europe Guide — Plan 1: Foundation and Import Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, sign-in-protected PWA shell on GitHub Pages backed by a new Supabase project, plus the `npm run import` pipeline that turns the four Lisbon markdown files into content rows, geocoded places, walking legs with polylines, and per-city offline map files.

**Architecture:** Vite + React + TypeScript app in `src/` talks to Supabase with the public anon key under Row Level Security. A separate Node CLI in `scripts/import/` runs on the laptop with the service key: strict markdown parsers → place extraction → Google geocoding with a cache table → leg splitting with Google Routes polylines → Protomaps extracts uploaded to storage → transactional content rewrite per city. Tests use synthetic fixtures for a fictional city so no private data enters the public repo; the real Lisbon files are exercised by a skipped-unless-present test.

**Tech Stack:** Node 25, Vite 8, React 19, TypeScript 7, Vitest 5, vite-plugin-pwa 1.3, @supabase/supabase-js 2.116, react-router-dom 7, idb 8 (later plans), Supabase CLI, go-pmtiles CLI, Google Geocoding + Routes APIs, GitHub Actions → Pages.

**Spec:** `docs/superpowers/specs/2026-09-14-europe-guide-design.md`

## Global Constraints

- Repo becomes **public** in Task 1; `content/`, `.env*` are gitignored and must never be committed. Check `git log --stat` before every push in this plan.
- Only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_BROWSER_KEY` may reach the browser bundle. `SUPABASE_SERVICE_KEY`, `GOOGLE_SERVER_KEY`, `OWNER_USER_ID`, `PROTOMAPS_BUILD_URL` are import-script only, read from `.env`.
- Every table has `owner uuid not null default auth.uid()` and RLS `owner = auth.uid()`. Sign-ups disabled.
- Import fails fast on any unrecognised heading, table shape, missing id, or unparsable time, reporting file and line.
- Item ids are `<trip>/<date>/<HHMM|seq>/<slug(plan)>`.
- Design tokens from `design/figma-source.md`: bg `#202123`, accent `#11DA8F`, card `#252525`, border `#434445`, text white; SF Pro Display / Inter fallbacks to system.
- Commit after every task with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.
- Deadline context: this plan is Days 1–2 of 6. Do not add features beyond the spec.

## File structure

```
europe-guide/
├── .github/workflows/deploy.yml        build + deploy to Pages on push to main
├── .env.example                        names of all env vars, no values
├── index.html, vite.config.ts, tsconfig.json, tsconfig.node.json, vitest.config.ts
├── package.json
├── public/manifest.webmanifest, public/icons/icon-192.png, icon-512.png, apple-touch-icon.png
├── supabase/
│   ├── config.toml                     from `supabase init`
│   └── migrations/
│       ├── 20260915000001_content.sql  trips, days, items, bookings, routes, legs, alerts, parked_venues, standing_notes, offline_areas
│       ├── 20260915000002_state.sql    item_checks, booking_state, attachments, day_notes, geocode_cache
│       └── 20260915000003_storage.sql  bucket `tickets`, bucket `maps`, policies
├── src/
│   ├── main.tsx                        React root + router
│   ├── App.tsx                         routes, RequireAuth wrapper, tab bar shell
│   ├── styles/tokens.css               CSS variables from Figma tokens
│   ├── styles/base.css                 reset, safe-area, typography
│   ├── lib/supabase.ts                 browser client (anon key)
│   ├── lib/auth.tsx                    AuthProvider, useAuth(), RequireAuth
│   ├── lib/types.ts                    Row types shared with the import script (re-export)
│   ├── screens/SignIn.tsx
│   ├── screens/ResetPassword.tsx
│   ├── screens/Placeholder.tsx         "Home / Day / Map / Bookings" stubs for Plan 1
│   ├── screens/More.tsx                sign out + trip list (proves data reads work)
│   └── components/TabBar.tsx
├── scripts/import/
│   ├── cli.ts                          entry: `tsx scripts/import/cli.ts <city> [--dry-run]`
│   ├── env.ts                          loads and validates .env
│   ├── types.ts                        parsed record types (source of truth for rows)
│   ├── timezones.ts                    trip name → IANA tz + region code
│   ├── md.ts                           front matter, heading walk, table parsing, ImportError
│   ├── parse/itinerary.ts
│   ├── parse/bookings.ts
│   ├── parse/routes.ts
│   ├── parse/parked.ts
│   ├── ids.ts                          slug(), itemId()
│   ├── places.ts                       extractPlace(planCell), pointsFromGoogleUrl(url)
│   ├── geocode.ts                      geocodeAll() with Supabase cache
│   ├── legs.ts                         splitLegs(), legDeepLink(), fetchPolyline()
│   ├── offline.ts                      clusterPoints(), bboxes(), extractPmtiles(), upload
│   ├── write.ts                        rewriteCity()
│   └── report.ts                       summary printer
└── tests/
    ├── fixtures/valle/                 fictional city "Valle" mirroring the Lisbon shapes
    │   ├── Valle-Itinerary-Full.md
    │   ├── Valle-Bookings-Reminders.md
    │   ├── Valle-Walking-Routes.md
    │   └── Valle-Parked-Venues.md
    ├── fixtures/broken/*.md            one bad file per failure mode
    ├── import/*.test.ts
    └── app/*.test.tsx
```

---

### Task 1: Scaffold the PWA, tokens, deploy workflow, public repo

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `vitest.config.ts`, `index.html`, `public/manifest.webmanifest`, `public/icons/*`, `src/main.tsx`, `src/App.tsx`, `src/styles/tokens.css`, `src/styles/base.css`, `src/screens/Placeholder.tsx`, `src/components/TabBar.tsx`, `.github/workflows/deploy.yml`, `.env.example`, `tests/app/smoke.test.tsx`
- Modify: `.gitignore`, `README.md`

**Interfaces:**
- Produces: `npm run dev|build|test|import`, Vite `base: '/europe-guide/'`, tab routes `/`, `/day`, `/map`, `/bookings`, `/more`.

- [ ] **Step 1: Initialise the project**

```bash
cd ~/Developer/Github/europe-guide
npm init -y >/dev/null
npm pkg set name=europe-guide private=true type=module
npm pkg set scripts.dev=vite scripts.build="tsc --noEmit && vite build" scripts.preview=vite\ preview scripts.test="vitest run" scripts.test:watch=vitest scripts.import="tsx scripts/import/cli.ts"
npm i react@19 react-dom@19 react-router-dom@7 @supabase/supabase-js@2
npm i -D vite@8 @vitejs/plugin-react@6 typescript@7 vitest@5 jsdom@30 @testing-library/react@16 @testing-library/jest-dom @types/react @types/react-dom vite-plugin-pwa@1 tsx dotenv
```

- [ ] **Step 2: Config files**

`vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/europe-guide/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: false,
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        cleanupOutdatedCaches: true,
        navigateFallback: '/europe-guide/index.html',
      },
    }),
  ],
})
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
```

`tests/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["ES2023", "DOM", "DOM.Iterable"], "module": "ESNext",
    "moduleResolution": "bundler", "jsx": "react-jsx", "strict": true, "noEmit": true,
    "skipLibCheck": true, "resolveJsonModule": true, "isolatedModules": true,
    "types": ["vite/client", "vite-plugin-pwa/client", "node"]
  },
  "include": ["src", "scripts", "tests"]
}
```

`tsconfig.node.json`: same as above but `"include": ["vite.config.ts", "vitest.config.ts"]` and `"types": ["node"]`. Also `npm i -D @types/node`. Vite 8 and Vitest 5 use `tsx`-free ESM config loading, so no build of the config is needed.

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#202123" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="manifest" href="/europe-guide/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/europe-guide/icons/apple-touch-icon.png" />
    <title>Europe Guide</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`public/manifest.webmanifest`:
```json
{
  "name": "Europe Guide", "short_name": "Europe", "start_url": "/europe-guide/",
  "scope": "/europe-guide/", "display": "standalone", "background_color": "#202123",
  "theme_color": "#202123",
  "icons": [
    { "src": "/europe-guide/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/europe-guide/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Icons: generate placeholder PNGs with `sips` from a 512×512 solid Coal square with a green dot (any simple image is fine; owner replaces later):
```bash
mkdir -p public/icons
python3 - <<'EOF'
import zlib,struct
def png(path,size):
    raw=b''
    for y in range(size):
        raw+=b'\x00'
        for x in range(size):
            d=((x-size/2)**2+(y-size/2)**2)**0.5
            raw+=bytes([0x11,0xDA,0x8F]) if d<size*0.22 else bytes([0x20,0x21,0x23])
    def chunk(t,b): return struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b)&0xffffffff)
    open(path,'wb').write(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b''))
png('public/icons/icon-192.png',192); png('public/icons/icon-512.png',512); png('public/icons/apple-touch-icon.png',180)
EOF
```

- [ ] **Step 3: Tokens, base styles, shell**

`src/styles/tokens.css`:
```css
:root {
  --bg: #202123; --bg-nav: #131313; --card: #252525; --card-alt: #2a2c2f;
  --border: #434445; --muted: #5a5b5d; --pill: #3a3b3d; --bg-2: #303133;
  --accent: #11da8f; --salmon: #ff7262; --banana: #fbdd40;
  --granny: #bde9c9; --golden: #f8e08e; --columbia: #9ee1fe; --coral: #f8c1b8;
  --text: #ffffff; --text-dim: rgba(255,255,255,.4); --text-soft: rgba(255,255,255,.8);
  --radius-card: 8px; --radius-panel: 17px; --radius-pill: 9999px;
  --font: -apple-system, "SF Pro Display", "SF Pro Text", Inter, system-ui, sans-serif;
  --safe-top: env(safe-area-inset-top); --safe-bottom: env(safe-area-inset-bottom);
}
```

`src/styles/base.css`:
```css
@import './tokens.css';
*, *::before, *::after { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font-family: var(--font); -webkit-font-smoothing: antialiased; }
a { color: var(--accent); }
button { font: inherit; }
.screen { padding: calc(var(--safe-top) + 16px) 16px calc(var(--safe-bottom) + 96px); min-height: 100%; }
.h5 { font-size: 20px; font-weight: 700; line-height: 1; margin: 0 0 16px; }
.caption { font-size: 14px; line-height: 16px; color: var(--text-dim); }
```

`src/components/TabBar.tsx`:
```tsx
import { NavLink } from 'react-router-dom'
const tabs = [
  { to: '/', label: 'Home' }, { to: '/day', label: 'Day' }, { to: '/map', label: 'Map' },
  { to: '/bookings', label: 'Bookings' }, { to: '/more', label: 'More' },
]
export function TabBar() {
  return (
    <nav style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: 'calc(64px + var(--safe-bottom))',
      paddingBottom: 'var(--safe-bottom)', background: 'var(--bg-nav)', borderTop: '1px solid rgba(255,255,255,.15)',
      display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
      {tabs.map(t => (
        <NavLink key={t.to} to={t.to} end={t.to === '/'} style={({ isActive }) => ({
          color: 'white', opacity: isActive ? 1 : 0.4, textDecoration: 'none', fontSize: 12, fontWeight: 700 })}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
```

`src/screens/Placeholder.tsx`:
```tsx
export function Placeholder({ title }: { title: string }) {
  return <main className="screen"><h1 className="h5">{title}</h1><p className="caption">Coming in a later plan.</p></main>
}
```

`src/App.tsx` (auth wrapper is added in Task 3; for now plain routes):
```tsx
import { Routes, Route } from 'react-router-dom'
import { TabBar } from './components/TabBar'
import { Placeholder } from './screens/Placeholder'
export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Placeholder title="Home" />} />
        <Route path="/day" element={<Placeholder title="Day" />} />
        <Route path="/map" element={<Placeholder title="Map" />} />
        <Route path="/bookings" element={<Placeholder title="Bookings" />} />
        <Route path="/more" element={<Placeholder title="More" />} />
      </Routes>
      <TabBar />
    </>
  )
}
```

`src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles/base.css'
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/europe-guide"><App /></BrowserRouter>
  </React.StrictMode>,
)
```

- [ ] **Step 4: Smoke test**

`tests/app/smoke.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../../src/App'
test('renders the Home placeholder and five tabs', () => {
  render(<MemoryRouter><App /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
  expect(screen.getAllByRole('link')).toHaveLength(5)
})
```
Run: `npm test` → PASS. Run: `npm run build` → `dist/` produced with `sw.js`.

- [ ] **Step 5: Deploy workflow and env example**

`.github/workflows/deploy.yml`: copy the Fitness Tracker workflow at `~/Developer/Github/Mickyworksout/.github/workflows/deploy.yml` (checkout → setup-node with npm cache → `npm ci` → `npm run build` → configure-pages → upload `dist` → deploy-pages), with `on.push.branches: [main, plan-1-foundation]`, `node-version: 22`, and under the build step:
```yaml
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
          VITE_GOOGLE_BROWSER_KEY: ${{ secrets.VITE_GOOGLE_BROWSER_KEY }}
```
`.env.example`:
```
# browser (public by design)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_GOOGLE_BROWSER_KEY=
# import script only — never shipped
SUPABASE_SERVICE_KEY=
OWNER_USER_ID=
GOOGLE_SERVER_KEY=
PROTOMAPS_BUILD_URL=
```
Append to `.gitignore`: `dev-dist/`, `supabase/.temp/`, `*.pmtiles`.

- [ ] **Step 6: Make the repo public and enable Pages**

```bash
git log --stat | grep -E "content/|\.env" && echo "STOP: private data in history" || echo clean
gh repo edit mickydoit/europe-guide --visibility public --accept-visibility-change-consequences
gh api -X POST repos/mickydoit/europe-guide/pages -f build_type=workflow
```
Commit and push; confirm the Actions run succeeds and `https://mickydoit.github.io/europe-guide/` shows the Home placeholder with the tab bar. (Secrets are set in Task 2; the build tolerates empty values until Task 3 reads them.)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: Vite React PWA scaffold, tokens, tab shell, Pages deploy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push
```

---

### Task 2: Supabase project, schema, RLS, storage, owner user

**Files:**
- Create: `supabase/config.toml`, `supabase/migrations/20260915000001_content.sql`, `supabase/migrations/20260915000002_state.sql`, `supabase/migrations/20260915000003_storage.sql`, `scripts/import/types.ts`, `src/lib/types.ts`
- Modify: `.env` (local only)

**Interfaces:**
- Produces: all tables in spec §3 with the exact column names below; buckets `tickets` (private) and `maps` (private); one auth user; repo secrets set.

- [ ] **Step 1: Install CLI and create the project (owner runs the login)**

```bash
brew install supabase/tap/supabase pmtiles
supabase login          # owner runs this: `! supabase login` — opens browser
supabase orgs list      # pick the org that hosts the Budget app
supabase projects create europe-guide --org-id <ORG_ID> --region eu-west-2 --db-password "$(openssl rand -base64 24 | tee /dev/stderr)"
```
Record the DB password in the owner's password manager, not in the repo. Then:
```bash
cd ~/Developer/Github/europe-guide && supabase init && supabase link --project-ref <REF>
supabase projects api-keys --project-ref <REF>    # anon + service_role
```
Write `.env` from `.env.example` with `VITE_SUPABASE_URL=https://<REF>.supabase.co`, the anon key, and the service key.

- [ ] **Step 2: Content migration**

`supabase/migrations/20260915000001_content.sql`:
```sql
create extension if not exists pgcrypto;

create table trips (
  slug text primary key,
  owner uuid not null default auth.uid(),
  name text not null, country text not null, country_code text not null,
  start_date date not null, end_date date not null,
  base text, timezone text not null, intro text, sort int not null default 0
);
create table days (
  trip text not null references trips(slug) on delete cascade,
  date date not null,
  owner uuid not null default auth.uid(),
  title text, status text check (status in ('locked','locked_except_dinner')), intro text,
  primary key (trip, date)
);
create table items (
  id text primary key,
  owner uuid not null default auth.uid(),
  trip text not null references trips(slug) on delete cascade,
  date date not null,
  block text check (block in ('morning','midday','evening')),
  time time, time_text text, approx boolean not null default false,
  kind text not null check (kind in ('stop','option','note','route_link')),
  parent_item text references items(id) on delete cascade,
  plan text not null, details text, sort int not null,
  place_name text, address text, lat double precision, lng double precision,
  url text, route_id text
);
create index items_trip_date on items(trip, date, sort);
create table bookings (
  id text not null,
  trip text not null references trips(slug) on delete cascade,
  owner uuid not null default auth.uid(),
  kind text not null check (kind in ('booked','todo','walkin')),
  title text not null, date date, time time, priority text,
  book_by date, decide_by date, contact text, address text, notes text, fallback text,
  relates_to text, options text, status_from_file text, fields jsonb not null default '{}',
  sort int not null default 0,
  primary key (trip, id)
);
create table routes (
  id text not null,
  trip text not null references trips(slug) on delete cascade,
  owner uuid not null default auth.uid(),
  date date, title text not null, distance_text text,
  mode text not null default 'walking' check (mode in ('walking','driving','transit')),
  covers text[] not null default '{}', note text, google_url text not null, sort int not null default 0,
  primary key (trip, id)
);
create table legs (
  trip text not null, route_id text not null, seq int not null,
  owner uuid not null default auth.uid(),
  from_name text not null, to_name text not null,
  from_lat double precision, from_lng double precision, to_lat double precision, to_lng double precision,
  google_url text not null, polyline text, distance_m int, duration_s int,
  primary key (trip, route_id, seq),
  foreign key (trip, route_id) references routes(trip, id) on delete cascade
);
create table alerts (
  trip text not null references trips(slug) on delete cascade,
  date date not null, seq int not null,
  owner uuid not null default auth.uid(),
  time time, text text not null,
  primary key (trip, date, seq)
);
create table parked_venues (
  trip text not null references trips(slug) on delete cascade, seq int not null,
  owner uuid not null default auth.uid(),
  name text not null, what text, why text, address text, lat double precision, lng double precision,
  primary key (trip, seq)
);
create table standing_notes (
  trip text not null references trips(slug) on delete cascade, seq int not null,
  owner uuid not null default auth.uid(),
  section text not null, text text not null,
  primary key (trip, seq)
);
create table offline_areas (
  trip text not null references trips(slug) on delete cascade, seq int not null,
  owner uuid not null default auth.uid(),
  name text not null, min_lng double precision not null, min_lat double precision not null,
  max_lng double precision not null, max_lat double precision not null,
  pmtiles_path text not null, size_bytes bigint not null, built_at timestamptz not null default now(),
  primary key (trip, seq)
);

do $$ declare t text; begin
  foreach t in array array['trips','days','items','bookings','routes','legs','alerts','parked_venues','standing_notes','offline_areas'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy owner_all on %I for all using (owner = auth.uid()) with check (owner = auth.uid())', t);
  end loop;
end $$;
```

- [ ] **Step 3: State migration**

`supabase/migrations/20260915000002_state.sql`:
```sql
create table item_checks (
  item_id text primary key, owner uuid not null default auth.uid(), done_at timestamptz not null default now()
);
create table booking_state (
  trip text not null, booking_id text not null, owner uuid not null default auth.uid(),
  status text check (status in ('not_booked','booked','confirmed','cancelled','undecided')),
  confirmation_ref text, cost numeric, currency text default 'EUR', notes text,
  updated_at timestamptz not null default now(),
  primary key (trip, booking_id)
);
create table attachments (
  id uuid primary key default gen_random_uuid(), owner uuid not null default auth.uid(),
  trip text not null, booking_id text not null, storage_path text not null,
  filename text not null, mime text not null, size bigint not null, uploaded_at timestamptz not null default now()
);
create table day_notes (
  trip text not null, date date not null, owner uuid not null default auth.uid(),
  text text, saved_places jsonb not null default '[]', updated_at timestamptz not null default now(),
  primary key (trip, date)
);
create table geocode_cache (
  query text primary key, owner uuid not null default auth.uid(),
  lat double precision, lng double precision, formatted_address text, place_id text,
  fetched_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['item_checks','booking_state','attachments','day_notes','geocode_cache'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy owner_all on %I for all using (owner = auth.uid()) with check (owner = auth.uid())', t);
  end loop;
end $$;
```

- [ ] **Step 4: Storage migration**

`supabase/migrations/20260915000003_storage.sql`:
```sql
insert into storage.buckets (id, name, public, file_size_limit)
values ('tickets','tickets',false, 26214400), ('maps','maps',false, 314572800)
on conflict (id) do nothing;

create policy tickets_owner on storage.objects for all
  using (bucket_id = 'tickets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'tickets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy maps_read on storage.objects for select
  using (bucket_id = 'maps' and auth.role() = 'authenticated');
```
Maps are written only by the service key (import), read by any signed-in user (there is only one).

- [ ] **Step 5: Push migrations, disable sign-ups, create the owner**

```bash
supabase db push
```
In `supabase/config.toml` under `[auth]` set `enable_signup = false` and `[auth.email] enable_confirmations = false`, then `supabase config push` (if the CLI version supports it; otherwise Dashboard → Authentication → Sign In / Providers → disable "Allow new users to sign up"). Set Dashboard → Authentication → URL Configuration → Site URL `https://mickydoit.github.io/europe-guide/` and add redirect `https://mickydoit.github.io/europe-guide/reset`, `http://localhost:5173/europe-guide/reset`.

Create the user (service key, one-off):
```bash
source .env && curl -s "$VITE_SUPABASE_URL/auth/v1/admin/users" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" -H "Content-Type: application/json" \
  -d '{"email":"michaeldewet@cvglobal.co","password":"<OWNER PICKS>","email_confirm":true}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])'
```
Put the printed uuid in `.env` as `OWNER_USER_ID`. Set JWT expiry 3600 s and refresh token reuse interval default; confirm "refresh token rotation" on and expiry 90 days in Dashboard → Auth → Sessions.

- [ ] **Step 6: Verify RLS from the anon key**

```bash
source .env && curl -s "$VITE_SUPABASE_URL/rest/v1/trips?select=slug" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"
```
Expected: `[]` (no error, no rows). Then sign in via the token endpoint and confirm the same query still returns `[]` (nothing imported yet) but with status 200.

- [ ] **Step 7: Row types**

`scripts/import/types.ts`:
```ts
export type Block = 'morning' | 'midday' | 'evening' | null
export type ItemKind = 'stop' | 'option' | 'note' | 'route_link'
export interface TripRow { slug: string; name: string; country: string; country_code: string; start_date: string; end_date: string; base: string | null; timezone: string; intro: string | null; sort: number }
export interface DayRow { trip: string; date: string; title: string | null; status: 'locked' | 'locked_except_dinner' | null; intro: string | null }
export interface ItemRow { id: string; trip: string; date: string; block: Block; time: string | null; time_text: string | null; approx: boolean; kind: ItemKind; parent_item: string | null; plan: string; details: string | null; sort: number; place_name: string | null; address: string | null; lat: number | null; lng: number | null; url: string | null; route_id: string | null }
export interface BookingRow { id: string; trip: string; kind: 'booked' | 'todo' | 'walkin'; title: string; date: string | null; time: string | null; priority: string | null; book_by: string | null; decide_by: string | null; contact: string | null; address: string | null; notes: string | null; fallback: string | null; relates_to: string | null; options: string | null; status_from_file: string | null; fields: Record<string, string>; sort: number }
export interface RouteRow { id: string; trip: string; date: string | null; title: string; distance_text: string | null; mode: 'walking' | 'driving' | 'transit'; covers: string[]; note: string | null; google_url: string; sort: number }
export interface LegRow { trip: string; route_id: string; seq: number; from_name: string; to_name: string; from_lat: number | null; from_lng: number | null; to_lat: number | null; to_lng: number | null; google_url: string; polyline: string | null; distance_m: number | null; duration_s: number | null }
export interface AlertRow { trip: string; date: string; seq: number; time: string | null; text: string }
export interface ParkedRow { trip: string; seq: number; name: string; what: string | null; why: string | null; address: string | null; lat: number | null; lng: number | null }
export interface NoteRow { trip: string; seq: number; section: string; text: string }
export interface OfflineAreaRow { trip: string; seq: number; name: string; min_lng: number; min_lat: number; max_lng: number; max_lat: number; pmtiles_path: string; size_bytes: number }
export interface CityContent { trip: TripRow; days: DayRow[]; items: ItemRow[]; bookings: BookingRow[]; routes: RouteRow[]; legs: LegRow[]; alerts: AlertRow[]; parked: ParkedRow[]; notes: NoteRow[]; areas: OfflineAreaRow[] }
```
`src/lib/types.ts`: `export * from '../../scripts/import/types'`.

- [ ] **Step 8: Repo secrets and commit**

```bash
source .env
gh secret set VITE_SUPABASE_URL -b "$VITE_SUPABASE_URL"
gh secret set VITE_SUPABASE_ANON_KEY -b "$VITE_SUPABASE_ANON_KEY"
git add supabase scripts/import/types.ts src/lib/types.ts && git commit -m "feat: Supabase schema, RLS, storage buckets, shared row types

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push
```

---

### Task 3: Auth in the app

**Files:**
- Create: `src/lib/supabase.ts`, `src/lib/auth.tsx`, `src/screens/SignIn.tsx`, `src/screens/ResetPassword.tsx`, `src/screens/More.tsx`, `tests/app/auth.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `useAuth(): { session: Session | null; loading: boolean; signIn(email, password): Promise<string | null>; signOut(): Promise<void>; requestReset(email): Promise<string | null>; updatePassword(pw): Promise<string | null> }` (string = error message), `<RequireAuth>` wrapper, `supabase` client export.

- [ ] **Step 1: Client**

`src/lib/supabase.ts`:
```ts
import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string
if (!url || !key) console.warn('Supabase env missing; auth will fail')
export const supabase = createClient(url ?? 'http://localhost', key ?? 'anon', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
})
```

- [ ] **Step 2: Failing tests**

`tests/app/auth.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

const signInWithPassword = vi.fn()
const onAuthStateChange = vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } }))
vi.mock('../../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange, signInWithPassword,
    signOut: vi.fn(), resetPasswordForEmail: vi.fn(), updateUser: vi.fn() } },
}))
import App from '../../src/App'

test('unauthenticated user sees sign in instead of Home', async () => {
  render(<MemoryRouter><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Home' })).toBeNull()
})

test('bad password shows the error message', async () => {
  signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } })
  render(<MemoryRouter><App /></MemoryRouter>)
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'a@b.c' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(screen.getByText('Invalid login credentials')).toBeInTheDocument())
})
```
Run `npm test` → FAIL (no Sign in heading).

- [ ] **Step 3: AuthProvider**

`src/lib/auth.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from './supabase'

interface Auth {
  session: Session | null; loading: boolean
  signIn(email: string, password: string): Promise<string | null>
  signOut(): Promise<void>
  requestReset(email: string): Promise<string | null>
  updatePassword(password: string): Promise<string | null>
}
const Ctx = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  const value: Auth = {
    session, loading,
    async signIn(email, password) { const { error } = await supabase.auth.signInWithPassword({ email, password }); return error?.message ?? null },
    async signOut() { await supabase.auth.signOut() },
    async requestReset(email) {
      const redirectTo = `${location.origin}/europe-guide/reset`
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo }); return error?.message ?? null
    },
    async updatePassword(password) { const { error } = await supabase.auth.updateUser({ password }); return error?.message ?? null },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
export function useAuth() { const v = useContext(Ctx); if (!v) throw new Error('useAuth outside AuthProvider'); return v }
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth(); const loc = useLocation()
  if (loading) return null
  if (!session) return <Navigate to="/signin" replace state={{ from: loc.pathname }} />
  return <>{children}</>
}
```

- [ ] **Step 4: Screens**

`src/screens/SignIn.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
export function SignIn() {
  const { signIn, requestReset } = useAuth(); const nav = useNavigate(); const loc = useLocation()
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null)
    const err = await signIn(email, password)
    if (err) setError(err); else nav((loc.state as { from?: string } | null)?.from ?? '/', { replace: true })
  }
  async function forgot() { setError(null); const err = await requestReset(email); setInfo(err ?? 'Reset email sent. Check your inbox.') }
  return (
    <main className="screen" style={{ display: 'grid', alignContent: 'center', gap: 16, maxWidth: 400, margin: '0 auto' }}>
      <h1 className="h5">Sign in</h1>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <label>Email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {error && <p role="alert" style={{ color: 'var(--salmon)' }}>{error}</p>}
        {info && <p className="caption">{info}</p>}
        <button type="submit">Sign in</button>
        <button type="button" onClick={forgot} disabled={!email} style={{ background: 'none', border: 0, color: 'var(--accent)' }}>Forgot password</button>
      </form>
    </main>
  )
}
```
(Wrap the `<input>`s so the label text is the accessible name: `<label>Email<input …/></label>` works with `getByLabelText('Email')`.)

`src/screens/ResetPassword.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
export function ResetPassword() {
  const { updatePassword } = useAuth(); const nav = useNavigate()
  const [pw, setPw] = useState(''); const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) { e.preventDefault(); const err = await updatePassword(pw); if (err) setError(err); else nav('/', { replace: true }) }
  return (
    <main className="screen" style={{ maxWidth: 400, margin: '0 auto' }}>
      <h1 className="h5">Set a new password</h1>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <label>New password<input type="password" autoComplete="new-password" minLength={8} value={pw} onChange={e => setPw(e.target.value)} required /></label>
        {error && <p role="alert" style={{ color: 'var(--salmon)' }}>{error}</p>}
        <button type="submit">Save</button>
      </form>
    </main>
  )
}
```
Supabase sends the user to `/reset` with a recovery session already established (PKCE + `detectSessionInUrl`), so `updateUser` works without a token field.

`src/screens/More.tsx` (proves authenticated reads work; trip list is empty until Task 11):
```tsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { TripRow } from '../lib/types'
export function More() {
  const { signOut, session } = useAuth(); const [trips, setTrips] = useState<TripRow[]>([])
  useEffect(() => { supabase.from('trips').select('*').order('sort').then(({ data }) => setTrips((data ?? []) as TripRow[])) }, [])
  return (
    <main className="screen">
      <h1 className="h5">More</h1>
      <p className="caption">{session?.user.email}</p>
      <ul>{trips.map(t => <li key={t.slug}>{t.name} · {t.start_date} → {t.end_date}</li>)}</ul>
      <button onClick={signOut}>Sign out</button>
    </main>
  )
}
```

`src/App.tsx`:
```tsx
import { Routes, Route, Outlet } from 'react-router-dom'
import { AuthProvider, RequireAuth } from './lib/auth'
import { TabBar } from './components/TabBar'
import { Placeholder } from './screens/Placeholder'
import { SignIn } from './screens/SignIn'
import { ResetPassword } from './screens/ResetPassword'
import { More } from './screens/More'
function Shell() { return <><Outlet /><TabBar /></> }
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/reset" element={<ResetPassword />} />
        <Route element={<RequireAuth><Shell /></RequireAuth>}>
          <Route path="/" element={<Placeholder title="Home" />} />
          <Route path="/day" element={<Placeholder title="Day" />} />
          <Route path="/map" element={<Placeholder title="Map" />} />
          <Route path="/bookings" element={<Placeholder title="Bookings" />} />
          <Route path="/more" element={<More />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
```
Update `tests/app/smoke.test.tsx` to mock `supabase` with a session present (same mock shape, `getSession` returning `{ data: { session: { user: { email: 'x' } } } }`) so it still asserts Home + five tabs.

- [ ] **Step 5: Run tests, build, deploy, phone check**

`npm test` → PASS (3 tests). `npm run build` → OK. Push, wait for Actions, open the Pages URL on the iPhone: sign in with the owner credentials, land on Home, open More, see the email, sign out, sign back in, send a reset email and complete the flow once.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: email/password auth, reset flow, RequireAuth shell

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push
```

---

### Task 4: Markdown primitives and fixtures

**Files:**
- Create: `scripts/import/md.ts`, `tests/import/md.test.ts`, `tests/fixtures/valle/*.md` (4 files), `tests/fixtures/broken/*.md`

**Interfaces:**
- Produces:
  - `class ImportError extends Error { constructor(file: string, line: number, msg: string) }` with `.file`, `.line`.
  - `parseFrontMatter(src): { data: Record<string,string>; body: string; bodyStartLine: number }`
  - `type Node = { kind: 'heading'; level: 1|2|3; text: string; line: number } | { kind: 'table'; header: string[]; rows: string[][]; line: number } | { kind: 'para'; text: string; line: number } | { kind: 'bullets'; items: string[]; line: number } | { kind: 'hr'; line: number }`
  - `tokenize(body: string, startLine = 1): Node[]`
  - `cellText(s: string): string` (trims, unescapes `\|`)

- [ ] **Step 1: Fixtures**

Write `tests/fixtures/valle/Valle-Itinerary-Full.md` with the same grammar as Lisbon but fictional content, covering every shape the parser must handle: intro paragraph under the H1; a day with `✅ LOCKED`; a day with `✅ LOCKED except dinner`; a day with no block headings (like Friday); `Time | Plan | Details` and `Time | Plan` tables; a `— ` time row; a `~18:00` time; an options table `Place | Address | Hours | Why` placed after the END of the block's stops table, where the "pick one below" row is NOT the last row of that table (mirrors Lisbon: the snack list follows the whole Evening table); a `**[Walking route for this whole block →](https://www.google.com/maps/dir/?api=1&origin=A%2C+Valle&destination=B%2C+Valle&waypoints=C%2C+Valle&travelmode=walking)** — ~2 km` paragraph; a bold-led note paragraph; a plain note paragraph. Minimum two days, five stops, one options table with two rows.

Write `Valle-Bookings-Reminders.md` with front matter (`trip: Valle`, `dates: 2026-11-01 to 2026-11-03`, `base: Old Town`, `travellers: 2`, `country: Italy`, `timezone: Europe/Rome`), sections `## 1.` (table with 2 rows), `## 2.` (two `### T01 · …` entries; T01 with `book_by: 2026-10-20 (immediately)`, `for: 2026-11-02, 19:30`, `why_urgent`; T02 with `decide_by: 2026-10-25`, `options: A · B`, `status: undecided`), `## 3.` (names separated by ` · ` plus an `**Exception:**` paragraph), `## 4.` (two weekday headings with `time | alert` tables, one `—` time), `## 5.` (three bullets).

Write `Valle-Walking-Routes.md` with front matter, one `## Weekday` heading with two `### V1 — title` entries (one with `- **mode:** driving`), bullet fields `distance`, `covers` (arrow-separated), `note`, `url`; a `**Not walking:** …` paragraph; and a `## Rough daily walking totals` table.

Write `Valle-Parked-Venues.md` with a three-column table of three rows, first cell `**Name**, Area` style.

Broken fixtures (`tests/fixtures/broken/`): `bad-heading.md` (a day heading `# Wed 30 Sept`), `bad-table.md` (a table headed `Time | What | Where`), `missing-id.md` (a `### · Dinner` booking with no id), `bad-time.md` (`| 25:70 | X | Y |`).

- [ ] **Step 2: Failing tests**

`tests/import/md.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { parseFrontMatter, tokenize, cellText, ImportError } from '../../scripts/import/md'

test('front matter is split from body with line offset', () => {
  const src = readFileSync('tests/fixtures/valle/Valle-Bookings-Reminders.md', 'utf8')
  const fm = parseFrontMatter(src)
  expect(fm.data.trip).toBe('Valle')
  expect(fm.data.dates).toBe('2026-11-01 to 2026-11-03')
  expect(fm.bodyStartLine).toBeGreaterThan(5)
  expect(fm.body.startsWith('\n# ') || fm.body.startsWith('# ')).toBe(true)
})

test('tokenize yields headings, tables, paragraphs, bullets and hrs with line numbers', () => {
  const src = readFileSync('tests/fixtures/valle/Valle-Itinerary-Full.md', 'utf8')
  const nodes = tokenize(src)
  const kinds = nodes.map(n => n.kind)
  expect(kinds).toContain('heading'); expect(kinds).toContain('table'); expect(kinds).toContain('para'); expect(kinds).toContain('hr')
  const t = nodes.find(n => n.kind === 'table')!
  expect(t.kind === 'table' && t.header).toEqual(['Time', 'Plan', 'Details'])
  expect(nodes[0]).toMatchObject({ kind: 'heading', level: 1, line: 1 })
})

test('table rows keep escaped pipes and trim cells', () => {
  const nodes = tokenize('| A | B |\n|---|---|\n| one \\| two | three |\n')
  const t = nodes[0]
  expect(t.kind === 'table' && t.rows[0]).toEqual(['one | two', 'three'])
})

test('bullets are grouped', () => {
  const nodes = tokenize('- **a:** 1\n- **b:** 2\n\npara\n')
  expect(nodes[0]).toMatchObject({ kind: 'bullets', items: ['**a:** 1', '**b:** 2'] })
  expect(nodes[1]).toMatchObject({ kind: 'para', text: 'para' })
})

test('ImportError carries file and line', () => {
  const e = new ImportError('x.md', 12, 'bad')
  expect(e.message).toBe('x.md:12: bad'); expect(e.line).toBe(12)
})
```
Run: `npx vitest run tests/import/md.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

`scripts/import/md.ts`:
```ts
export class ImportError extends Error {
  constructor(public file: string, public line: number, msg: string) { super(`${file}:${line}: ${msg}`) }
}
export type Node =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; line: number }
  | { kind: 'table'; header: string[]; rows: string[][]; line: number }
  | { kind: 'para'; text: string; line: number }
  | { kind: 'bullets'; items: string[]; line: number }
  | { kind: 'hr'; line: number }

export function parseFrontMatter(src: string) {
  const lines = src.split('\n')
  if (lines[0].trim() !== '---') return { data: {}, body: src, bodyStartLine: 1 }
  const end = lines.indexOf('---', 1)
  if (end < 0) return { data: {}, body: src, bodyStartLine: 1 }
  const data: Record<string, string> = {}
  for (const l of lines.slice(1, end)) { const m = l.match(/^([\w-]+):\s*(.*)$/); if (m) data[m[1]] = m[2].trim() }
  return { data, body: lines.slice(end + 1).join('\n'), bodyStartLine: end + 2 }
}

function splitRow(l: string): string[] {
  const cells: string[] = []; let cur = ''
  const inner = l.trim().replace(/^\|/, '').replace(/\|$/, '')
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\' && inner[i + 1] === '|') { cur += '|'; i++ } else if (inner[i] === '|') { cells.push(cur); cur = '' } else cur += inner[i]
  }
  cells.push(cur); return cells.map(cellText)
}
export const cellText = (s: string) => s.trim()

export function tokenize(body: string, startLine = 1): Node[] {
  const lines = body.split('\n'); const out: Node[] = []
  let i = 0
  const ln = () => startLine + i
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    if (/^---+$/.test(l.trim())) { out.push({ kind: 'hr', line: ln() }); i++; continue }
    const h = l.match(/^(#{1,3})\s+(.*)$/)
    if (h) { out.push({ kind: 'heading', level: h[1].length as 1 | 2 | 3, text: h[2].trim(), line: ln() }); i++; continue }
    if (l.trim().startsWith('|')) {
      const line = ln(); const header = splitRow(l); i++
      if (!(lines[i] ?? '').trim().match(/^\|?\s*:?-+/)) throw new ImportError('<md>', line, 'table without separator row')
      i++; const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i])); i++ }
      out.push({ kind: 'table', header, rows, line }); continue
    }
    if (/^[-*]\s+/.test(l)) {
      const line = ln(); const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, '').trim()); i++ }
      out.push({ kind: 'bullets', items, line }); continue
    }
    const line = ln(); const buf: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\||[-*]\s|---)/.test(lines[i])) { buf.push(lines[i].trim()); i++ }
    out.push({ kind: 'para', text: buf.join(' '), line })
  }
  return out
}
```

- [ ] **Step 4: Run tests** → PASS. **Step 5: Commit** `feat(import): markdown tokenizer, front matter, fixtures`.

---

### Task 5: Itinerary parser

**Files:**
- Create: `scripts/import/parse/itinerary.ts`, `scripts/import/ids.ts`, `tests/import/itinerary.test.ts`, `tests/import/ids.test.ts`

**Interfaces:**
- Consumes: `tokenize`, `ImportError`, `Node` from `md.ts`; `TripRow` fields `slug`, `start_date`.
- Produces:
  - `slug(s: string): string` (lowercase, ascii-fold, `[^a-z0-9]+` → `-`, trimmed, max 40)
  - `itemId(trip: string, date: string, time: string | null, seq: number, plan: string): string` → `${trip}/${date}/${time ? time.replace(':','') : String(seq).padStart(3,'0')}/${slug(plan)}`
  - `parseItinerary(file: string, src: string, ctx: { trip: string; year: number }): { intro: string | null; days: DayRow[]; items: ItemRow[] }`
  - Exported helpers: `parseDayHeading(text, year): { date: string; title: string | null; status: DayRow['status'] } | null`, `parseTime(cell): { time: string | null; text: string | null; approx: boolean }` (throws on malformed like `25:70`).

- [ ] **Step 1: Failing tests**

`tests/import/ids.test.ts`:
```ts
import { slug, itemId } from '../../scripts/import/ids'
test('slug folds accents and punctuation', () => {
  expect(slug('**Senzi**, R. da Moeda 12')).toBe('senzi-r-da-moeda-12')
  expect(slug('Miradouro de Santa Catarina')).toBe('miradouro-de-santa-catarina')
  expect(slug('Praça do Comércio')).toBe('praca-do-comercio')
})
test('itemId uses HHMM when timed, zero-padded seq otherwise', () => {
  expect(itemId('valle', '2026-11-02', '08:00', 3, '**Senzi**, R. da Moeda 12')).toBe('valle/2026-11-02/0800/senzi-r-da-moeda-12')
  expect(itemId('valle', '2026-11-02', null, 3, 'Tell the guide')).toBe('valle/2026-11-02/003/tell-the-guide')
})
```

`tests/import/itinerary.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { parseItinerary, parseDayHeading, parseTime } from '../../scripts/import/parse/itinerary'
import { ImportError } from '../../scripts/import/md'
const src = readFileSync('tests/fixtures/valle/Valle-Itinerary-Full.md', 'utf8')
const ctx = { trip: 'valle', year: 2026 }

test('day headings parse date, title and status', () => {
  expect(parseDayHeading('Wednesday 30 September — orientation ✅ LOCKED', 2026)).toEqual({ date: '2026-09-30', title: 'orientation', status: 'locked' })
  expect(parseDayHeading('Saturday 3 October — going back properly ✅ LOCKED except dinner', 2026)).toEqual({ date: '2026-10-03', title: 'going back properly', status: 'locked_except_dinner' })
  expect(parseDayHeading('Tuesday 29 September — arrival', 2026)).toEqual({ date: '2026-09-29', title: 'arrival', status: null })
  expect(parseDayHeading('Lisbon, 29 September – 4 October 2026', 2026)).toBeNull()
})
test('times', () => {
  expect(parseTime('08:00')).toEqual({ time: '08:00', text: '08:00', approx: false })
  expect(parseTime('~18:00')).toEqual({ time: '18:00', text: '~18:00', approx: true })
  expect(parseTime('—')).toEqual({ time: null, text: null, approx: false })
  expect(parseTime('Evening')).toEqual({ time: null, text: 'Evening', approx: false })
  expect(() => parseTime('25:70')).toThrow()
})
test('fixture parses into days, blocks, stops, options, notes and route links', () => {
  const r = parseItinerary('Valle-Itinerary-Full.md', src, ctx)
  expect(r.intro).toMatch(/Staying/)
  expect(r.days.length).toBeGreaterThanOrEqual(2)
  const stops = r.items.filter(i => i.kind === 'stop')
  expect(stops.length).toBeGreaterThanOrEqual(5)
  expect(stops.every(s => s.sort >= 0 && s.id.startsWith('valle/'))).toBe(true)
  const opts = r.items.filter(i => i.kind === 'option')
  expect(opts.length).toBe(2)
  expect(opts[0].parent_item).toBe(stops.find(s => /pick one below/i.test(s.plan))!.id)
  const rl = r.items.find(i => i.kind === 'route_link')!
  expect(rl.url).toMatch(/^https:\/\/www\.google\.com\/maps\/dir/)
  expect(rl.block).toBe('midday')
  const noBlock = r.items.filter(i => i.date === r.days[r.days.length - 1].date)
  expect(noBlock.some(i => i.block === null)).toBe(true)
  const withPlace = stops.find(s => s.place_name === 'Caffè Nord')!
  expect(withPlace.address).toBe('Via Roma 12')
})
test('unknown table shape fails with file:line', () => {
  const bad = readFileSync('tests/fixtures/broken/bad-table.md', 'utf8')
  expect(() => parseItinerary('bad-table.md', bad, ctx)).toThrow(ImportError)
  expect(() => parseItinerary('bad-table.md', bad, ctx)).toThrow(/bad-table\.md:\d+/)
})
test('unknown H1 heading fails', () => {
  const bad = readFileSync('tests/fixtures/broken/bad-heading.md', 'utf8')
  expect(() => parseItinerary('bad-heading.md', bad, ctx)).toThrow(/day heading/)
})
```
(Fixture must include a stop `**Caffè Nord**, Via Roma 12`.) Run → FAIL.

- [ ] **Step 2: Implement `ids.ts`**

```ts
export function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
}
export function itemId(trip: string, date: string, time: string | null, seq: number, plan: string): string {
  return `${trip}/${date}/${time ? time.replace(':', '') : String(seq).padStart(3, '0')}/${slug(plan)}`
}
```

- [ ] **Step 3: Implement `parse/itinerary.ts`**

```ts
import { tokenize, ImportError, type Node } from '../md'
import { itemId } from '../ids'
import type { DayRow, ItemRow, Block } from '../types'

const WEEKDAYS = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday'
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_RE = new RegExp(`^(?:${WEEKDAYS}) (\\d{1,2}) (${MONTHS.join('|')})(?: — (.*?))?(?: ✅ (.*))?$`)

export function parseDayHeading(text: string, year: number) {
  const m = text.match(DAY_RE); if (!m) return null
  const date = `${year}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  const status = m[4] == null ? null : /except dinner/i.test(m[4]) ? 'locked_except_dinner' : /^locked/i.test(m[4]) ? 'locked' : null
  if (m[4] && status === null) throw new Error(`unknown day status "${m[4]}"`)
  return { date, title: m[3]?.trim() || null, status } as const
}

export function parseTime(cell: string) {
  const c = cell.trim()
  if (c === '—' || c === '-' || c === '') return { time: null, text: null, approx: false }
  const m = c.match(/^(~)?(\d{1,2}):(\d{2})$/)
  if (!m) { if (/\d/.test(c)) throw new Error(`unparsable time "${c}"`); return { time: null, text: c, approx: false } }
  const h = +m[2], mi = +m[3]
  if (h > 23 || mi > 59) throw new Error(`invalid time "${c}"`)
  return { time: `${String(h).padStart(2, '0')}:${m[3]}`, text: c, approx: !!m[1] }
}

const PLACE_RE = /\*\*([^*]+)\*\*(?:,\s*([^—|]+?))?(?:\s*—.*)?$/
export function extractPlace(plan: string): { place_name: string | null; address: string | null } {
  const m = plan.match(/\*\*([^*]+)\*\*(?:,\s*([^—]+?))?(?=\s*(?:—|$))/)
  if (!m) return { place_name: null, address: null }
  const name = m[1].replace(/\s*[—-]\s*(BOOKED|booked)$/, '').trim()
  if (/^(Book|Tell the guide|Option|Alternatives|Or stay|Confirm|Check|Pick one|Walk to|Early start|Long day)/i.test(name)) return { place_name: null, address: null }
  return { place_name: name, address: m[2]?.trim() || null }
}

const BLOCKS: Record<string, Block> = { Morning: 'morning', Midday: 'midday', Evening: 'evening' }

export function parseItinerary(file: string, src: string, ctx: { trip: string; year: number }) {
  const nodes = tokenize(src)
  const days: DayRow[] = []; const items: ItemRow[] = []
  let intro: string[] = []; let day: DayRow | null = null; let block: Block = null
  let seq = 0; let lastStop: ItemRow | null = null; let lastPick: ItemRow | null = null; let sawTrip = false
  const fail = (n: Node, msg: string): never => { throw new ImportError(file, n.line, msg) }
  const push = (partial: Omit<ItemRow, 'id' | 'trip' | 'date' | 'block' | 'sort'>): ItemRow => {
    if (!day) fail(nodes[0], 'content before first day heading')
    const row: ItemRow = { ...partial, id: itemId(ctx.trip, day!.date, partial.time, seq, partial.plan), trip: ctx.trip, date: day!.date, block, sort: seq++ }
    if (items.some(i => i.id === row.id)) row.id = `${row.id}-${seq}`
    items.push(row); return row
  }
  for (const n of nodes) {
    if (n.kind === 'hr') continue
    if (n.kind === 'heading' && n.level === 1) {
      const d = (() => { try { return parseDayHeading(n.text, ctx.year) } catch (e) { return fail(n, (e as Error).message) } })()
      if (!d) { if (!sawTrip && days.length === 0) { sawTrip = true; continue } fail(n, `not a day heading: "${n.text}"`) }
      day = { trip: ctx.trip, date: d!.date, title: d!.title, status: d!.status, intro: null }
      days.push(day); block = null; seq = 0; lastStop = null; lastPick = null; continue
    }
    if (n.kind === 'heading' && n.level === 2) {
      if (!(n.text in BLOCKS)) fail(n, `unknown block heading "${n.text}" (expected Morning/Midday/Evening)`)
      block = BLOCKS[n.text]; continue
    }
    if (n.kind === 'heading') fail(n, `unexpected ### heading "${n.text}"`)
    if (!day) { if (n.kind === 'para') intro.push(n.text); else fail(n, 'table before first day heading'); continue }
    if (n.kind === 'table') {
      const h = n.header.map(s => s.toLowerCase())
      if (h[0] === 'time' && h[1] === 'plan') {
        for (const r of n.rows) {
          const t = (() => { try { return parseTime(r[0]) } catch (e) { return fail(n, (e as Error).message) } })()
          const { place_name, address } = extractPlace(r[1])
          lastStop = push({ kind: 'stop', time: t.time, time_text: t.text, approx: t.approx, parent_item: null, plan: r[1], details: r[2] ?? null, place_name, address, lat: null, lng: null, url: null, route_id: null })
          if (/pick one|options? below|choose one/i.test(`${r[1]} ${r[2] ?? ''}`)) lastPick = lastStop
        }
      } else if (h[0] === 'place') {
        const parent = lastPick ?? lastStop
        if (!parent) fail(n, 'options table with no preceding stop')
        for (const r of n.rows) {
          const { place_name } = extractPlace(r[0]); const name = place_name ?? r[0].replace(/\*\*/g, '')
          push({ kind: 'option', time: null, time_text: null, approx: false, parent_item: parent!.id, plan: name, details: n.header.slice(1).map((k, i) => `**${k}:** ${r[i + 1] ?? ''}`).join(' · '), place_name: name, address: r[1] || null, lat: null, lng: null, url: null, route_id: null })
        }
      } else fail(n, `unknown table shape [${n.header.join(' | ')}]`)
      continue
    }
    if (n.kind === 'para') {
      const rl = n.text.match(/^\*\*\[[^\]]*\]\((https:\/\/www\.google\.com\/maps\/dir[^)]+)\)\*\*(.*)$/)
      if (rl) push({ kind: 'route_link', time: null, time_text: null, approx: false, parent_item: null, plan: 'Walking route for this block', details: rl[2].replace(/^\s*—\s*/, '').trim() || null, place_name: null, address: null, lat: null, lng: null, url: rl[1], route_id: null })
      else push({ kind: 'note', time: null, time_text: null, approx: false, parent_item: null, plan: n.text, details: null, place_name: null, address: null, lat: null, lng: null, url: null, route_id: null })
      continue
    }
    if (n.kind === 'bullets') { for (const b of n.items) push({ kind: 'note', time: null, time_text: null, approx: false, parent_item: null, plan: b, details: null, place_name: null, address: null, lat: null, lng: null, url: null, route_id: null }); continue }
  }
  if (days.length === 0) throw new ImportError(file, 1, 'no day headings found')
  return { intro: intro.length ? intro.join('\n\n') : null, days, items }
}
```
Note the first H1 (`# Lisbon, 29 September – 4 October 2026`) is the trip title, allowed once before any day. `extractPlace` lives here for now; Task 8 moves it to `places.ts` unchanged.

- [ ] **Step 4: Run tests** → PASS. **Step 5: Commit** `feat(import): itinerary parser and item ids`.

---

### Task 6: Bookings parser

**Files:**
- Create: `scripts/import/parse/bookings.ts`, `tests/import/bookings.test.ts`

**Interfaces:**
- Produces: `parseBookings(file, src, ctx: { trip: string; year: number }): { front: Record<string,string>; bookings: BookingRow[]; alerts: AlertRow[]; notes: NoteRow[] }`. Sections identified by leading number in `## N.` headings. Walk-in names become `walkin` bookings `WK01…`. Standing notes get `section: 'standing'`; the walk-in exception paragraph gets `section: 'walkin'`.

- [ ] **Step 1: Failing tests**

```ts
import { readFileSync } from 'node:fs'
import { parseBookings } from '../../scripts/import/parse/bookings'
import { ImportError } from '../../scripts/import/md'
const src = readFileSync('tests/fixtures/valle/Valle-Bookings-Reminders.md', 'utf8')
const ctx = { trip: 'valle', year: 2026 }
test('front matter and booked table', () => {
  const r = parseBookings('b.md', src, ctx)
  expect(r.front.trip).toBe('Valle')
  const booked = r.bookings.filter(b => b.kind === 'booked')
  expect(booked.map(b => b.id)).toEqual(['B01', 'B02'])
  expect(booked[0]).toMatchObject({ date: '2026-11-01', time: '20:00', title: expect.any(String), notes: expect.any(String) })
})
test('todo entries with bullet fields', () => {
  const r = parseBookings('b.md', src, ctx)
  const t1 = r.bookings.find(b => b.id === 'T01')!
  expect(t1.kind).toBe('todo'); expect(t1.priority).toBe('critical'); expect(t1.book_by).toBe('2026-10-20'); expect(t1.fields.book_by_note).toBe('immediately')
  expect(t1.date).toBe('2026-11-02'); expect(t1.time).toBe('19:30'); expect(t1.contact).toMatch(/^\+39/)
  expect(t1.fields.why_urgent).toBeDefined()
  const t2 = r.bookings.find(b => b.id === 'T02')!
  expect(t2.decide_by).toBe('2026-10-25'); expect(t2.options).toContain('·'); expect(t2.status_from_file).toBe('undecided')
})
test('walk-ins become WK bookings and the exception a note', () => {
  const r = parseBookings('b.md', src, ctx)
  const wk = r.bookings.filter(b => b.kind === 'walkin')
  expect(wk.length).toBeGreaterThanOrEqual(3); expect(wk[0].id).toBe('WK01')
  expect(r.notes.some(n => n.section === 'walkin')).toBe(true)
})
test('alerts by weekday with nullable time', () => {
  const r = parseBookings('b.md', src, ctx)
  expect(r.alerts.length).toBeGreaterThanOrEqual(3)
  expect(r.alerts[0]).toMatchObject({ date: '2026-11-01', seq: 0, time: null })
  expect(r.alerts.find(a => a.time === '09:15')?.text).toMatch(/now/i)
})
test('standing notes', () => {
  const r = parseBookings('b.md', src, ctx)
  expect(r.notes.filter(n => n.section === 'standing')).toHaveLength(3)
})
test('missing id fails', () => {
  const bad = readFileSync('tests/fixtures/broken/missing-id.md', 'utf8')
  expect(() => parseBookings('missing-id.md', bad, ctx)).toThrow(ImportError)
})
```

- [ ] **Step 2: Implement**

```ts
import { parseFrontMatter, tokenize, ImportError, type Node } from '../md'
import { parseDayHeading, parseTime } from './itinerary'
import type { BookingRow, AlertRow, NoteRow } from '../types'

const COLS = new Set(['priority','book_by','decide_by','contact','address','notes','note','fallback','relates_to','options','status'])

export function parseBookings(file: string, src: string, ctx: { trip: string; year: number }) {
  const fm = parseFrontMatter(src); const nodes = tokenize(fm.body, fm.bodyStartLine)
  const bookings: BookingRow[] = []; const alerts: AlertRow[] = []; const notes: NoteRow[] = []
  let section = 0; let cur: BookingRow | null = null; let alertDate: string | null = null; let alertSeq = 0; let noteSeq = 0; let sort = 0
  const fail = (n: Node, msg: string): never => { throw new ImportError(file, n.line, msg) }
  const blank = (id: string, kind: BookingRow['kind'], title: string): BookingRow => ({ id, trip: ctx.trip, kind, title, date: null, time: null, priority: null, book_by: null, decide_by: null, contact: null, address: null, notes: null, fallback: null, relates_to: null, options: null, status_from_file: null, fields: {}, sort: sort++ })
  for (const n of nodes) {
    if (n.kind === 'hr') continue
    if (n.kind === 'heading' && n.level === 1) continue
    if (n.kind === 'heading' && n.level === 2) {
      const m = n.text.match(/^(\d)\./); if (!m) fail(n, `section heading must start with a number: "${n.text}"`)
      section = +m![1]; cur = null; continue
    }
    if (section === 0) { continue }
    if (section === 1) {
      if (n.kind !== 'table') continue
      if (n.header.map(s => s.toLowerCase()).join('|') !== 'id|item|date|time|notes') fail(n, `booked table must be id|item|date|time|notes`)
      for (const r of n.rows) { const b = blank(r[0], 'booked', r[1]); b.date = r[2] || null; b.time = r[3] && r[3] !== '—' ? parseTime(r[3]).time : null; b.notes = r[4] || null; if (!/^[A-Z]+\d+$/.test(b.id)) fail(n, `bad booking id "${b.id}"`); bookings.push(b) }
      continue
    }
    if (section === 2) {
      if (n.kind === 'heading' && n.level === 3) {
        const m = n.text.match(/^([A-Z]+\d+)\s*·\s*(.+)$/); if (!m) fail(n, `to-book heading needs "ID · title": "${n.text}"`)
        cur = blank(m![1], 'todo', m![2].trim()); bookings.push(cur); continue
      }
      if (n.kind === 'bullets') {
        if (!cur) fail(n, 'fields before any booking heading')
        for (const it of n.items) {
          const m = it.match(/^\*\*([\w_]+):\*\*\s*(.*)$/); if (!m) fail(n, `field bullet must be "**key:** value": "${it}"`)
          const [, k, v] = m
          if (k === 'for') { const fm2 = v.match(/^(\d{4}-\d{2}-\d{2})(?:,\s*(\d{1,2}:\d{2}))?(?:,\s*(.*))?$/); if (!fm2) fail(n, `bad "for" value "${v}"`); cur!.date = fm2![1]; cur!.time = fm2![2] ? parseTime(fm2![2]).time : null; if (fm2![3]) cur!.fields.for_note = fm2![3] }
          else if (k === 'note' || k === 'notes') cur!.notes = cur!.notes ? `${cur!.notes}\n${v}` : v
          else if (k === 'status') cur!.status_from_file = v
          else if (k === 'book_by' || k === 'decide_by') { const dm = v.match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/); if (!dm) fail(n, `${k} must start with YYYY-MM-DD: "${v}"`); (cur as unknown as Record<string, string>)[k] = dm![1]; if (dm![2]) cur!.fields[`${k}_note`] = dm![2].replace(/^\((.*)\)$/, '$1') }
          else if (COLS.has(k)) (cur as unknown as Record<string, string>)[k] = v
          else cur!.fields[k] = v
        }
        continue
      }
      continue
    }
    if (section === 3) {
      if (n.kind === 'para') {
        if (/^\*\*Exception:\*\*/.test(n.text)) { notes.push({ trip: ctx.trip, seq: noteSeq++, section: 'walkin', text: n.text }); continue }
        n.text.split('·').map(s => s.trim()).filter(Boolean).forEach((name, i) => bookings.push(blank(`WK${String(i + 1).padStart(2, '0')}`, 'walkin', name)))
      }
      continue
    }
    if (section === 4) {
      if (n.kind === 'heading' && n.level === 3) { const d = parseDayHeading(n.text, ctx.year); if (!d) fail(n, `alert heading must be a weekday date: "${n.text}"`); alertDate = d!.date; alertSeq = 0; continue }
      if (n.kind === 'table') {
        if (!alertDate) fail(n, 'alert table before a day heading')
        if (n.header.map(s => s.toLowerCase()).join('|') !== 'time|alert') fail(n, 'alert table must be time|alert')
        for (const r of n.rows) { const t = (() => { try { return parseTime(r[0]) } catch (e) { return fail(n, (e as Error).message) } })(); alerts.push({ trip: ctx.trip, date: alertDate!, seq: alertSeq++, time: t.time, text: r[1] }) }
      }
      continue
    }
    if (section === 5) {
      if (n.kind === 'bullets') for (const b of n.items) notes.push({ trip: ctx.trip, seq: noteSeq++, section: 'standing', text: b })
      continue
    }
    fail(n, `unexpected section ${section}`)
  }
  if (!bookings.length && !alerts.length) throw new ImportError(file, 1, 'no bookings or alerts parsed')
  return { front: fm.data, bookings, alerts, notes }
}
```
Section-2 paragraphs between headings (there are none in Lisbon) are ignored; section 1 paragraph text is ignored.

- [ ] **Step 3: Run** → PASS. **Step 4: Commit** `feat(import): bookings, alerts and standing-notes parser`.

---

### Task 7: Routes and parked-venues parsers

**Files:**
- Create: `scripts/import/parse/routes.ts`, `scripts/import/parse/parked.ts`, `tests/import/routes.test.ts`, `tests/import/parked.test.ts`

**Interfaces:**
- Produces: `parseRoutes(file, src, ctx): { routes: RouteRow[]; notes: NoteRow[] }` (notes have `section: 'routes'`, text prefixed with the date `YYYY-MM-DD: `), `parseParked(file, src, ctx): ParkedRow[]`.

- [ ] **Step 1: Failing tests**

`tests/import/routes.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { parseRoutes } from '../../scripts/import/parse/routes'
const src = readFileSync('tests/fixtures/valle/Valle-Walking-Routes.md', 'utf8')
test('routes with fields, mode, covers and dates', () => {
  const r = parseRoutes('r.md', src, { trip: 'valle', year: 2026 })
  expect(r.routes.map(x => x.id)).toEqual(['V1', 'V2'])
  expect(r.routes[0]).toMatchObject({ date: '2026-11-02', mode: 'walking', distance_text: expect.stringMatching(/km|m/), google_url: expect.stringMatching(/^https:\/\/www\.google\.com\/maps\/dir/) })
  expect(r.routes[0].covers.length).toBeGreaterThanOrEqual(2)
  expect(r.routes[1].mode).toBe('driving')
  expect(r.notes.some(n => n.section === 'routes' && /Not walking/.test(n.text))).toBe(true)
})
test('missing url fails', () => {
  expect(() => parseRoutes('r.md', '## Monday 2 November\n\n### V9 — x\n- **distance:** 1 km\n', { trip: 'valle', year: 2026 })).toThrow(/url/)
})
```
`tests/import/parked.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { parseParked } from '../../scripts/import/parse/parked'
test('parked venues table', () => {
  const r = parseParked('p.md', readFileSync('tests/fixtures/valle/Valle-Parked-Venues.md', 'utf8'), { trip: 'valle' })
  expect(r).toHaveLength(3)
  expect(r[0]).toMatchObject({ seq: 0, name: expect.any(String), what: expect.any(String), why: expect.any(String) })
  expect(r[0].address).toBeTruthy()
})
```

- [ ] **Step 2: Implement `parse/routes.ts`**

```ts
import { parseFrontMatter, tokenize, ImportError, type Node } from '../md'
import { parseDayHeading } from './itinerary'
import type { RouteRow, NoteRow } from '../types'
export function parseRoutes(file: string, src: string, ctx: { trip: string; year: number }) {
  const fm = parseFrontMatter(src); const nodes = tokenize(fm.body, fm.bodyStartLine)
  const routes: RouteRow[] = []; const notes: NoteRow[] = []
  let date: string | null = null; let cur: RouteRow | null = null; let skipping = false; let sort = 0; let seq = 0
  const fail = (n: Node, msg: string): never => { throw new ImportError(file, n.line, msg) }
  const finish = (n: Node) => { if (cur && !cur.google_url) fail(n, `route ${cur.id} has no url`); cur = null }
  for (const n of nodes) {
    if (n.kind === 'hr') continue
    if (n.kind === 'heading' && n.level === 1) continue
    if (n.kind === 'heading' && n.level === 2) {
      finish(n); const d = parseDayHeading(n.text, ctx.year)
      if (d) { date = d.date; skipping = false } else if (/^Rough daily walking totals/i.test(n.text)) skipping = true else fail(n, `unknown ## heading "${n.text}"`)
      continue
    }
    if (skipping) continue
    if (n.kind === 'heading' && n.level === 3) {
      finish(n); const m = n.text.match(/^([A-Z]+\d+)\s+—\s+(.+)$/); if (!m) fail(n, `route heading must be "ID — title": "${n.text}"`)
      cur = { id: m![1], trip: ctx.trip, date, title: m![2].trim(), distance_text: null, mode: 'walking', covers: [], note: null, google_url: '', sort: sort++ }
      routes.push(cur); continue
    }
    if (n.kind === 'bullets') {
      if (!cur) fail(n, 'route fields before a route heading')
      for (const it of n.items) {
        const m = it.match(/^\*\*(\w+):\*\*\s*(.*)$/); if (!m) fail(n, `field bullet must be "**key:** value": "${it}"`)
        const [, k, v] = m
        if (k === 'distance') cur!.distance_text = v
        else if (k === 'covers') cur!.covers = v.split('→').map(s => s.trim()).filter(Boolean)
        else if (k === 'mode') { const mode = v.split(/\W/)[0].toLowerCase(); if (!['walking','driving','transit'].includes(mode)) fail(n, `bad mode "${v}"`); cur!.mode = mode as RouteRow['mode']; cur!.note = cur!.note ? `${cur!.note}\nmode: ${v}` : `mode: ${v}` }
        else if (k === 'note') cur!.note = cur!.note ? `${cur!.note}\n${v}` : v
        else if (k === 'url') { if (!/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/.test(v)) fail(n, `url must be a google.com/maps/dir link`); cur!.google_url = v }
        else fail(n, `unknown route field "${k}"`)
      }
      continue
    }
    if (n.kind === 'para') { if (date) notes.push({ trip: ctx.trip, seq: seq++, section: 'routes', text: `${date}: ${n.text}` }); continue }
    if (n.kind === 'table') fail(n, 'unexpected table in routes file')
  }
  if (cur) finish(nodes[nodes.length - 1])
  return { routes, notes }
}
```

- [ ] **Step 3: Implement `parse/parked.ts`**

```ts
import { tokenize, ImportError } from '../md'
import { extractPlace } from './itinerary'
import type { ParkedRow } from '../types'
export function parseParked(file: string, src: string, ctx: { trip: string }): ParkedRow[] {
  const nodes = tokenize(src); const t = nodes.find(n => n.kind === 'table')
  if (!t || t.kind !== 'table') throw new ImportError(file, 1, 'no table found')
  if (t.header.length !== 3) throw new ImportError(file, t.line, `parked table must have 3 columns, got ${t.header.length}`)
  return t.rows.map((r, seq) => {
    const { place_name, address } = extractPlace(r[0])
    return { trip: ctx.trip, seq, name: place_name ?? r[0].replace(/\*\*/g, '').trim(), what: r[1] || null, why: r[2] || null, address, lat: null, lng: null }
  })
}
```

- [ ] **Step 4: Run all import tests** → PASS. **Step 5: Commit** `feat(import): routes and parked venue parsers`.

---

### Task 8: Place extraction from Google URLs and timezones

**Files:**
- Create: `scripts/import/places.ts`, `scripts/import/timezones.ts`, `tests/import/places.test.ts`
- Modify: `scripts/import/parse/itinerary.ts` (import `extractPlace` from `../places` and delete the local copy), `scripts/import/parse/parked.ts` (same)

**Interfaces:**
- Produces:
  - `extractPlace(plan: string): { place_name: string | null; address: string | null }` (moved, unchanged behaviour)
  - `pointsFromGoogleUrl(url: string): { names: string[]; travelmode: string }` — ordered `origin, ...waypoints, destination`, URL-decoded, `+` → space.
  - `tripMeta(name: string, front: Record<string,string>): { timezone: string; country: string; country_code: string }` — from `front.timezone`/`front.country` if present, else the built-in table `{ Lisbon: ['Europe/Lisbon','Portugal','pt'], Istanbul: ['Europe/Istanbul','Türkiye','tr'], Seville: ['Europe/Madrid','Spain','es'], Barcelona: ['Europe/Madrid','Spain','es'], Egypt: ['Africa/Cairo','Egypt','eg'], Cairo: ['Africa/Cairo','Egypt','eg'] }`; throws if unknown.

- [ ] **Step 1: Failing tests**

```ts
import { pointsFromGoogleUrl, extractPlace } from '../../scripts/import/places'
import { tripMeta } from '../../scripts/import/timezones'
test('points in order from a dir url', () => {
  const u = 'https://www.google.com/maps/dir/?api=1&origin=Time+Out+Market+Lisboa&destination=Miradouro+de+Santa+Catarina%2C+Lisboa&waypoints=R.+da+Bica+de+Duarte+Belo%2C+Lisboa%7CManteigaria%2C+Rua+do+Loreto+2%2C+Lisboa&travelmode=walking'
  expect(pointsFromGoogleUrl(u)).toEqual({ names: ['Time Out Market Lisboa', 'R. da Bica de Duarte Belo, Lisboa', 'Manteigaria, Rua do Loreto 2, Lisboa', 'Miradouro de Santa Catarina, Lisboa'], travelmode: 'walking' })
})
test('url without waypoints', () => {
  expect(pointsFromGoogleUrl('https://www.google.com/maps/dir/?api=1&origin=A&destination=B&travelmode=driving').names).toEqual(['A', 'B'])
})
test('extractPlace cases', () => {
  expect(extractPlace('**Senzi**, R. da Moeda 12')).toEqual({ place_name: 'Senzi', address: 'R. da Moeda 12' })
  expect(extractPlace('**Time Out Market**')).toEqual({ place_name: 'Time Out Market', address: null })
  expect(extractPlace('Lunch: **Miolo**, R. de Belém 36')).toEqual({ place_name: 'Miolo', address: 'R. de Belém 36' })
  expect(extractPlace('**Mesa de Frades** — fado show with dinner — **BOOKED**')).toEqual({ place_name: 'Mesa de Frades', address: null })
  expect(extractPlace('Walk to the meeting point')).toEqual({ place_name: null, address: null })
  expect(extractPlace('**Tell the guide what to skip**')).toEqual({ place_name: null, address: null })
})
test('tripMeta', () => {
  expect(tripMeta('Lisbon', {})).toEqual({ timezone: 'Europe/Lisbon', country: 'Portugal', country_code: 'pt' })
  expect(tripMeta('Valle', { timezone: 'Europe/Rome', country: 'Italy' })).toEqual({ timezone: 'Europe/Rome', country: 'Italy', country_code: 'it' })
  expect(() => tripMeta('Nowhere', {})).toThrow(/timezone/)
})
```

- [ ] **Step 2: Implement**

`scripts/import/places.ts`: move `extractPlace` here verbatim from Task 5, plus:
```ts
export function pointsFromGoogleUrl(url: string) {
  const u = new URL(url); const p = u.searchParams
  const dec = (s: string | null) => (s ?? '').replace(/\+/g, ' ').trim()
  const origin = dec(p.get('origin')), dest = dec(p.get('destination'))
  if (!origin || !dest) throw new Error(`dir url missing origin/destination: ${url}`)
  const wps = p.get('waypoints') ? dec(p.get('waypoints')).split('|').map(s => s.trim()).filter(Boolean) : []
  return { names: [origin, ...wps, dest], travelmode: p.get('travelmode') ?? 'walking' }
}
```
(`URLSearchParams` already percent-decodes `%7C` to `|` and `%2C` to `,`.)

`scripts/import/timezones.ts`:
```ts
const TABLE: Record<string, [string, string, string]> = {
  Lisbon: ['Europe/Lisbon', 'Portugal', 'pt'], Istanbul: ['Europe/Istanbul', 'Türkiye', 'tr'],
  Seville: ['Europe/Madrid', 'Spain', 'es'], Barcelona: ['Europe/Madrid', 'Spain', 'es'],
  Egypt: ['Africa/Cairo', 'Egypt', 'eg'], Cairo: ['Africa/Cairo', 'Egypt', 'eg'],
}
const CODES: Record<string, string> = { Italy: 'it', Portugal: 'pt', Spain: 'es', 'Türkiye': 'tr', Turkey: 'tr', Egypt: 'eg', France: 'fr', Greece: 'gr' }
export function tripMeta(name: string, front: Record<string, string>) {
  if (front.timezone && front.country) { const cc = front.country_code ?? CODES[front.country]; if (!cc) throw new Error(`unknown country_code for ${front.country}; add country_code to front matter`); return { timezone: front.timezone, country: front.country, country_code: cc } }
  const t = TABLE[name]; if (!t) throw new Error(`no timezone known for trip "${name}"; add timezone: and country: to the bookings front matter`)
  return { timezone: t[0], country: t[1], country_code: t[2] }
}
```

- [ ] **Step 3: Run all tests** → PASS. **Step 4: Commit** `feat(import): google url points, place extraction module, trip metadata`.

---

### Task 9: Geocoding with cache and leg building with polylines

**Files:**
- Create: `scripts/import/env.ts`, `scripts/import/geocode.ts`, `scripts/import/legs.ts`, `tests/import/legs.test.ts`, `tests/import/geocode.test.ts`

**Interfaces:**
- Consumes: `pointsFromGoogleUrl`, `RouteRow`, `LegRow`, `ItemRow`, `ParkedRow`.
- Produces:
  - `loadEnv(): { supabaseUrl, serviceKey, ownerId, googleServerKey, protomapsBuildUrl }` (throws listing missing names).
  - `type Geocoder = (query: string) => Promise<{ lat: number; lng: number; formatted: string; place_id: string } | null>`
  - `makeGoogleGeocoder(key: string, region: string, fetchImpl = fetch): Geocoder`
  - `makeCachedGeocoder(inner: Geocoder, cache: { get(q): Promise<…|null>; set(q, v): Promise<void> }): Geocoder`
  - `supabaseCache(client, ownerId)` implementing that cache over `geocode_cache`.
  - `geocodeContent(content: CityContent, geocode: Geocoder, cityHint: string): Promise<{ misses: string[] }>` — fills `lat/lng` on items with `place_name`, on parked venues, and on legs' endpoints. Query is `${place_name}${address ? ', ' + address : ''}, ${cityHint}`; URL point names are used verbatim (they already include the city).
  - `splitLegs(route: RouteRow): LegRow[]` — consecutive pairs from `pointsFromGoogleUrl(route.google_url).names`, `google_url` per leg = `https://www.google.com/maps/dir/?api=1&origin=<enc>&destination=<enc>&travelmode=<route.mode>`.
  - `fetchPolyline(key: string, leg: LegRow, mode: RouteRow['mode'], fetchImpl = fetch): Promise<{ polyline: string; distance_m: number; duration_s: number } | null>` via Routes API `computeRoutes`.

- [ ] **Step 1: Failing tests**

`tests/import/legs.test.ts`:
```ts
import { splitLegs, fetchPolyline } from '../../scripts/import/legs'
import type { RouteRow } from '../../scripts/import/types'
const route: RouteRow = { id: 'W3', trip: 'lisbon', date: '2026-09-30', title: 'x', distance_text: null, mode: 'walking', covers: [], note: null, sort: 0,
  google_url: 'https://www.google.com/maps/dir/?api=1&origin=Miradouro+de+Santa+Catarina%2C+Lisboa&destination=Mesa+de+Frades%2C+R.+dos+Rem%C3%A9dios+139A%2C+Lisboa&waypoints=Pra%C3%A7a+do+Com%C3%A9rcio%2C+Lisboa&travelmode=walking' }
test('splitLegs makes N-1 hops with single-destination deep links', () => {
  const legs = splitLegs(route)
  expect(legs).toHaveLength(2)
  expect(legs[0]).toMatchObject({ trip: 'lisbon', route_id: 'W3', seq: 0, from_name: 'Miradouro de Santa Catarina, Lisboa', to_name: 'Praça do Comércio, Lisboa' })
  expect(legs[1].to_name).toBe('Mesa de Frades, R. dos Remédios 139A, Lisboa')
  const u = new URL(legs[0].google_url)
  expect(u.searchParams.get('origin')).toBe('Miradouro de Santa Catarina, Lisboa')
  expect(u.searchParams.get('destination')).toBe('Praça do Comércio, Lisboa')
  expect(u.searchParams.get('travelmode')).toBe('walking')
  expect(u.searchParams.get('waypoints')).toBeNull()
})
test('fetchPolyline posts to Routes API with WALK and reads the first route', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ routes: [{ polyline: { encodedPolyline: 'abc' }, distanceMeters: 1200, duration: '900s' }] })) }) as typeof fetch
  const leg = { ...splitLegs(route)[0], from_lat: 38.71, from_lng: -9.15, to_lat: 38.707, to_lng: -9.136 }
  const r = await fetchPolyline('KEY', leg, 'walking', fetchImpl)
  expect(r).toEqual({ polyline: 'abc', distance_m: 1200, duration_s: 900 })
  expect(calls[0].url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes')
  const body = JSON.parse(calls[0].init.body as string)
  expect(body.travelMode).toBe('WALK')
  expect((calls[0].init.headers as Record<string, string>)['X-Goog-FieldMask']).toContain('routes.polyline.encodedPolyline')
})
test('fetchPolyline returns null when endpoints are not geocoded', async () => {
  expect(await fetchPolyline('KEY', splitLegs(route)[0], 'walking')).toBeNull()
})
```

`tests/import/geocode.test.ts`:
```ts
import { makeGoogleGeocoder, makeCachedGeocoder, geocodeContent } from '../../scripts/import/geocode'
import type { CityContent } from '../../scripts/import/types'
test('google geocoder parses the first result and returns null on ZERO_RESULTS', async () => {
  const fetchImpl = (async (url: string) => new Response(JSON.stringify(url.includes('Nowhere') ? { status: 'ZERO_RESULTS', results: [] } :
    { status: 'OK', results: [{ geometry: { location: { lat: 1.5, lng: 2.5 } }, formatted_address: 'F', place_id: 'P' }] }))) as typeof fetch
  const g = makeGoogleGeocoder('K', 'pt', fetchImpl)
  expect(await g('Senzi, Lisboa')).toEqual({ lat: 1.5, lng: 2.5, formatted: 'F', place_id: 'P' })
  expect(await g('Nowhere')).toBeNull()
})
test('cached geocoder hits cache first and writes on miss', async () => {
  const store = new Map<string, { lat: number; lng: number; formatted: string; place_id: string }>()
  let innerCalls = 0
  const inner = async (q: string) => { innerCalls++; return { lat: 1, lng: 2, formatted: q, place_id: 'x' } }
  const g = makeCachedGeocoder(inner, { get: async q => store.get(q) ?? null, set: async (q, v) => { store.set(q, v) } })
  await g('A'); await g('A'); await g('B')
  expect(innerCalls).toBe(2); expect(store.size).toBe(2)
})
test('geocodeContent fills items, parked and leg endpoints and reports misses', async () => {
  const g = async (q: string) => (q.startsWith('Miss') ? null : { lat: 10, lng: 20, formatted: q, place_id: 'p' })
  const c = { trip: { slug: 'v' }, items: [{ kind: 'stop', place_name: 'Caffè Nord', address: 'Via Roma 12', lat: null, lng: null }, { kind: 'stop', place_name: 'Miss Me', address: null, lat: null, lng: null }, { kind: 'note', place_name: null }],
    parked: [{ name: 'Castle', address: null, lat: null, lng: null }], legs: [{ from_name: 'A, Valle', to_name: 'Miss B', from_lat: null, from_lng: null, to_lat: null, to_lng: null }] } as unknown as CityContent
  const r = await geocodeContent(c, g, 'Valle')
  expect(c.items[0]).toMatchObject({ lat: 10, lng: 20 }); expect(c.parked[0].lat).toBe(10)
  expect(c.legs[0]).toMatchObject({ from_lat: 10, to_lat: null })
  expect(r.misses).toEqual(['Miss Me, Valle', 'Miss B'])
})
```

- [ ] **Step 2: Implement**

`scripts/import/env.ts`:
```ts
import 'dotenv/config'
export function loadEnv() {
  const need = ['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OWNER_USER_ID', 'GOOGLE_SERVER_KEY', 'PROTOMAPS_BUILD_URL'] as const
  const missing = need.filter(k => !process.env[k]); if (missing.length) throw new Error(`.env missing: ${missing.join(', ')}`)
  return { supabaseUrl: process.env.VITE_SUPABASE_URL!, serviceKey: process.env.SUPABASE_SERVICE_KEY!, ownerId: process.env.OWNER_USER_ID!, googleServerKey: process.env.GOOGLE_SERVER_KEY!, protomapsBuildUrl: process.env.PROTOMAPS_BUILD_URL! }
}
```

`scripts/import/geocode.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CityContent } from './types'
export interface GeoPoint { lat: number; lng: number; formatted: string; place_id: string }
export type Geocoder = (query: string) => Promise<GeoPoint | null>

export function makeGoogleGeocoder(key: string, region: string, fetchImpl: typeof fetch = fetch): Geocoder {
  return async q => {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=${region}&key=${key}`
    const res = await fetchImpl(url); const j = await res.json() as { status: string; results: { geometry: { location: { lat: number; lng: number } }; formatted_address: string; place_id: string }[]; error_message?: string }
    if (j.status === 'ZERO_RESULTS') return null
    if (j.status !== 'OK') throw new Error(`geocode ${j.status}: ${j.error_message ?? ''} for "${q}"`)
    const r = j.results[0]; return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, formatted: r.formatted_address, place_id: r.place_id }
  }
}
export function makeCachedGeocoder(inner: Geocoder, cache: { get(q: string): Promise<GeoPoint | null>; set(q: string, v: GeoPoint): Promise<void> }): Geocoder {
  return async q => { const hit = await cache.get(q); if (hit) return hit; const v = await inner(q); if (v) await cache.set(q, v); return v }
}
export function supabaseCache(client: SupabaseClient, ownerId: string) {
  return {
    async get(q: string) { const { data } = await client.from('geocode_cache').select('lat,lng,formatted_address,place_id').eq('query', q).maybeSingle(); return data && data.lat != null ? { lat: data.lat, lng: data.lng, formatted: data.formatted_address, place_id: data.place_id } : null },
    async set(q: string, v: GeoPoint) { await client.from('geocode_cache').upsert({ query: q, owner: ownerId, lat: v.lat, lng: v.lng, formatted_address: v.formatted, place_id: v.place_id }) },
  }
}
export async function geocodeContent(c: CityContent, geocode: Geocoder, cityHint: string) {
  const misses: string[] = []
  const lookup = async (q: string) => { const r = await geocode(q); if (!r) misses.push(q); return r }
  for (const it of c.items) if (it.place_name && it.lat == null) { const r = await lookup(`${it.place_name}${it.address ? ', ' + it.address : ''}, ${cityHint}`); if (r) { it.lat = r.lat; it.lng = r.lng } }
  for (const p of c.parked) if (p.lat == null) { const r = await lookup(`${p.name}${p.address ? ', ' + p.address : ''}, ${cityHint}`); if (r) { p.lat = r.lat; p.lng = r.lng } }
  for (const l of c.legs) {
    if (l.from_lat == null) { const r = await lookup(l.from_name); if (r) { l.from_lat = r.lat; l.from_lng = r.lng } }
    if (l.to_lat == null) { const r = await lookup(l.to_name); if (r) { l.to_lat = r.lat; l.to_lng = r.lng } }
  }
  return { misses: [...new Set(misses)] }
}
```
`geocodeContent` dedups misses; because the cached geocoder never caches nulls, a repeated miss calls Google twice, which is acceptable at this volume.

`scripts/import/legs.ts`:
```ts
import { pointsFromGoogleUrl } from './places'
import type { RouteRow, LegRow } from './types'
export function splitLegs(route: RouteRow): LegRow[] {
  const { names } = pointsFromGoogleUrl(route.google_url); const legs: LegRow[] = []
  for (let i = 0; i < names.length - 1; i++) {
    const p = new URLSearchParams({ api: '1', origin: names[i], destination: names[i + 1], travelmode: route.mode })
    legs.push({ trip: route.trip, route_id: route.id, seq: i, from_name: names[i], to_name: names[i + 1], from_lat: null, from_lng: null, to_lat: null, to_lng: null, google_url: `https://www.google.com/maps/dir/?${p.toString()}`, polyline: null, distance_m: null, duration_s: null })
  }
  return legs
}
const MODE = { walking: 'WALK', driving: 'DRIVE', transit: 'TRANSIT' } as const
export async function fetchPolyline(key: string, leg: LegRow, mode: RouteRow['mode'], fetchImpl: typeof fetch = fetch) {
  if (leg.from_lat == null || leg.to_lat == null) return null
  const body = { origin: { location: { latLng: { latitude: leg.from_lat, longitude: leg.from_lng } } }, destination: { location: { latLng: { latitude: leg.to_lat, longitude: leg.to_lng } } }, travelMode: MODE[mode], polylineQuality: 'HIGH_QUALITY' }
  const res = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration' }, body: JSON.stringify(body) })
  const j = await res.json() as { routes?: { polyline: { encodedPolyline: string }; distanceMeters: number; duration: string }[]; error?: { message: string } }
  if (j.error) throw new Error(`routes api: ${j.error.message}`)
  const r = j.routes?.[0]; if (!r) return null
  return { polyline: r.polyline.encodedPolyline, distance_m: r.distanceMeters, duration_s: parseInt(r.duration, 10) }
}
```

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit** `feat(import): geocoding with supabase cache, leg splitting, routes polylines`.

---

### Task 10: Offline map areas

**Files:**
- Create: `scripts/import/offline.ts`, `tests/import/offline.test.ts`

**Interfaces:**
- Produces:
  - `clusterPoints(points: { lat: number; lng: number }[], radiusKm = 1.5): { lat: number; lng: number }[][]` — greedy single-linkage: a point joins the first cluster containing a member within `radiusKm` (haversine); otherwise starts a new cluster.
  - `bboxOf(cluster, padM = 400): { min_lng, min_lat, max_lng, max_lat }`
  - `buildOfflineAreas(trip: string, content: CityContent, opts: { buildUrl: string; outDir: string; maxzoom?: number; exec?: (cmd: string, args: string[]) => Promise<void>; upload?: (localPath: string, storagePath: string) => Promise<number> }): Promise<OfflineAreaRow[]>` — runs `pmtiles extract <buildUrl> <outDir>/<trip>-<seq>.pmtiles --bbox=<min_lng>,<min_lat>,<max_lng>,<max_lat> --maxzoom=16`, uploads to bucket `maps` at `<trip>/<seq>.pmtiles`, returns rows with `size_bytes` from upload. Area name = nearest item `place_name` to the cluster centroid, else `Area N`.

- [ ] **Step 1: Failing tests**

```ts
import { clusterPoints, bboxOf, buildOfflineAreas } from '../../scripts/import/offline'
import type { CityContent } from '../../scripts/import/types'
test('clusters points by distance', () => {
  const c = clusterPoints([{ lat: 38.71, lng: -9.14 }, { lat: 38.712, lng: -9.142 }, { lat: 38.79, lng: -9.39 }, { lat: 38.69, lng: -9.20 }])
  expect(c).toHaveLength(3); expect(c[0]).toHaveLength(2)
})
test('bbox pads by metres', () => {
  const b = bboxOf([{ lat: 38.71, lng: -9.14 }], 400)
  expect(b.max_lat - 38.71).toBeCloseTo(0.0036, 3); expect(b.min_lng).toBeLessThan(-9.14)
})
test('buildOfflineAreas runs pmtiles per cluster and uploads', async () => {
  const cmds: string[][] = []; const ups: string[] = []
  const content = { items: [{ kind: 'stop', place_name: 'Centre', lat: 38.71, lng: -9.14 }, { kind: 'stop', place_name: 'Far', lat: 38.79, lng: -9.39 }], parked: [], legs: [] } as unknown as CityContent
  const rows = await buildOfflineAreas('valle', content, { buildUrl: 'https://build.protomaps.com/20260901.pmtiles', outDir: '/tmp/x',
    exec: async (cmd, args) => { cmds.push([cmd, ...args]) }, upload: async () => 1234 })
  expect(rows).toHaveLength(2); expect(rows[0]).toMatchObject({ trip: 'valle', seq: 0, name: 'Centre', pmtiles_path: 'valle/0.pmtiles', size_bytes: 1234 })
  expect(cmds[0][0]).toBe('pmtiles'); expect(cmds[0]).toContain('extract'); expect(cmds[0].some(a => a.startsWith('--bbox='))).toBe(true); expect(cmds[0]).toContain('--maxzoom=16')
})
```

- [ ] **Step 2: Implement**

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, mkdir } from 'node:fs/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CityContent, OfflineAreaRow } from './types'
type P = { lat: number; lng: number }
const R = 6371
export function haversineKm(a: P, b: P) { const d = Math.PI / 180; const dl = (b.lat - a.lat) * d, dg = (b.lng - a.lng) * d; const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)) }
export function clusterPoints(points: P[], radiusKm = 1.5): P[][] {
  const clusters: P[][] = []
  for (const p of points) { const c = clusters.find(cl => cl.some(q => haversineKm(p, q) <= radiusKm)); if (c) c.push(p); else clusters.push([p]) }
  return clusters
}
export function bboxOf(cluster: P[], padM = 400) {
  const lats = cluster.map(p => p.lat), lngs = cluster.map(p => p.lng)
  const dLat = padM / 111_320; const midLat = (Math.min(...lats) + Math.max(...lats)) / 2; const dLng = padM / (111_320 * Math.cos(midLat * Math.PI / 180))
  return { min_lng: Math.min(...lngs) - dLng, min_lat: Math.min(...lats) - dLat, max_lng: Math.max(...lngs) + dLng, max_lat: Math.max(...lats) + dLat }
}
const pexec = promisify(execFile)
export async function buildOfflineAreas(trip: string, c: CityContent, opts: { buildUrl: string; outDir: string; maxzoom?: number; exec?: (cmd: string, args: string[]) => Promise<void>; upload?: (local: string, remote: string) => Promise<number> }): Promise<OfflineAreaRow[]> {
  const exec = opts.exec ?? (async (cmd, args) => { await pexec(cmd, args) })
  if (!opts.upload) throw new Error('upload required')
  const pts: (P & { name: string | null })[] = []
  for (const it of c.items) if (it.lat != null && it.lng != null) pts.push({ lat: it.lat, lng: it.lng, name: it.place_name })
  for (const p of c.parked) if (p.lat != null && p.lng != null) pts.push({ lat: p.lat, lng: p.lng, name: p.name })
  for (const l of c.legs) { if (l.from_lat != null) pts.push({ lat: l.from_lat, lng: l.from_lng!, name: null }); if (l.to_lat != null) pts.push({ lat: l.to_lat, lng: l.to_lng!, name: null }) }
  await mkdir(opts.outDir, { recursive: true })
  const rows: OfflineAreaRow[] = []
  clusterPoints(pts).forEach((cl, seq) => rows.push({ trip, seq, name: '', ...bboxOf(cl), pmtiles_path: `${trip}/${seq}.pmtiles`, size_bytes: 0, __cl: cl } as OfflineAreaRow & { __cl: typeof cl }))
  for (const row of rows as (OfflineAreaRow & { __cl: (P & { name: string | null })[] })[]) {
    const cl = row.__cl; const cx = cl.reduce((s, p) => s + p.lat, 0) / cl.length, cy = cl.reduce((s, p) => s + p.lng, 0) / cl.length
    const named = cl.filter(p => p.name).sort((a, b) => haversineKm(a, { lat: cx, lng: cy }) - haversineKm(b, { lat: cx, lng: cy }))
    row.name = named[0]?.name ?? `Area ${row.seq + 1}`
    const local = `${opts.outDir}/${trip}-${row.seq}.pmtiles`
    await exec('pmtiles', ['extract', opts.buildUrl, local, `--bbox=${row.min_lng},${row.min_lat},${row.max_lng},${row.max_lat}`, `--maxzoom=${opts.maxzoom ?? 16}`])
    row.size_bytes = await opts.upload(local, row.pmtiles_path)
    delete (row as Partial<typeof row>).__cl
  }
  return rows
}
export function supabaseUploader(client: SupabaseClient) {
  return async (local: string, remote: string) => {
    const buf = await readFile(local).catch(() => Buffer.alloc(0))
    const { error } = await client.storage.from('maps').upload(remote, buf, { upsert: true, contentType: 'application/octet-stream' })
    if (error) throw new Error(`upload ${remote}: ${error.message}`)
    return buf.length
  }
}
```
`pmtiles extract` from the public build is sized per bbox; Lisbon centre at z16 is expected in the 10–30 MB range. If a single area exceeds 100 MB, lower `--maxzoom` to 15 for that city via a `--maxzoom` CLI flag (Task 11).

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit** `feat(import): offline area clustering and pmtiles extraction`.

---

### Task 11: Writer, CLI, report, real Lisbon import

**Files:**
- Create: `scripts/import/write.ts`, `scripts/import/report.ts`, `scripts/import/cli.ts`, `tests/import/write.test.ts`, `tests/import/lisbon.test.ts`
- Modify: `README.md`

**Interfaces:**
- Produces:
  - `assembleCity(dir: string, slug: string): Promise<{ content: CityContent; front: Record<string,string>; cityHint: string; year: number }>` — finds the four files by suffix (`*Itinerary-Full.md`, `*Bookings-Reminders.md` required; `*Walking-Routes.md`, `*Parked-Venues.md` optional), parses in order, builds `TripRow` from front matter (`trip`, `dates: A to B`, `base`) + `tripMeta`, splits legs, links each `route_link` item to the route with the same `google_url` (sets `items.route_id`).
  - `rewriteCity(client, ownerId, content: CityContent): Promise<Record<string, number>>` — deletes rows for `content.trip.slug` from `offline_areas, standing_notes, parked_venues, alerts, legs, routes, bookings, items, days, trips` in that order, then inserts trip, days, items (parents before children), bookings, routes, legs, alerts, parked, notes, areas with `owner: ownerId`; returns counts. Uses a Postgres function `import_city(payload jsonb)` for atomicity.
  - `printReport(counts, misses, warnings, url)`.
  - CLI: `npm run import -- <city> [--dry-run] [--skip-maps] [--maxzoom N]`.

- [ ] **Step 1: Atomic write function migration**

`supabase/migrations/20260915000004_import_fn.sql`:
```sql
create or replace function import_city(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_slug text := p->'trip'->>'slug'; counts jsonb := '{}';
begin
  delete from offline_areas where trip = v_slug; delete from standing_notes where trip = v_slug; delete from parked_venues where trip = v_slug;
  delete from alerts where trip = v_slug; delete from legs where trip = v_slug; delete from routes where trip = v_slug;
  delete from bookings where trip = v_slug; delete from items where trip = v_slug; delete from days where trip = v_slug; delete from trips where slug = v_slug;
  insert into trips select * from jsonb_populate_record(null::trips, p->'trip');
  insert into days select * from jsonb_populate_recordset(null::days, p->'days');
  insert into items select * from jsonb_populate_recordset(null::items, p->'items') order by (parent_item is not null), sort;
  insert into bookings select * from jsonb_populate_recordset(null::bookings, p->'bookings');
  insert into routes select * from jsonb_populate_recordset(null::routes, p->'routes');
  insert into legs select * from jsonb_populate_recordset(null::legs, p->'legs');
  insert into alerts select * from jsonb_populate_recordset(null::alerts, p->'alerts');
  insert into parked_venues select * from jsonb_populate_recordset(null::parked_venues, p->'parked');
  insert into standing_notes select * from jsonb_populate_recordset(null::standing_notes, p->'notes');
  insert into offline_areas select * from jsonb_populate_recordset(null::offline_areas, p->'areas');
  select jsonb_object_agg(k, v) into counts from (values
    ('days', jsonb_array_length(p->'days')), ('items', jsonb_array_length(p->'items')), ('bookings', jsonb_array_length(p->'bookings')),
    ('routes', jsonb_array_length(p->'routes')), ('legs', jsonb_array_length(p->'legs')), ('alerts', jsonb_array_length(p->'alerts')),
    ('parked', jsonb_array_length(p->'parked')), ('notes', jsonb_array_length(p->'notes')), ('areas', jsonb_array_length(p->'areas'))) t(k, v);
  return counts;
end $$;
revoke all on function import_city(jsonb) from public, anon, authenticated;
```
`supabase db push`. The function is callable only with the service key. Every row object passed must carry `owner`; `write.ts` stamps it.

- [ ] **Step 2: Failing tests**

`tests/import/write.test.ts`:
```ts
import { assembleCity, stampOwner } from '../../scripts/import/write'
test('assembleCity parses the Valle fixture into a CityContent', async () => {
  const { content, cityHint, year } = await assembleCity('tests/fixtures/valle', 'valle')
  expect(cityHint).toBe('Valle'); expect(year).toBe(2026)
  expect(content.trip).toMatchObject({ slug: 'valle', name: 'Valle', start_date: '2026-11-01', end_date: '2026-11-03', timezone: 'Europe/Rome', country_code: 'it' })
  expect(content.days.length).toBeGreaterThanOrEqual(2); expect(content.legs.length).toBeGreaterThanOrEqual(3)
  const rl = content.items.find(i => i.kind === 'route_link')!; expect(rl.route_id).toBe('V1')
})
test('stampOwner sets owner on every row', async () => {
  const { content } = await assembleCity('tests/fixtures/valle', 'valle')
  const p = stampOwner(content, 'uuid-1') as Record<string, unknown>
  expect((p.trip as { owner: string }).owner).toBe('uuid-1')
  expect((p.items as { owner: string }[]).every(r => r.owner === 'uuid-1')).toBe(true)
  expect(Object.keys(p).sort()).toEqual(['alerts','areas','bookings','days','items','legs','notes','parked','routes','trip'])
})
```
(Fixture `V1` url must equal the route_link url in the itinerary fixture.)

`tests/import/lisbon.test.ts` (skips unless the private files exist):
```ts
import { existsSync } from 'node:fs'
import { assembleCity } from '../../scripts/import/write'
const dir = 'content/lisbon'
const t = existsSync(dir) ? test : test.skip
t('real Lisbon files parse without error', async () => {
  const { content } = await assembleCity(dir, 'lisbon')
  expect(content.days.map(d => d.date)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
  expect(content.bookings.filter(b => b.kind === 'booked')).toHaveLength(4)
  expect(content.bookings.filter(b => b.kind === 'todo')).toHaveLength(7)
  expect(content.routes.map(r => r.id)).toEqual(['W1', 'W2', 'W3', 'T1', 'T2', 'T3', 'T4', 'T5', 'F1', 'S1', 'S2', 'S3'])
  expect(content.legs.filter(l => l.route_id === 'W2')).toHaveLength(10)
  expect(content.alerts.length).toBeGreaterThan(30)
  expect(content.items.filter(i => i.kind === 'option')).toHaveLength(6)
})
```

- [ ] **Step 3: Implement `write.ts`**

```ts
import { readdir, readFile } from 'node:fs/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseItinerary } from './parse/itinerary'
import { parseBookings } from './parse/bookings'
import { parseRoutes } from './parse/routes'
import { parseParked } from './parse/parked'
import { splitLegs } from './legs'
import { tripMeta } from './timezones'
import { ImportError } from './md'
import type { CityContent, TripRow } from './types'

async function pick(dir: string, suffix: string, required: boolean) {
  const f = (await readdir(dir)).find(n => n.endsWith(suffix))
  if (!f && required) throw new ImportError(dir, 0, `no file ending in ${suffix}`)
  return f ? { name: f, src: await readFile(`${dir}/${f}`, 'utf8') } : null
}
export async function assembleCity(dir: string, slug: string) {
  const bk = (await pick(dir, 'Bookings-Reminders.md', true))!
  const fmDates = bk.src.match(/^dates:\s*(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/m); if (!fmDates) throw new ImportError(bk.name, 1, 'front matter needs "dates: YYYY-MM-DD to YYYY-MM-DD"')
  const year = +fmDates[1].slice(0, 4)
  const ctx = { trip: slug, year }
  const b = parseBookings(bk.name, bk.src, ctx)
  const name = b.front.trip; if (!name) throw new ImportError(bk.name, 1, 'front matter needs "trip:"')
  const meta = tripMeta(name, b.front)
  const it = (await pick(dir, 'Itinerary-Full.md', true))!
  const i = parseItinerary(it.name, it.src, ctx)
  const rt = await pick(dir, 'Walking-Routes.md', false)
  const r = rt ? parseRoutes(rt.name, rt.src, ctx) : { routes: [], notes: [] }
  const pk = await pick(dir, 'Parked-Venues.md', false)
  const parked = pk ? parseParked(pk.name, pk.src, ctx) : []
  const legs = r.routes.flatMap(splitLegs)
  for (const item of i.items) if (item.kind === 'route_link' && item.url) item.route_id = r.routes.find(x => x.google_url === item.url)?.id ?? null
  const notes = [...b.notes, ...r.notes].map((n, seq) => ({ ...n, seq }))
  const trip: TripRow = { slug, name, country: meta.country, country_code: meta.country_code, start_date: fmDates[1], end_date: fmDates[2], base: b.front.base ?? null, timezone: meta.timezone, intro: i.intro, sort: 0 }
  const content: CityContent = { trip, days: i.days, items: i.items, bookings: b.bookings, routes: r.routes, legs, alerts: b.alerts, parked, notes, areas: [] }
  return { content, front: b.front, cityHint: name, year }
}
export function stampOwner(c: CityContent, owner: string) {
  const s = <T extends object>(rows: T[]) => rows.map(r => ({ ...r, owner }))
  return { trip: { ...c.trip, owner }, days: s(c.days), items: s(c.items), bookings: s(c.bookings), routes: s(c.routes), legs: s(c.legs), alerts: s(c.alerts), parked: s(c.parked), notes: s(c.notes), areas: s(c.areas) }
}
export async function rewriteCity(client: SupabaseClient, ownerId: string, c: CityContent) {
  const { data, error } = await client.rpc('import_city', { p: stampOwner(c, ownerId) })
  if (error) throw new Error(`import_city: ${error.message}`)
  return data as Record<string, number>
}
```

- [ ] **Step 4: Implement `report.ts` and `cli.ts`**

`scripts/import/report.ts`:
```ts
export function printReport(args: { slug: string; counts: Record<string, number>; misses: string[]; warnings: string[]; dryRun: boolean; url: string }) {
  const { slug, counts, misses, warnings, dryRun, url } = args
  console.log(`\n${dryRun ? 'DRY RUN — nothing written' : 'Imported'}: ${slug}`)
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(10)} ${v}`)
  if (misses.length) { console.log(`\nGeocode misses (${misses.length}) — fix the text or add an address:`); misses.forEach(m => console.log(`  - ${m}`)) }
  if (warnings.length) { console.log(`\nWarnings:`); warnings.forEach(w => console.log(`  - ${w}`)) }
  console.log(`\nOpen: ${url}`)
}
```

`scripts/import/cli.ts`:
```ts
import { createClient } from '@supabase/supabase-js'
import { loadEnv } from './env'
import { assembleCity, rewriteCity } from './write'
import { makeGoogleGeocoder, makeCachedGeocoder, supabaseCache, geocodeContent } from './geocode'
import { fetchPolyline } from './legs'
import { buildOfflineAreas, supabaseUploader } from './offline'
import { printReport } from './report'
import { ImportError } from './md'

async function main() {
  const [slug, ...flags] = process.argv.slice(2)
  if (!slug) { console.error('usage: npm run import -- <city> [--dry-run] [--skip-maps] [--maxzoom N]'); process.exit(2) }
  const dryRun = flags.includes('--dry-run'); const skipMaps = flags.includes('--skip-maps')
  const mz = flags.indexOf('--maxzoom'); const maxzoom = mz >= 0 ? +flags[mz + 1] : 16
  const env = loadEnv()
  const client = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } })
  const { content, cityHint } = await assembleCity(`content/${slug}`, slug)
  const warnings: string[] = []
  const geocoder = makeCachedGeocoder(makeGoogleGeocoder(env.googleServerKey, content.trip.country_code), supabaseCache(client, env.ownerId))
  const { misses } = await geocodeContent(content, geocoder, cityHint)
  for (const leg of content.legs) {
    const mode = content.routes.find(r => r.id === leg.route_id)!.mode
    try { const p = await fetchPolyline(env.googleServerKey, leg, mode); if (p) Object.assign(leg, p); else warnings.push(`no polyline for ${leg.route_id}#${leg.seq} (${leg.from_name} → ${leg.to_name})`) }
    catch (e) { warnings.push(`polyline ${leg.route_id}#${leg.seq}: ${(e as Error).message}`) }
  }
  if (!skipMaps && !dryRun) content.areas = await buildOfflineAreas(slug, content, { buildUrl: env.protomapsBuildUrl, outDir: `.cache/pmtiles`, maxzoom, upload: supabaseUploader(client) })
  else if (skipMaps) warnings.push('offline maps skipped (--skip-maps)')
  const counts = dryRun
    ? Object.fromEntries(Object.entries(content).filter(([k]) => k !== 'trip').map(([k, v]) => [k, (v as unknown[]).length]))
    : await rewriteCity(client, env.ownerId, content)
  printReport({ slug, counts, misses, warnings, dryRun, url: `https://mickydoit.github.io/europe-guide/?trip=${slug}` })
}
main().catch(e => { if (e instanceof ImportError) console.error(`\n✗ ${e.message}`); else console.error(e); process.exit(1) })
```
Add `.cache/` to `.gitignore`.

- [ ] **Step 5: Run the tests** → PASS including the Lisbon test (files are present locally). If the Lisbon test fails on a shape the fixtures did not cover, fix the parser, add the shape to the Valle fixture, and re-run. Do not edit the Lisbon files to fit the parser unless the file is genuinely inconsistent; if so, report the exact line to the owner.

- [ ] **Step 6: Google server key and quotas**

In Google Cloud console (or `brew install google-cloud-sdk && gcloud auth login`), in the owner's project: enable **Geocoding API**, **Routes API**, **Places API (New)**. Create key `europe-guide-server`: application restriction None, API restriction Geocoding + Routes. Create key `europe-guide-browser`: HTTP referrers `https://mickydoit.github.io/europe-guide/*` and `http://localhost:5173/*`, API restriction Routes + Places (New). Quotas (APIs & Services → Quotas): Geocoding 500/day, Routes computeRoutes 1,000/day, Places Nearby Search 300/day, Places Details 300/day, Places Photos 500/day. Billing → Budgets: budget of USD 10 with alerts at 50% and 90% to the owner's email. Put the server key in `.env` as `GOOGLE_SERVER_KEY`; `gh secret set VITE_GOOGLE_BROWSER_KEY -b "<browser key>"`.

Set `PROTOMAPS_BUILD_URL` to the newest file listed at https://maps.protomaps.com/builds/ (form `https://build.protomaps.com/YYYYMMDD.pmtiles`).

- [ ] **Step 7: Dry run, then real import**

```bash
npm run import -- lisbon --dry-run
```
Expected: counts printed (days 6, bookings 11 + walk-ins, routes 12, legs ≥ 20, alerts > 30), geocode misses listed. Fix any misses that matter (add an address in the md and re-run). Then:
```bash
npm run import -- lisbon
```
Expected: `Imported: lisbon`, areas ≥ 3, and in the Supabase dashboard `select count(*) from items` matches. Storage bucket `maps` has `lisbon/0.pmtiles`… Verify RLS end to end: the anon key still returns `[]` for `trips`; the signed-in app's More screen now lists "Lisbon · 2026-09-29 → 2026-10-04".

- [ ] **Step 8: README and commit**

Add to `README.md`: how to run the app, how to import a city (file naming, front matter keys `trip`, `dates`, `base`, optional `timezone`/`country`/`country_code`), the id-stability rule, the env var list, and "never commit `content/`".
```bash
git add -A && git status --short   # confirm no content/ or .env
git commit -m "feat(import): atomic city writer, CLI with dry-run, report; Lisbon imported

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push
```

---

## Self-review

**Spec coverage (Plan 1 scope = spec §2 decisions, §3, §5, §6, §9 import tests, §10 day 1–2):**
- §3 content + state tables: Task 2 ✔ (all columns named in §3.1/3.2, plus `time_text`, `approx`, `url`, `fields`, `sort` needed by parsers). `route_link` item kind added to spec's kinds — the spec lists `stop/option/note`; this plan adds `route_link` for the per-block route strip. Spec §3.1 should be amended in the same commit as Task 5 (one-line edit).
- §5 pipeline steps 1–6: Tasks 4–11 ✔. Strict failure with file:line ✔. `--dry-run` ✔. Geocode cache ✔. Legs + polylines ✔. Offline areas via pmtiles extract ✔. Atomic rewrite ✔. Summary ✔.
- §6 security: RLS ✔, sign-ups disabled ✔, buckets private ✔, key restrictions and quotas ✔ (Task 11 step 6), import function service-only ✔.
- §4 screens: only sign-in/reset and the shell in this plan; Day/Bookings/Routes/More export/Map/Home are Plans 2–4 by design.
- §7 offline app behaviour, §8 app error handling: Plans 2–4.

**Placeholders:** none; every step has code or an exact command. Owner-only steps (login, password choice, console clicks) are labelled.

**Type consistency:** `CityContent` keys `trip, days, items, bookings, routes, legs, alerts, parked, notes, areas` are used identically in `write.ts`, `import_city`, `stampOwner` and the tests. `extractPlace` is defined in Task 5 and moved in Task 8 with the same signature. `parseTime` returns `{ time, text, approx }` everywhere. `LegRow.google_url` is the single-hop link; `RouteRow.google_url` the full link.
