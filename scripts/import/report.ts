const QUERY_PREVIEW = 60

export function printReport(args: { slug: string; counts: Record<string, number>; misses: string[]; warnings: string[]; dryRun: boolean; url: string; queries?: string[] }) {
  const { slug, counts, misses, warnings, dryRun, url, queries = [] } = args
  console.log(`\n${dryRun ? 'DRY RUN — nothing written' : 'Imported'}: ${slug}`)
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(10)} ${v}`)
  if (queries.length) {
    console.log(`\nPhoto queries (${Math.min(queries.length, QUERY_PREVIEW)} of ${queries.length}) — a wrong one here becomes a wrong photo, cached:`)
    queries.slice(0, QUERY_PREVIEW).forEach(q => console.log(`  - ${q}`))
  }
  if (misses.length) { console.log(`\nGeocode misses (${misses.length}) — fix the text or add an address:`); misses.forEach(m => console.log(`  - ${m}`)) }
  if (warnings.length) { console.log(`\nWarnings:`); warnings.forEach(w => console.log(`  - ${w}`)) }
  console.log(`\nOpen: ${url}`)
}
