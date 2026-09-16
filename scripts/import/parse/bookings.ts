import { parseFrontMatter, tokenize, ImportError, type Node } from '../md'
import { parseDayHeading, parseTime } from './itinerary'
import type { BookingRow, AlertRow, NoteRow } from '../types'

const COLS = new Set(['priority','book_by','decide_by','contact','address','notes','note','fallback','relates_to','options','status'])

export function parseBookings(file: string, src: string, ctx: { trip: string; year: number }) {
  const fm = parseFrontMatter(src); const nodes = tokenize(fm.body, fm.bodyStartLine)
  const bookings: BookingRow[] = []; const alerts: AlertRow[] = []; const notes: NoteRow[] = []
  let section = 0; let cur: BookingRow | null = null; let alertDate: string | null = null; let alertSeq = 0; let noteSeq = 0; let sort = 0; let walkinSeq = 0
  const fail = (n: Node, msg: string): never => { throw new ImportError(file, n.line, msg) }
  // "**key:** value" bullets, shared by to-book entries (section 2) and detail blocks under an
  // already-booked row (section 1): the same keys mean the same thing in both places.
  const applyFieldBullets = (n: Extract<Node, { kind: 'bullets' }>, target: BookingRow): void => {
    for (const it of n.items) {
      const m = it.match(/^\*\*([\w_]+):\*\*\s*(.*)$/); if (!m) fail(n, `field bullet must be "**key:** value": "${it}"`)
      const [, k, v] = m!
      if (k === 'for') {
        const fm2 = v.match(/^(\d{4}-\d{2}-\d{2})(?:,\s*(\d{1,2}:\d{2}))?(?:,\s*(.*))?$/); if (!fm2) fail(n, `bad "for" value "${v}"`)
        target.date = fm2![1]
        target.time = (() => { try { return fm2![2] ? parseTime(fm2![2]).time : null } catch (e) { return fail(n, (e as Error).message) } })()
        if (fm2![3]) target.fields.for_note = fm2![3]
      }
      else if (k === 'note' || k === 'notes') target.notes = target.notes ? `${target.notes}\n${v}` : v
      else if (k === 'status') target.status_from_file = v
      else if (k === 'book_by' || k === 'decide_by') { const dm = v.match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/); if (!dm) fail(n, `${k} must start with YYYY-MM-DD: "${v}"`); (target as unknown as Record<string, string>)[k] = dm![1]; if (dm![2]) target.fields[`${k}_note`] = dm![2].replace(/^\((.*)\)$/, '$1') }
      else if (COLS.has(k)) (target as unknown as Record<string, string>)[k] = v
      else target.fields[k] = v
    }
  }
  const blank = (id: string, kind: BookingRow['kind'], title: string): BookingRow => ({ id, trip: ctx.trip, kind, title, date: null, time: null, priority: null, book_by: null, decide_by: null, contact: null, address: null, notes: null, fallback: null, relates_to: null, options: null, status_from_file: null, fields: {}, sort: sort++, photo_path: null, photo_credit: null })
  for (const n of nodes) {
    if (n.kind === 'hr') continue
    if (n.kind === 'heading' && n.level === 1) continue
    if (n.kind === 'heading' && n.level === 2) {
      const m = n.text.match(/^(\d)\./); if (!m) fail(n, `section heading must start with a number: "${n.text}"`)
      section = +m![1]; cur = null; continue
    }
    if (section === 0) { continue }
    if (section === 1) {
      // Optional detail block for a row of the booked table: "### B04 · title" then field bullets.
      if (n.kind === 'heading' && n.level === 3) {
        const m = n.text.match(/^([A-Z]+\d+)\s*·\s*(.+)$/); if (!m) fail(n, `booked detail heading needs "ID · title": "${n.text}"`)
        const row = bookings.find(b => b.kind === 'booked' && b.id === m![1])
        if (!row) fail(n, `detail heading ${m![1]} has no row in the booked table above it`)
        cur = row!; continue
      }
      if (n.kind === 'bullets') {
        if (!cur) fail(n, 'detail bullets before any "### ID · title" heading')
        applyFieldBullets(n, cur!)
        continue
      }
      if (n.kind !== 'table') continue
      if (n.header.map(s => s.toLowerCase()).join('|') !== 'id|item|date|time|notes') fail(n, `booked table must be id|item|date|time|notes`)
      for (const r of n.rows) {
        const b = blank(r[0], 'booked', r[1])
        const dateStr = r[2] ?? ''
        if (dateStr === '' || dateStr === '—') b.date = null
        else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) b.date = dateStr
        else fail(n, `bad date "${dateStr}"`)
        b.time = (() => { try { return r[3] && r[3] !== '—' ? parseTime(r[3]).time : null } catch (e) { return fail(n, (e as Error).message) } })()
        b.notes = r[4] || null
        if (!/^[A-Z]+\d+$/.test(b.id)) fail(n, `bad booking id "${b.id}"`)
        bookings.push(b)
      }
      cur = null
      continue
    }
    if (section === 2) {
      if (n.kind === 'heading' && n.level === 3) {
        const m = n.text.match(/^([A-Z]+\d+)\s*·\s*(.+)$/); if (!m) fail(n, `to-book heading needs "ID · title": "${n.text}"`)
        cur = blank(m![1], 'todo', m![2].trim()); bookings.push(cur); continue
      }
      if (n.kind === 'bullets') {
        if (!cur) fail(n, 'fields before any booking heading')
        applyFieldBullets(n, cur!)
        continue
      }
      continue
    }
    if (section === 3) {
      if (n.kind === 'para') {
        if (/^\*\*Exception:\*\*/.test(n.text)) { notes.push({ trip: ctx.trip, seq: noteSeq++, section: 'walkin', text: n.text }); continue }
        n.text.split('·').map(s => s.trim()).filter(Boolean).forEach(name => bookings.push(blank(`WK${String(++walkinSeq).padStart(2, '0')}`, 'walkin', name)))
      }
      continue
    }
    if (section === 4) {
      if (n.kind === 'heading' && n.level === 3) {
        const d = (() => { try { return parseDayHeading(n.text, ctx.year) } catch (e) { return fail(n, (e as Error).message) } })()
        if (!d) fail(n, `alert heading must be a weekday date: "${n.text}"`)
        alertDate = d!.date; alertSeq = 0; continue
      }
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
  const seenIds = new Set<string>()
  for (const b of bookings) { if (seenIds.has(b.id)) throw new ImportError(file, 1, `duplicate booking id ${b.id}`); seenIds.add(b.id) }
  return { front: fm.data, bookings, alerts, notes }
}
