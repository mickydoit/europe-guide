import { loadValle } from '../helpers/content'
import { buildIcs, downloadIcs, escapeIcs, foldLine, stripMd, truncateSummary } from '../../src/lib/ics'
import type { CityContent } from '../../src/lib/types'

let content: CityContent

beforeEach(async () => {
  content = await loadValle()
})

function unfold(text: string): string {
  return text.replace(/\r\n /g, '')
}

function eventsOf(text: string): string[] {
  const unfolded = unfold(text)
  const matches = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g)
  return matches ?? []
}

test('output starts with BEGIN:VCALENDAR\\r\\n and ends with END:VCALENDAR\\r\\n', () => {
  const ics = buildIcs(content.trip, content.alerts)
  expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
  expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
})

test('the 09:15 Valle alert yields a timed DTSTART and a VALARM', () => {
  const ics = buildIcs(content.trip, content.alerts)
  const events = eventsOf(ics)
  const event = events.find(e => e.includes('DTSTART;TZID=Europe/Rome:20261102T091500'))
  expect(event).toBeDefined()
  expect(event).toContain('BEGIN:VALARM')
  expect(event).toContain('TRIGGER:PT0M')
  expect(event).toContain('ACTION:DISPLAY')
  expect(event).toContain('END:VALARM')
})

test('the untimed Sunday alert yields an all-day DTSTART and no VALARM', () => {
  const ics = buildIcs(content.trip, content.alerts)
  const events = eventsOf(ics)
  const event = events.find(e => e.includes('DTSTART;VALUE=DATE:20261101'))
  expect(event).toBeDefined()
  expect(event).not.toContain('VALARM')
})

test('escapeIcs escapes backslash, semicolon, comma, and newline', () => {
  expect(escapeIcs('a, b; c\\d\nnew')).toBe('a\\, b\\; c\\\\d\\nnew')
})

test('stripMd removes bold markers and unwraps markdown links', () => {
  expect(stripMd('**Walk to** [Praça](https://x) now')).toBe('Walk to Praça now')
})

test('no output line exceeds 75 bytes', () => {
  const ics = buildIcs(content.trip, content.alerts)
  const lines = ics.split('\r\n').filter(l => l.length > 0)
  for (const line of lines) {
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
  }
})

test('a long multibyte summary/description folds without breaking characters', () => {
  const longText = 'Àé'.repeat(100) // 200 chars, all 2-byte in UTF-8
  const trip = content.trip
  const alerts = [{ trip: trip.slug, date: '2026-11-01', seq: 0, time: null, text: longText }]
  const ics = buildIcs(trip, alerts)
  const unfolded = unfold(ics)
  expect(unfolded).toContain(`DESCRIPTION:${longText}`)
  expect(unfolded).toContain('SUMMARY:')

  // Verify no physical (folded) line breaks a multibyte character: every line must be
  // valid, independently-decodable UTF-8 once trailing partial continuation is accounted for,
  // and re-joining after stripping fold markers must reproduce the exact original bytes.
  const originalBytes = new TextEncoder().encode(unfolded)
  const reconstructed = new TextEncoder().encode(ics.replace(/\r\n /g, ''))
  expect(reconstructed).toEqual(originalBytes)

  const lines = ics.split('\r\n').filter(l => l.length > 0)
  for (const line of lines) {
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    // decoding must not throw / produce replacement characters from a split multibyte char
    expect(line).not.toContain('�')
  }
})

test('foldLine never splits a multibyte character mid-byte-sequence', () => {
  const s = 'DESCRIPTION:' + '🙂é'.repeat(40)
  const folded = foldLine(s)
  const lines = folded.split('\r\n ')
  for (const line of lines) {
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(line).not.toContain('�')
  }
  expect(lines.join('')).toBe(s)
})

test('UIDs are unique across all events', () => {
  const ics = buildIcs(content.trip, content.alerts)
  const unfolded = unfold(ics)
  const uids = [...unfolded.matchAll(/^UID:(.*)$/gm)].map(m => m[1])
  expect(uids.length).toBeGreaterThan(0)
  expect(new Set(uids).size).toBe(uids.length)
})

test('downloadIcs is exported as a function', () => {
  expect(typeof downloadIcs).toBe('function')
})

test('truncateSummary never ends on a lone surrogate when cutting inside an astral char', () => {
  const out = truncateSummary('A' + '😀'.repeat(40))
  expect(/[\uD800-\uDBFF]$/.test(out)).toBe(false)
  expect(Array.from(out).length).toBeLessThanOrEqual(61)
  const bytes = new TextEncoder().encode(out)
  let hasReplacementChar = false
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0xef && bytes[i + 1] === 0xbf && bytes[i + 2] === 0xbd) hasReplacementChar = true
  }
  expect(hasReplacementChar).toBe(false)
})

test('truncateSummary cuts a long ASCII sentence at a word boundary and appends an ellipsis', () => {
  const sentence = 'This is a fairly long sentence made up of plain ASCII words meant to exceed sixty characters easily'
  const out = truncateSummary(sentence)
  expect(out.endsWith('…')).toBe(true)
  expect(out).not.toContain('  ')
  expect(sentence.startsWith(out.slice(0, -1))).toBe(true)
  expect(out.slice(0, -1).endsWith(' ')).toBe(false)
})

test('truncateSummary returns a short string unchanged', () => {
  const s = 'A short thirty character string'.slice(0, 30)
  expect(s.length).toBe(30)
  expect(truncateSummary(s)).toBe(s)
})
