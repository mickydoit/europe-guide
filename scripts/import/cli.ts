import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { loadEnv } from './env'
import { assembleCity, rewriteCity } from './write'
import { makeGoogleGeocoder, makeCachedGeocoder, supabaseCache, geocodeContent } from './geocode'
import { fetchPolyline } from './legs'
import { buildOfflineAreas, supabaseUploader } from './offline'
import { photoTargets, describeTargets, attachPhotos, supabasePhotoStore } from './photos'
import { printReport } from './report'
import { ImportError } from './md'

const pexec = promisify(execFile)
const USAGE = 'usage: npm run import -- <city> [--dry-run] [--skip-maps] [--maxzoom N] [--split-areas] [--skip-photos]'
const ALLOWED_FLAGS = new Set(['--dry-run', '--skip-maps', '--maxzoom', '--split-areas', '--skip-photos'])

export function parseFlags(flags: string[]): { dryRun: boolean; skipMaps: boolean; skipPhotos: boolean; maxzoom: number; splitAreas: boolean } {
  let dryRun = false
  let skipMaps = false
  let skipPhotos = false
  let maxzoom = 15
  let splitAreas = false
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i]
    if (f === '--dry-run') { dryRun = true; continue }
    if (f === '--skip-maps') { skipMaps = true; continue }
    if (f === '--skip-photos') { skipPhotos = true; continue }
    if (f === '--split-areas') { splitAreas = true; continue }
    if (f === '--maxzoom') {
      const v = flags[++i]
      if (v === undefined || !/^\d+$/.test(v)) throw new Error('--maxzoom requires a numeric value')
      maxzoom = +v
      continue
    }
    if (!ALLOWED_FLAGS.has(f)) throw new Error(`unknown flag: ${f}`)
  }
  return { dryRun, skipMaps, skipPhotos, maxzoom, splitAreas }
}

async function main() {
  const [slug, ...flags] = process.argv.slice(2)
  if (!slug) { console.error(USAGE); process.exit(2) }
  let dryRun: boolean, skipMaps: boolean, skipPhotos: boolean, maxzoom: number, splitAreas: boolean
  try {
    ({ dryRun, skipMaps, skipPhotos, maxzoom, splitAreas } = parseFlags(flags))
  } catch (e) {
    console.error((e as Error).message); console.error(USAGE); process.exit(2)
  }
  if (!skipMaps && !dryRun) {
    try { await pexec('pmtiles', ['--help']) }
    catch { throw new Error('pmtiles CLI not found. Install with: brew install pmtiles  (or pass --skip-maps)') }
  }
  const env = loadEnv()
  const client = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } })
  const { content, cityHint, warnings: assembleWarnings } = await assembleCity(`content/${slug}`, slug)
  const warnings: string[] = [...assembleWarnings]
  const geocoder = makeCachedGeocoder(makeGoogleGeocoder(env.googleServerKey, content.trip.country_code), supabaseCache(client, env.ownerId))
  const { misses } = await geocodeContent(content, geocoder, cityHint)
  for (const leg of content.legs) {
    const mode = content.routes.find(r => r.id === leg.route_id)!.mode
    try { const p = await fetchPolyline(env.googleServerKey, leg, mode); if (p) Object.assign(leg, p); else warnings.push(`no polyline for ${leg.route_id}#${leg.seq} (${leg.from_name} → ${leg.to_name})`) }
    catch (e) { warnings.push(`polyline ${leg.route_id}#${leg.seq}: ${(e as Error).message}`) }
  }
  let photoCounts = { attached: 0, skipped: 0, shared: 0 }
  if (!skipPhotos && !dryRun) {
    const store = supabasePhotoStore(client, env.ownerId)
    const plan = photoTargets(content, cityHint)
    const r = await attachPhotos(plan.targets, store, env.googleServerKey, fetch, plan.shared)
    photoCounts = { attached: r.attached, skipped: r.skipped, shared: r.shared }
    warnings.push(...r.warnings)
  } else if (skipPhotos && !dryRun) {
    // Keep what the last import attached: the rows are rewritten wholesale below.
    const { data, error } = await client.from('items').select('id,photo_path,photo_credit').eq('trip', slug)
    if (error) throw new Error(`items photo fetch: ${error.message}`)
    for (const row of data ?? []) { const it = content.items.find(i => i.id === row.id); if (it) { it.photo_path = row.photo_path; it.photo_credit = row.photo_credit } }
    const { data: bk, error: bErr } = await client.from('bookings').select('id,photo_path,photo_credit').eq('trip', slug)
    if (bErr) throw new Error(`bookings photo fetch: ${bErr.message}`)
    for (const row of bk ?? []) { const b = content.bookings.find(x => x.id === row.id); if (b) { b.photo_path = row.photo_path; b.photo_credit = row.photo_credit } }
    warnings.push('photos skipped — kept existing photo paths')
  } else if (skipPhotos) {
    warnings.push('photos skipped (--skip-photos)')
  }
  if (!skipMaps && !dryRun) {
    content.areas = await buildOfflineAreas(slug, content, { buildUrl: env.protomapsBuildUrl, outDir: `.cache/pmtiles`, maxzoom, splitAreas, upload: supabaseUploader(client) })
  } else if (skipMaps && !dryRun) {
    const { data, error } = await client.from('offline_areas').select('*').eq('trip', slug)
    if (error) throw new Error(`offline_areas fetch: ${error.message}`)
    content.areas = (data ?? []).map(({ owner: _owner, ...rest }) => rest) as typeof content.areas
    warnings.push(`offline maps skipped — kept ${content.areas.length} existing area(s)`)
  } else if (skipMaps) {
    warnings.push('offline maps skipped (--skip-maps)')
  }
  // A dry run is the only chance to read the queries before they are spent and cached.
  const queries = dryRun && !skipPhotos ? describeTargets(content, cityHint) : []
  const counts = dryRun
    ? { ...Object.fromEntries(Object.entries(content).filter(([k]) => k !== 'trip').map(([k, v]) => [k, (v as unknown[]).length])), photos: queries.length }
    : { ...(await rewriteCity(client, env.ownerId, content)), photos: photoCounts.attached + photoCounts.skipped + photoCounts.shared }
  printReport({ slug, counts, misses, warnings, dryRun, queries, url: `https://mickydoit.github.io/europe-guide/?trip=${slug}` })
}
const isDirectRun = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main().catch(e => {
    if (e instanceof Error) console.error(`\n✗ ${e.message}`); else console.error(e)
    if (process.env.DEBUG) console.error(e)
    process.exit(1)
  })
}
