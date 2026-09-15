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
