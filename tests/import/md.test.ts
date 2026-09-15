import { readFileSync } from 'node:fs'
import { parseFrontMatter, tokenize, cellText, ImportError } from '../../scripts/import/md'

test('front matter is split from body with line offset', () => {
  const src = readFileSync('tests/fixtures/valle/Valle-Bookings-Reminders.md', 'utf8')
  const fm = parseFrontMatter(src)
  expect(fm.data.trip).toBe('Valle')
  expect(fm.data.dates).toBe('2026-11-01 to 2026-11-03')
  expect(fm.bodyStartLine).toBeGreaterThan(5)
  expect(fm.body.startsWith('\n# ') || fm.body.startsWith('# ')).toBe(true)
})

test('tokenize yields headings, tables, paragraphs, bullets and hrs with line numbers', () => {
  const src = readFileSync('tests/fixtures/valle/Valle-Itinerary-Full.md', 'utf8')
  const nodes = tokenize(src)
  const kinds = nodes.map(n => n.kind)
  expect(kinds).toContain('heading'); expect(kinds).toContain('table'); expect(kinds).toContain('para'); expect(kinds).toContain('hr')
  const t = nodes.find(n => n.kind === 'table')!
  expect(t.kind === 'table' && t.header).toEqual(['Time', 'Plan', 'Details'])
  expect(nodes[0]).toMatchObject({ kind: 'heading', level: 1, line: 1 })
})

test('table rows keep escaped pipes and trim cells', () => {
  const nodes = tokenize('| A | B |\n|---|---|\n| one \\| two | three |\n')
  const t = nodes[0]
  expect(t.kind === 'table' && t.rows[0]).toEqual(['one | two', 'three'])
})

test('bullets are grouped', () => {
  const nodes = tokenize('- **a:** 1\n- **b:** 2\n\npara\n')
  expect(nodes[0]).toMatchObject({ kind: 'bullets', items: ['**a:** 1', '**b:** 2'] })
  expect(nodes[1]).toMatchObject({ kind: 'para', text: 'para' })
})

test('ImportError carries file and line', () => {
  const e = new ImportError('x.md', 12, 'bad')
  expect(e.message).toBe('x.md:12: bad'); expect(e.line).toBe(12)
})
