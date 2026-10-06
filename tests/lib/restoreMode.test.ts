import { test, expect, beforeEach } from 'vitest'
import { getRestoreMode, setRestoreMode, RESTORE_MODE_KEY, DEFAULT_RESTORE_MODE } from '../../src/lib/restoreMode'

beforeEach(() => localStorage.clear())

test('defaults to immediate, round-trips a chosen mode, and ignores junk', () => {
  expect(getRestoreMode()).toBe(DEFAULT_RESTORE_MODE)
  setRestoreMode('deferred')
  expect(getRestoreMode()).toBe('deferred')
  expect(localStorage.getItem(RESTORE_MODE_KEY)).toBe('deferred')
  localStorage.setItem(RESTORE_MODE_KEY, 'sideways')
  expect(getRestoreMode()).toBe('immediate')
})
