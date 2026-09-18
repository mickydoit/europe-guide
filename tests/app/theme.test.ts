import { readFileSync, existsSync } from 'node:fs'
import { test, expect } from 'vitest'

const tokens = readFileSync('src/styles/tokens.css', 'utf8')
const base = readFileSync('src/styles/base.css', 'utf8')

test('tokens carry the Figma palette', () => {
  for (const v of ['--bg: #070606', '--surface: #08353D', '--accent: #22DD85', '--highlight: #F7FF88', '--lavender: #BCA5ED']) {
    expect(tokens).toContain(v)
  }
  expect(tokens).toMatch(/--font: 'Overpass'/)
  expect(tokens).toMatch(/--font-ticket: 'Poppins'/)
  expect(tokens).toMatch(/--radius-card: 24px/)
})

test('fonts are self-hosted and declared', () => {
  for (const f of ['overpass-variable', 'poppins-500', 'poppins-700']) expect(existsSync(`public/fonts/${f}.woff2`)).toBe(true)
  expect(base).toMatch(/@font-face\s*\{[^}]*font-family: 'Overpass'[^}]*font-weight: 100 900/)
  expect(base).toMatch(/@font-face\s*\{[^}]*font-family: 'Poppins'[^}]*font-weight: 700/)
})

test('nav and kind icons exist', () => {
  for (const n of ['home', 'calendar', 'map', 'suitcase', 'profile']) expect(existsSync(`public/icons/nav/${n}.svg`)).toBe(true)
  for (const n of ['plane', 'car', 'train', 'hotel', 'event', 'meal']) {
    expect(existsSync(`public/icons/kind/${n}.svg`)).toBe(true)
    expect(existsSync(`public/icons/badge/${n}.svg`)).toBe(true)
  }
})

test('workbox precaches woff2', () => {
  expect(readFileSync('vite.config.ts', 'utf8')).toMatch(/globPatterns: \['\*\*\/\*\.\{[^}]*woff2/)
})
