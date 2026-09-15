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
