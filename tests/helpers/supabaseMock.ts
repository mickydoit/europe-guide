import type { CityContent } from '../../src/lib/types'
type Row = Record<string, unknown>
const TABLE: Record<string, keyof CityContent> = { trips: 'trip', days: 'days', items: 'items', bookings: 'bookings', routes: 'routes', legs: 'legs', alerts: 'alerts', parked_venues: 'parked', standing_notes: 'notes', offline_areas: 'areas' }
export function mockSupabaseContent(content: CityContent, opts: { failTable?: string } = {}) {
  const calls: string[] = []
  function query(table: string) {
    let rows: Row[] = table === 'trips' ? [content.trip as unknown as Row] : (content[TABLE[table]] as unknown as Row[]) ?? []
    const q: Record<string, unknown> = {
      select() { return q }, order() { return q }, limit() { return q },
      eq(col: string, val: unknown) { rows = rows.filter(r => r[col] === val); return q },
      then(res: (v: { data: Row[] | null; error: { message: string } | null }) => void) {
        calls.push(table)
        res(opts.failTable === table ? { data: null, error: { message: `boom ${table}` } } : { data: rows, error: null })
      },
    }
    return q
  }
  return { client: { from: query } as never, calls }
}
