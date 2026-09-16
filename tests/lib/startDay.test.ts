import { describe, test, expect, beforeEach } from 'vitest'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'
import { startOfDay } from '../../src/lib/startDay'

let content: CityContent
beforeEach(async () => { content = await loadValle() })

describe('startOfDay', () => {
  test('uses the first leg of the first walking route on a day that has one', () => {
    // Valle Monday: V1 (walking) Piazza Grande → Caffè Nord → Belvedere; V2 is a taxi and must be ignored.
    const legs = content.legs.filter(l => l.route_id === 'V1').sort((a, b) => a.seq - b.seq)
    const s = startOfDay(content, '2026-11-02')
    expect(s).not.toBeNull()
    expect(s!.href).toBe(legs[0].google_url)
    expect(s!.to).toBe(legs[0].to_name)
    expect(s!.minutes).toBe(legs[0].duration_s != null ? Math.round(legs[0].duration_s / 60) : null)
    const firstStop = content.items.filter(i => i.kind === 'stop' && i.date === '2026-11-02').sort((a, b) => a.sort - b.sort)[0]
    expect(s!.firstStopId).toBe(firstStop.id)
  })

  test('skips non-walking routes', () => {
    const onlyTaxi = { ...content, routes: content.routes.filter(r => r.id === 'V2'), legs: content.legs.filter(l => l.route_id === 'V2') }
    const s = startOfDay(onlyTaxi, '2026-11-02')
    // Falls back to the first stop that can be walked to, not the taxi leg.
    expect(s).not.toBeNull()
    expect(s!.href).not.toBe(content.legs.find(l => l.route_id === 'V2')!.google_url)
    expect(s!.href).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/)
  })

  test('falls back to directions to the first named stop when the day has no route', () => {
    const noRoutes = { ...content, routes: [], legs: [] }
    const s = startOfDay(noRoutes, '2026-11-02')
    expect(s).not.toBeNull()
    expect(s!.to).toBe('Piazza Grande')
    expect(s!.href).toContain('destination=')
    expect(s!.href).toContain('travelmode=walking')
    expect(s!.minutes).toBeNull()
  })

  test('null when the day has nothing to walk to', () => {
    // Sunday (arrival) has stops but none with a place name or coordinates, and no routes.
    expect(startOfDay({ ...content, routes: [], legs: [] }, '2026-11-01')).toBeNull()
    expect(startOfDay(content, '2026-12-25')).toBeNull()
  })
})
