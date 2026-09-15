import { layers, namedFlavor } from '@protomaps/basemaps'
import type { StyleSpecification, LayerSpecification, SourceSpecification } from 'maplibre-gl'

const ORIGIN = typeof location !== 'undefined' ? location.origin : 'https://mickydoit.github.io'
// import.meta.env.BASE_URL is Vite's configured base path (`/europe-guide/` in this
// deployment); deriving from it instead of a literal keeps these URLs correct if the
// base path ever changes, and lets tests assert against whatever base Vitest exposes.
const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')
/** MapLibre requires absolute sprite/glyph URLs. */
export const GLYPHS = `${ORIGIN}${BASE}/map/fonts/{fontstack}/{range}.pbf`
export const SPRITE = `${ORIGIN}${BASE}/map/sprites/v4/dark`

export function buildStyle(sources: { id: string; url: string }[], opts?: { lang?: string }): StyleSpecification {
  const lang = opts?.lang ?? 'en'

  const styleSources: Record<string, SourceSpecification> = {}
  for (const source of sources) {
    styleSources[source.id] = { type: 'vector', url: source.url }
  }

  const styleLayers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': '#202123' } },
  ]
  for (const source of sources) {
    const sourceLayers = layers(source.id, namedFlavor('dark'), { lang })
    for (const layer of sourceLayers) {
      if (layer.type === 'background') continue
      styleLayers.push({ ...layer, id: `${layer.id}__${source.id}` })
    }
  }

  return {
    version: 8,
    glyphs: GLYPHS,
    sprite: SPRITE,
    sources: styleSources,
    layers: styleLayers,
  }
}
