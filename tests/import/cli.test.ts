import { parseFlags } from '../../scripts/import/cli'

test('defaults with no flags', () => {
  expect(parseFlags([])).toEqual({ dryRun: false, skipMaps: false, maxzoom: 16 })
})
test('--dry-run and --skip-maps', () => {
  expect(parseFlags(['--dry-run', '--skip-maps'])).toEqual({ dryRun: true, skipMaps: true, maxzoom: 16 })
})
test('--maxzoom sets a custom value', () => {
  expect(parseFlags(['--maxzoom', '12'])).toEqual({ dryRun: false, skipMaps: false, maxzoom: 12 })
})
test('unknown flag throws', () => {
  expect(() => parseFlags(['--bogus'])).toThrow('unknown flag: --bogus')
})
test('--maxzoom with no value throws', () => {
  expect(() => parseFlags(['--maxzoom'])).toThrow('--maxzoom requires a numeric value')
})
test('--maxzoom followed by another flag throws', () => {
  expect(() => parseFlags(['--maxzoom', '--dry-run'])).toThrow('--maxzoom requires a numeric value')
})
