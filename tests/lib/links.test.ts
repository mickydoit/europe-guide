import { walkLink, routeLink, legLink } from '../../src/lib/links'
import type { RouteRow, LegRow } from '../../src/lib/types'

describe('walkLink', () => {
  test('with coords, builds a destination lat,lng url with walking travelmode', () => {
    const url = walkLink({ lat: 38.71, lng: -9.14, name: 'Senzi', address: null }, 'Lisbon')
    expect(url).not.toBeNull()
    expect(url).toContain('destination=38.71,-9.14&travelmode=walking')
  })

  test('without coords but with a name, builds a destination text query', () => {
    const url = walkLink(
      { lat: null, lng: null, name: 'Senzi', address: 'R. da Moeda 12' },
      'Lisbon',
    )
    expect(url).toContain('destination=Senzi%2C%20R.%20da%20Moeda%2012%2C%20Lisbon')
  })

  test('without coords and without a name, returns null', () => {
    const url = walkLink({ lat: null, lng: null, name: null, address: null }, 'Lisbon')
    expect(url).toBeNull()
  })

  test('supports driving mode', () => {
    const url = walkLink({ lat: 38.71, lng: -9.14, name: 'Senzi', address: null }, 'Lisbon', 'driving')
    expect(url).toContain('travelmode=driving')
  })

  test('defaults to the walking travelmode', () => {
    const url = walkLink({ lat: 38.71, lng: -9.14, name: 'Senzi', address: null }, 'Lisbon')
    expect(url).toContain('travelmode=walking')
  })

  test('base url shape with coords', () => {
    const url = walkLink({ lat: 38.71, lng: -9.14, name: null, address: null }, 'Lisbon')
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=38.71,-9.14&travelmode=walking')
  })

  test('name-only query omits missing address', () => {
    const url = walkLink({ lat: null, lng: null, name: 'Senzi', address: null }, 'Lisbon')
    expect(url).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=' +
        encodeURIComponent('Senzi, Lisbon') +
        '&travelmode=walking',
    )
  })
})

describe('routeLink', () => {
  test('returns the route google_url', () => {
    const route = { google_url: 'https://www.google.com/maps/dir/?api=1&destination=1,2' } as RouteRow
    expect(routeLink(route)).toBe(route.google_url)
  })
})

describe('legLink', () => {
  test('returns the leg google_url', () => {
    const leg = { google_url: 'https://www.google.com/maps/dir/?api=1&destination=3,4' } as LegRow
    expect(legLink(leg)).toBe(leg.google_url)
  })
})
