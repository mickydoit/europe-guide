import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, mkdir, stat } from 'node:fs/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CityContent, OfflineAreaRow } from './types'

type P = { lat: number; lng: number }
type NamedPoint = P & { name: string | null }

const R = 6371

export function haversineKm(a: P, b: P) {
  const d = Math.PI / 180
  const dl = (b.lat - a.lat) * d
  const dg = (b.lng - a.lng) * d
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(dg / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function clusterPoints<T extends P>(points: T[], radiusKm = 1.5): T[][] {
  const clusters: T[][] = []
  for (const p of points) {
    const c = clusters.find(cl => cl.some(q => haversineKm(p, q) <= radiusKm))
    if (c) c.push(p)
    else clusters.push([p])
  }
  return clusters
}

export function bboxOf(cluster: P[], padM = 400) {
  const lats = cluster.map(p => p.lat)
  const lngs = cluster.map(p => p.lng)
  const dLat = padM / 111_320
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2
  const dLng = padM / (111_320 * Math.cos((midLat * Math.PI) / 180))
  return {
    min_lng: Math.min(...lngs) - dLng,
    min_lat: Math.min(...lats) - dLat,
    max_lng: Math.max(...lngs) + dLng,
    max_lat: Math.max(...lats) + dLat,
  }
}

const pexec = promisify(execFile)

export async function buildOfflineAreas(
  trip: string,
  c: CityContent,
  opts: {
    buildUrl: string
    outDir: string
    maxzoom?: number
    exec?: (cmd: string, args: string[]) => Promise<void>
    upload?: (local: string, remote: string) => Promise<number>
    statImpl?: (p: string) => Promise<{ size: number }>
  }
): Promise<OfflineAreaRow[]> {
  const exec = opts.exec ?? (async (cmd: string, args: string[]) => { await pexec(cmd, args) })
  if (!opts.upload) throw new Error('upload required')
  const upload = opts.upload
  const doStat = opts.statImpl ?? stat

  const pts: NamedPoint[] = []
  for (const it of c.items) if (it.lat != null && it.lng != null) pts.push({ lat: it.lat, lng: it.lng, name: it.place_name })
  for (const p of c.parked) if (p.lat != null && p.lng != null) pts.push({ lat: p.lat, lng: p.lng, name: p.name })
  for (const l of c.legs) {
    if (l.from_lat != null) pts.push({ lat: l.from_lat, lng: l.from_lng!, name: null })
    if (l.to_lat != null) pts.push({ lat: l.to_lat, lng: l.to_lng!, name: null })
  }

  await mkdir(opts.outDir, { recursive: true })

  const clusters = clusterPoints(pts)
  const rows: OfflineAreaRow[] = []

  for (const [seq, cl] of clusters.entries()) {
    const cx = cl.reduce((s, p) => s + p.lat, 0) / cl.length
    const cy = cl.reduce((s, p) => s + p.lng, 0) / cl.length
    const named = cl.filter(p => p.name).sort((a, b) => haversineKm(a, { lat: cx, lng: cy }) - haversineKm(b, { lat: cx, lng: cy }))
    const name = named[0]?.name ?? `Area ${seq + 1}`
    const bbox = bboxOf(cl)
    const pmtilesPath = `${trip}/${seq}.pmtiles`
    const local = `${opts.outDir}/${trip}-${seq}.pmtiles`

    await exec('pmtiles', [
      'extract',
      opts.buildUrl,
      local,
      `--bbox=${bbox.min_lng},${bbox.min_lat},${bbox.max_lng},${bbox.max_lat}`,
      `--maxzoom=${opts.maxzoom ?? 16}`,
    ])

    const fileStat = await doStat(local).catch(() => null)
    if (!fileStat || fileStat.size === 0) {
      throw new Error(`pmtiles extract produced no file for ${trip} area ${seq} (${local})`)
    }

    const size_bytes = await upload(local, pmtilesPath)

    rows.push({ trip, seq, name, ...bbox, pmtiles_path: pmtilesPath, size_bytes })
  }

  return rows
}

export function supabaseUploader(client: SupabaseClient) {
  return async (local: string, remote: string) => {
    const buf = await readFile(local).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') throw new Error(`offline map file missing: ${local}`)
      throw err
    })
    if (buf.length === 0) throw new Error(`offline map file is empty: ${local}`)
    const { error } = await client.storage.from('maps').upload(remote, buf, { upsert: true, contentType: 'application/octet-stream' })
    if (error) throw new Error(`upload ${remote}: ${error.message}`)
    return buf.length
  }
}
