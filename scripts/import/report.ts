export function printReport(args: { slug: string; counts: Record<string, number>; misses: string[]; warnings: string[]; dryRun: boolean; url: string }) {
  const { slug, counts, misses, warnings, dryRun, url } = args
  console.log(`\n${dryRun ? 'DRY RUN — nothing written' : 'Imported'}: ${slug}`)
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(10)} ${v}`)
  if (misses.length) { console.log(`\nGeocode misses (${misses.length}) — fix the text or add an address:`); misses.forEach(m => console.log(`  - ${m}`)) }
  if (warnings.length) { console.log(`\nWarnings:`); warnings.forEach(w => console.log(`  - ${w}`)) }
  console.log(`\nOpen: ${url}`)
}
