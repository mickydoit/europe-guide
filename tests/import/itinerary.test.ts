import { readFileSync } from 'node:fs'
import { parseItinerary, parseDayHeading, parseTime } from '../../scripts/import/parse/itinerary'
import { ImportError } from '../../scripts/import/md'
const src = readFileSync('tests/fixtures/valle/Valle-Itinerary-Full.md', 'utf8')
const ctx = { trip: 'valle', year: 2026 }

test('day headings parse date, title and status', () => {
  expect(parseDayHeading('Wednesday 30 September — orientation ✅ LOCKED', 2026)).toEqual({ date: '2026-09-30', title: 'orientation', status: 'locked' })
  expect(parseDayHeading('Saturday 3 October — going back properly ✅ LOCKED except dinner', 2026)).toEqual({ date: '2026-10-03', title: 'going back properly', status: 'locked_except_dinner' })
  expect(parseDayHeading('Tuesday 29 September — arrival', 2026)).toEqual({ date: '2026-09-29', title: 'arrival', status: null })
  expect(parseDayHeading('Lisbon, 29 September – 4 October 2026', 2026)).toBeNull()
})
test('times', () => {
  expect(parseTime('08:00')).toEqual({ time: '08:00', text: '08:00', approx: false })
  expect(parseTime('~18:00')).toEqual({ time: '18:00', text: '~18:00', approx: true })
  expect(parseTime('—')).toEqual({ time: null, text: null, approx: false })
  expect(parseTime('Evening')).toEqual({ time: null, text: 'Evening', approx: false })
  expect(() => parseTime('25:70')).toThrow()
})
test('fixture parses into days, blocks, stops, options, notes and route links', () => {
  const r = parseItinerary('Valle-Itinerary-Full.md', src, ctx)
  expect(r.intro).toMatch(/Staying/)
  expect(r.days.length).toBeGreaterThanOrEqual(2)
  const stops = r.items.filter(i => i.kind === 'stop')
  expect(stops.length).toBeGreaterThanOrEqual(5)
  expect(stops.every(s => s.sort >= 0 && s.id.startsWith('valle/'))).toBe(true)
  const opts = r.items.filter(i => i.kind === 'option')
  expect(opts.length).toBe(2)
  expect(opts[0].parent_item).toBe(stops.find(s => /pick one below/i.test(s.plan))!.id)
  const rl = r.items.find(i => i.kind === 'route_link')!
  expect(rl.url).toMatch(/^https:\/\/www\.google\.com\/maps\/dir/)
  expect(rl.block).toBe('midday')
  const noBlock = r.items.filter(i => i.date === r.days[r.days.length - 1].date)
  expect(noBlock.some(i => i.block === null)).toBe(true)
  const withPlace = stops.find(s => s.place_name === 'Caffè Nord')!
  expect(withPlace.address).toBe('Via Roma 12')
})
test('unknown table shape fails with file:line', () => {
  const bad = readFileSync('tests/fixtures/broken/bad-table.md', 'utf8')
  expect(() => parseItinerary('bad-table.md', bad, ctx)).toThrow(ImportError)
  expect(() => parseItinerary('bad-table.md', bad, ctx)).toThrow(/bad-table\.md:\d+/)
})
test('unknown H1 heading fails', () => {
  const bad = readFileSync('tests/fixtures/broken/bad-heading.md', 'utf8')
  expect(() => parseItinerary('bad-heading.md', bad, ctx)).toThrow(/day heading/)
})
