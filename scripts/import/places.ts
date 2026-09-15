export function extractPlace(plan: string): { place_name: string | null; address: string | null } {
  const m = plan.match(/\*\*([^*]+)\*\*/)
  if (!m) return { place_name: null, address: null }
  const raw = m[1].trim()
  if (raw.endsWith('.') || raw.endsWith(':') || /^(Book|Tell the guide|Option|Alternatives|Or stay|Confirm|Check|Pick one|Walk to|Early start|Long day)/i.test(raw)) {
    return { place_name: null, address: null }
  }
  const name = raw.replace(/\s*[—-]\s*(BOOKED|booked)$/, '').trim()
  const rest = plan.slice((m.index ?? 0) + m[0].length)
  const am = rest.match(/^,\s*([^—]*)/)
  const address = am ? am[1].trim() || null : null
  return { place_name: name, address }
}

export function pointsFromGoogleUrl(url: string) {
  const u = new URL(url); const p = u.searchParams
  const dec = (s: string | null) => (s ?? '').replace(/\+/g, ' ').trim()
  const origin = dec(p.get('origin')), dest = dec(p.get('destination'))
  if (!origin || !dest) throw new Error(`dir url missing origin/destination: ${url}`)
  const wps = p.get('waypoints') ? dec(p.get('waypoints')).split('|').map(s => s.trim()).filter(Boolean) : []
  return { names: [origin, ...wps, dest], travelmode: p.get('travelmode') ?? 'walking' }
}
