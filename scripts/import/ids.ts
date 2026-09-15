export function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
}
export function itemId(trip: string, date: string, time: string | null, seq: number, plan: string): string {
  return `${trip}/${date}/${time ? time.replace(':', '') : String(seq).padStart(3, '0')}/${slug(plan)}`
}
