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
      finish(n)
      const d = (() => { try { return parseDayHeading(n.text, ctx.year) } catch (e) { return fail(n, (e as Error).message) } })()
      if (d) { date = d.date; skipping = false } else if (/^Rough daily walking totals/i.test(n.text)) skipping = true; else fail(n, `unknown ## heading "${n.text}"`)
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
        const [, k, v] = m!
        if (k === 'distance') cur!.distance_text = v
        else if (k === 'covers') cur!.covers = v.split('→').map(s => s.trim()).filter(Boolean)
        else if (k === 'mode') { const mode = v.split(/\W/)[0].toLowerCase(); if (!['walking', 'driving', 'transit'].includes(mode)) fail(n, `bad mode "${v}"`); cur!.mode = mode as RouteRow['mode']; cur!.note = cur!.note ? `${cur!.note}\nmode: ${v}` : `mode: ${v}` }
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
  const seenIds = new Set<string>()
  for (const r of routes) { if (seenIds.has(r.id)) throw new ImportError(file, 1, `duplicate route id ${r.id}`); seenIds.add(r.id) }
  return { routes, notes }
}
