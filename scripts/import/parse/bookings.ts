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
          const [, k, v] = m!
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
