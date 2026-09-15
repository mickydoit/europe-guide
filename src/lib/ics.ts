import type { AlertRow, TripRow } from './types'

const SUMMARY_MAX = 60

export function escapeIcs(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

export function stripMd(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function truncateSummary(s: string, max = SUMMARY_MAX): string {
  const chars = Array.from(s)
  if (chars.length <= max) return s
  const cut = chars.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  const trimmed = lastSpace > 0 ? cut.slice(0, lastSpace) : cut
  return `${trimmed.join('')}…`
}

export function foldLine(s: string): string {
  const bytes = new TextEncoder().encode(s)
  if (bytes.length <= 75) return s
  const out: string[] = []
  let start = 0
  let first = true
  while (start < bytes.length) {
    const maxLen = first ? 75 : 74
    let end = Math.min(start + maxLen, bytes.length)
    while (end > start && (bytes[end] & 0xc0) === 0x80) end--
    out.push(new TextDecoder().decode(bytes.subarray(start, end)))
    start = end
    first = false
  }
  return out.join('\r\n ')
}

function fmtStampUtc(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`
}

export function buildIcs(trip: TripRow, alerts: AlertRow[], now: Date = new Date()): string {
  const lines: string[] = []
  lines.push('BEGIN:VCALENDAR')
  lines.push('VERSION:2.0')
  lines.push('PRODID:-//europe-guide//EN')
  lines.push('CALSCALE:GREGORIAN')
  lines.push('METHOD:PUBLISH')
  lines.push(`X-WR-CALNAME:Europe 2026 — ${trip.name}`)
  lines.push(`X-WR-TIMEZONE:${trip.timezone}`)

  const stamp = fmtStampUtc(now)

  for (const alert of alerts) {
    const plain = stripMd(alert.text)
    const summary = escapeIcs(truncateSummary(plain))
    const description = escapeIcs(plain)
    const dateCompact = alert.date.replace(/-/g, '')

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${trip.slug}-${alert.date}-${alert.seq}@europe-guide`)
    lines.push(`DTSTAMP:${stamp}`)
    if (alert.time) {
      const timeCompact = `${alert.time.replace(':', '')}00`
      lines.push(`DTSTART;TZID=${trip.timezone}:${dateCompact}T${timeCompact}`)
      lines.push('DURATION:PT15M')
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateCompact}`)
    }
    lines.push(`SUMMARY:${summary}`)
    lines.push(`DESCRIPTION:${description}`)
    if (alert.time) {
      lines.push('BEGIN:VALARM')
      lines.push('TRIGGER:PT0M')
      lines.push('ACTION:DISPLAY')
      lines.push(`DESCRIPTION:${summary}`)
      lines.push('END:VALARM')
    }
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  return `${lines.map(foldLine).join('\r\n')}\r\n`
}

export function downloadIcs(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
