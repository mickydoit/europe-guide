// Usage: node tools/probe-screens.mjs <fragFile> <outDir> [baseUrl] [tripSlug] [date]
// Default base: http://localhost:5173/europe-guide (run `npx vite preview --port 5173` first).
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
const [,, fragFile, outDir, base = 'http://localhost:5173/europe-guide', trip = 'seville', date = '2026-10-05'] = process.argv
const frag = readFileSync(fragFile, 'utf8').trim()
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME ?? '/Users/michaeldewet/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage(); const log = []
page.on('pageerror', e => log.push('[pageerror] ' + e.message))
await page.goto(`${base}/reset#${frag}`, { waitUntil: 'load' }); await page.waitForTimeout(2500)
const shots = [
  ['home', `/?trip=${trip}`], ['day', `/day/${date}?trip=${trip}`], ['tickets', `/tickets?trip=${trip}`], ['more', `/more?trip=${trip}`], ['map', `/map/${date}?trip=${trip}`],
]
for (const [name, path] of shots) {
  await page.goto(base + path, { waitUntil: 'load' }); await page.waitForTimeout(name === 'map' ? 7000 : name === 'day' ? 4000 : 12000)   // photos: each card downloads its own image first
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: name !== 'map' })
  log.push(`${name}: ${page.url()}`)
}
// First ticket and first place from the Tickets and Day screens
await page.goto(`${base}/tickets?trip=${trip}`, { waitUntil: 'load' }); await page.waitForTimeout(2000)
// The app now writes ?trip= into its own /ticket and /place links (a cold full-page load
// re-resolves the trip from the query string), so use the href as-is and only append when
// an older build's link arrives without it.
const withTrip = h => (h.includes('trip=') ? h : `${h}?trip=${trip}`)
const ticket = await page.locator('a.ticket-card__link').first().getAttribute('href'); if (ticket) { await page.goto(base + withTrip(ticket.replace('/europe-guide', '')), { waitUntil: 'load' }); await page.waitForTimeout(8000); await page.screenshot({ path: `${outDir}/ticket.png`, fullPage: true }) }
await page.goto(`${base}/day/${date}?trip=${trip}`, { waitUntil: 'load' }); await page.waitForTimeout(2000)
const place = await page.locator('a.stop-row__main').first().getAttribute('href'); if (place) { await page.goto(base + withTrip(place.replace('/europe-guide', '')), { waitUntil: 'load' }); await page.waitForTimeout(8000); await page.screenshot({ path: `${outDir}/place.png`, fullPage: true }) }
console.log(log.join('\n')); await browser.close()
