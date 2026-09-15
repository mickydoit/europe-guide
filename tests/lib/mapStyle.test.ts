import { buildStyle, GLYPHS, SPRITE } from '../../src/lib/mapStyle'

const sources = [
  { id: 'valle', url: 'pmtiles://valle.pmtiles' },
  { id: 'roma', url: 'pmtiles://roma.pmtiles' },
]

test('buildStyle creates one vector source per input, keyed by id', () => {
  const style = buildStyle(sources)
  expect(Object.keys(style.sources)).toHaveLength(2)
  expect(style.sources.valle).toEqual({ type: 'vector', url: 'pmtiles://valle.pmtiles' })
  expect(style.sources.roma).toEqual({ type: 'vector', url: 'pmtiles://roma.pmtiles' })
})

test('buildStyle has exactly one background layer, first in the list', () => {
  const style = buildStyle(sources)
  const backgrounds = style.layers.filter(l => l.type === 'background')
  expect(backgrounds).toHaveLength(1)
  expect(style.layers[0]).toEqual({
    id: 'background',
    type: 'background',
    paint: { 'background-color': '#202123' },
  })
})

test('buildStyle gives every layer a unique id', () => {
  const style = buildStyle(sources)
  const ids = style.layers.map(l => l.id)
  expect(new Set(ids).size).toBe(ids.length)
})

test('buildStyle suffixes each non-background layer id with its source id', () => {
  const style = buildStyle(sources)
  const valleLayers = style.layers.filter(l => l.id.endsWith('__valle'))
  const romaLayers = style.layers.filter(l => l.id.endsWith('__roma'))
  expect(valleLayers.length).toBeGreaterThan(0)
  expect(romaLayers.length).toBeGreaterThan(0)
  expect(valleLayers.length).toBe(romaLayers.length)
})

test('buildStyle points every non-background layer at one of the given source ids', () => {
  const style = buildStyle(sources)
  const sourceIds = new Set(sources.map(s => s.id))
  for (const layer of style.layers) {
    if (layer.type === 'background') continue
    expect(sourceIds.has((layer as { source?: string }).source ?? '')).toBe(true)
  }
})

test('buildStyle sets absolute glyph and sprite URLs (MapLibre rejects relative ones), derived from BASE_URL', () => {
  const style = buildStyle(sources)
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')
  expect(style.glyphs).toBe(`${location.origin}${base}/map/fonts/{fontstack}/{range}.pbf`)
  expect(style.sprite).toBe(`${location.origin}${base}/map/sprites/v4/dark`)
  expect(GLYPHS).toBe(style.glyphs)
  expect(SPRITE).toBe(style.sprite)
})

test('buildStyle version is 8', () => {
  expect(buildStyle(sources).version).toBe(8)
})

test('buildStyle passes the requested language through to layers()', () => {
  const en = buildStyle(sources, { lang: 'en' })
  const pt = buildStyle(sources, { lang: 'pt' })
  expect(en.layers).not.toEqual(pt.layers)
})
