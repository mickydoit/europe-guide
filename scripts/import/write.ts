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
