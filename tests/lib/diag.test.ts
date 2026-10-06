import { describe, test, expect, beforeEach } from 'vitest'
import { diag, readDiag, clearDiag, DIAG_KEY, MAX_LINES } from '../../src/lib/diag'

/**
 * A field-only bug ("sometimes nothing on the phone responds to a tap") cannot be reproduced on
 * a laptop. The app keeps a short, persistent log of the things that could explain it — restores
 * starting and ending, the page being hidden and shown, windows being opened, touches being
 * cancelled — so the owner can show it the next time it happens.
 */
describe('diag', () => {
  beforeEach(() => { localStorage.clear() })

  test('lines are appended with a time and survive a reload', () => {
    diag('restore', 'start /tickets y=480')
    diag('restore', 'settled')
    const lines = readDiag()
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^\d{2}:\d{2}:\d{2} restore start \/tickets y=480$/)
    expect(JSON.parse(localStorage.getItem(DIAG_KEY)!)).toHaveLength(2)
  })

  test('keeps only the most recent MAX_LINES lines', () => {
    for (let i = 0; i < MAX_LINES + 10; i++) diag('touchcancel', `#${i}`)
    const lines = readDiag()
    expect(lines).toHaveLength(MAX_LINES)
    expect(lines[0]).toContain('#10')
    expect(lines[MAX_LINES - 1]).toContain(`#${MAX_LINES + 9}`)
  })

  test('clear empties it', () => {
    diag('visibility', 'hidden')
    clearDiag()
    expect(readDiag()).toEqual([])
  })

  test('a broken store is treated as empty, never thrown', () => {
    localStorage.setItem(DIAG_KEY, '{oops')
    expect(readDiag()).toEqual([])
    diag('restore', 'after corruption')
    expect(readDiag()).toHaveLength(1)
  })
})
