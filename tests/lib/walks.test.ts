import { describe, test, expect, beforeEach } from 'vitest'
import { loadValle } from '../helpers/content'
import type { CityContent } from '../../src/lib/types'
import { nextWalk, routeFor } from '../../src/lib/walks'

let content: CityContent
beforeEach(async () => { content = await loadValle() })
const stop = (c: CityContent, name: string) => c.items.find(i => i.kind === 'stop' && i.place_name === name)!

describe('nextWalk', () => {
  test('uses the walking-route leg that starts at this stop', () => {
    const leg = content.legs.find(l => l.route_id === 'V1' && l.seq === 0)!
    const w = nextWalk(content, stop(content, 'Piazza Grande'))
    expect(w).toEqual({ to: leg.to_name, href: leg.google_url, distanceM: leg.distance_m, durationS: leg.duration_s, fromRoute: true })
  })
  test('falls back to directions to the next mappable stop of the day', () => {
    const w = nextWalk(content, stop(content, 'Belvedere'))   // no leg starts here; Castello Alto is the next named stop
    expect(w).not.toBeNull()
    expect(w!.to).toBe('Castello Alto')
    expect(w!.href).toContain('travelmode=walking')
    expect(w!.fromRoute).toBe(false)
  })
  test('null for the last mappable stop of the day', () => {
    expect(nextWalk(content, stop(content, 'Trattoria Alba'))).toBeNull()
  })
})

describe('routeFor', () => {
  test('finds the walking route whose legs touch this stop', () => {
    expect(routeFor(content, stop(content, 'Piazza Grande'))?.id).toBe('V1')
    expect(routeFor(content, stop(content, 'Belvedere'))?.id).toBe('V1')
  })
  test('ignores non-walking routes and stops on other days', () => {
    expect(routeFor(content, stop(content, 'Trattoria Alba'))).toBeNull()   // only the taxi route V2 ends there
  })
})
