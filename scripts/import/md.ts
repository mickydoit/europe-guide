export class ImportError extends Error {
  constructor(public file: string, public line: number, msg: string) { super(`${file}:${line}: ${msg}`) }
}
export type Node =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; line: number }
  | { kind: 'table'; header: string[]; rows: string[][]; line: number }
  | { kind: 'para'; text: string; line: number }
  | { kind: 'bullets'; items: string[]; line: number }
  | { kind: 'hr'; line: number }

export function parseFrontMatter(src: string) {
  src = src.replace(/\r\n?/g, '\n')
  const lines = src.split('\n')
  if (lines[0].trim() !== '---') return { data: {}, body: src, bodyStartLine: 1 }
  const end = lines.indexOf('---', 1)
  if (end < 0) return { data: {}, body: src, bodyStartLine: 1 }
  const data: Record<string, string> = {}
  for (const l of lines.slice(1, end)) { const m = l.match(/^([\w-]+):\s*(.*)$/); if (m) data[m[1]] = m[2].trim() }
  return { data, body: lines.slice(end + 1).join('\n'), bodyStartLine: end + 2 }
}

function splitRow(l: string): string[] {
  const cells: string[] = []; let cur = ''
  const inner = l.trim().replace(/^\|/, '').replace(/\|$/, '')
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\' && inner[i + 1] === '|') { cur += '|'; i++ } else if (inner[i] === '|') { cells.push(cur); cur = '' } else cur += inner[i]
  }
  cells.push(cur); return cells.map(cellText)
}
export const cellText = (s: string) => s.trim()

export function tokenize(body: string, startLine = 1): Node[] {
  body = body.replace(/\r\n?/g, '\n')
  const lines = body.split('\n'); const out: Node[] = []
  let i = 0
  const ln = () => startLine + i
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    if (/^---+$/.test(l.trim())) { out.push({ kind: 'hr', line: ln() }); i++; continue }
    const h = l.match(/^(#{1,3})\s+(.*)$/)
    if (h) { out.push({ kind: 'heading', level: h[1].length as 1 | 2 | 3, text: h[2].trim(), line: ln() }); i++; continue }
    if (l.trim().startsWith('|')) {
      const line = ln(); const header = splitRow(l); i++
      if (!(lines[i] ?? '').trim().match(/^\|?\s*:?-+/)) throw new ImportError('<md>', line, 'table without separator row')
      i++; const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i])); i++ }
      out.push({ kind: 'table', header, rows, line }); continue
    }
    if (/^[-*]\s+/.test(l)) {
      const line = ln(); const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, '').trim()); i++ }
      out.push({ kind: 'bullets', items, line }); continue
    }
    const line = ln(); const buf: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\||[-*]\s|---)/.test(lines[i])) { buf.push(lines[i].trim()); i++ }
    out.push({ kind: 'para', text: buf.join(' '), line })
  }
  return out
}
