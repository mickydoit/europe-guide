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
