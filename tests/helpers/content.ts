import { assembleCity } from '../../scripts/import/write'
import type { CityContent } from '../../src/lib/types'
let cache: CityContent | null = null
export async function loadValle(): Promise<CityContent> {
  if (!cache) cache = (await assembleCity('tests/fixtures/valle', 'valle')).content
  return structuredClone(cache)
}
