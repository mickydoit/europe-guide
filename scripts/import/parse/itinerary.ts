import { tokenize, ImportError, type Node } from '../md'
import { itemId } from '../ids'
import { extractPlace } from '../places'
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
      if (!d) { if (!sawTrip && days.length === 0 && /,.*\b\d{4}\b/.test(n.text)) { sawTrip = true; continue } fail(n, `not a day heading: "${n.text}"`) }
      if (days.some(x => x.date === d!.date)) fail(n, `duplicate day ${d!.date}`)
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
          lastStop = push({ kind: 'stop', time: t.time, time_text: t.text, approx: t.approx, parent_item: null, plan: r[1], details: r[2] ?? null, place_name, address, lat: null, lng: null, url: null, route_id: null, photo_path: null, photo_credit: null })
          if (/pick one|options? below|choose one/i.test(`${r[1]} ${r[2] ?? ''}`)) lastPick = lastStop
        }
      } else if (h[0] === 'place' && h[1] === 'address') {
        const parent = lastPick ?? lastStop
        if (!parent) fail(n, 'options table with no preceding stop')
        for (const r of n.rows) {
          const { place_name } = extractPlace(r[0]); const name = place_name ?? r[0].replace(/\*\*/g, '')
          push({ kind: 'option', time: null, time_text: null, approx: false, parent_item: parent!.id, plan: name, details: n.header.slice(1).map((k, i) => `**${k}:** ${r[i + 1] ?? ''}`).join(' · '), place_name: name, address: r[1] || null, lat: null, lng: null, url: null, route_id: null, photo_path: null, photo_credit: null })
        }
      } else fail(n, `unknown table shape [${n.header.join(' | ')}]`)
      continue
    }
    if (n.kind === 'para') {
      const rl = n.text.match(/^\*\*\[[^\]]*\]\((https:\/\/www\.google\.com\/maps\/dir[^)]+)\)\*\*(.*)$/)
      if (rl) push({ kind: 'route_link', time: null, time_text: null, approx: false, parent_item: null, plan: 'Walking route for this block', details: rl[2].replace(/^\s*—\s*/, '').trim() || null, place_name: null, address: null, lat: null, lng: null, url: rl[1], route_id: null, photo_path: null, photo_credit: null })
      else push({ kind: 'note', time: null, time_text: null, approx: false, parent_item: null, plan: n.text, details: null, place_name: null, address: null, lat: null, lng: null, url: null, route_id: null, photo_path: null, photo_credit: null })
      continue
    }
    if (n.kind === 'bullets') { for (const b of n.items) push({ kind: 'note', time: null, time_text: null, approx: false, parent_item: null, plan: b, details: null, place_name: null, address: null, lat: null, lng: null, url: null, route_id: null, photo_path: null, photo_credit: null }); continue }
  }
  if (days.length === 0) throw new ImportError(file, 1, 'no day headings found')
  return { intro: intro.length ? intro.join('\n\n') : null, days, items }
}
