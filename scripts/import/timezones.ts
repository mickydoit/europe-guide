const TABLE: Record<string, [string, string, string]> = {
  Lisbon: ['Europe/Lisbon', 'Portugal', 'pt'], Istanbul: ['Europe/Istanbul', 'Türkiye', 'tr'],
  Seville: ['Europe/Madrid', 'Spain', 'es'], Barcelona: ['Europe/Madrid', 'Spain', 'es'],
  Egypt: ['Africa/Cairo', 'Egypt', 'eg'], Cairo: ['Africa/Cairo', 'Egypt', 'eg'],
}
const CODES: Record<string, string> = { Italy: 'it', Portugal: 'pt', Spain: 'es', 'Türkiye': 'tr', Turkey: 'tr', Egypt: 'eg', France: 'fr', Greece: 'gr' }
export function tripMeta(name: string, front: Record<string, string>) {
  if (front.timezone && front.country) { const cc = front.country_code ?? CODES[front.country]; if (!cc) throw new Error(`unknown country_code for ${front.country}; add country_code to front matter`); return { timezone: front.timezone, country: front.country, country_code: cc } }
  const t = TABLE[name]; if (!t) throw new Error(`no timezone known for trip "${name}"; add timezone: and country: to the bookings front matter`)
  return { timezone: t[0], country: t[1], country_code: t[2] }
}
