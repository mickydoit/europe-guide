import { describe, it, expect } from 'vitest'
import { loadValle } from '../helpers/content'
import {
  nowInTz, minutesOf, fmtTime, currentBlock, currentAndNext, fmtDay, fmtCountdown, dayIndex, isToday, todayInTrip,
} from '../../src/lib/time'
import type { AlertRow } from '../../src/lib/types'

describe('nowInTz', () => {
  it('resolves Lisbon local time from a UTC instant (UTC+1 in Sept)', () => {
    expect(nowInTz('Europe/Lisbon', new Date('2026-09-30T08:15:00Z')))
      .toEqual({ date: '2026-09-30', minutes: 9 * 60 + 15, hhmm: '09:15' })
  })
  it('resolves Istanbul local time from the same instant (UTC+3)', () => {
    expect(nowInTz('Europe/Istanbul', new Date('2026-09-30T08:15:00Z')))
      .toEqual({ date: '2026-09-30', minutes: 11 * 60 + 15, hhmm: '11:15' })
  })
})

describe('minutesOf', () => {
  it('converts hh:mm to minutes since midnight', () => {
    expect(minutesOf('00:00')).toBe(0)
    expect(minutesOf('09:15')).toBe(555)
    expect(minutesOf('23:59')).toBe(1439)
  })
})

describe('fmtTime', () => {
  it('formats an exact time', () => { expect(fmtTime('08:00', null)).toBe('08:00') })
  it('normalises a Postgres HH:MM:SS time to HH:MM', () => { expect(fmtTime('09:15:00', null)).toBe('09:15') })
  it('formats an approximate time when text starts with ~', () => { expect(fmtTime(null, '~18:00')).toBe('~18:00') })
  it('formats an em-dash when both are null', () => { expect(fmtTime(null, null)).toBe('—') })
  it('falls back to text otherwise', () => { expect(fmtTime(null, 'Evening')).toBe('Evening') })
})

describe('currentBlock', () => {
  it('is morning before 11:30 (600 < 690)', () => { expect(currentBlock(600)).toBe('morning') })
  it('is midday between 11:30 and 17:00 (720)', () => { expect(currentBlock(720)).toBe('midday') })
  it('is evening at/after 17:00 (1100)', () => { expect(currentBlock(1100)).toBe('evening') })
  it('boundary: 689 is morning, 690 is midday', () => {
    expect(currentBlock(689)).toBe('morning')
    expect(currentBlock(690)).toBe('midday')
  })
  it('boundary: 1019 is midday, 1020 is evening', () => {
    expect(currentBlock(1019)).toBe('midday')
    expect(currentBlock(1020)).toBe('evening')
  })
})

describe('currentAndNext', () => {
  it('on Valle Monday at 09:00, next is the 09:15 alert, minutesToNext 15, current null', async () => {
    const { alerts } = await loadValle()
    const result = currentAndNext(alerts, '2026-11-02', 9 * 60)
    expect(result.current).toBeNull()
    expect(result.next?.time).toBe('09:15')
    expect(result.next?.text).toContain('now')
    expect(result.minutesToNext).toBe(15)
  })
  it('on Valle Monday at 09:15, current is the 09:15 alert and next is the same day\'s 20:00 alert', async () => {
    const { alerts } = await loadValle()
    const result = currentAndNext(alerts, '2026-11-02', 9 * 60 + 15)
    expect(result.current?.time).toBe('09:15')
    expect(result.next?.time).toBe('20:00')
    expect(result.minutesToNext).toBe(20 * 60 - (9 * 60 + 15))
  })
  it('on Valle Monday after the last alert, there is no next (no further timed alerts in fixture)', async () => {
    const { alerts } = await loadValle()
    const result = currentAndNext(alerts, '2026-11-02', 21 * 60)
    expect(result.current?.time).toBe('20:00')
    expect(result.next).toBeNull()
    expect(result.minutesToNext).toBeNull()
  })
  it('on Valle Sunday, the untimed "—" alert never becomes current, and next rolls forward to Monday\'s first timed alert', async () => {
    const { alerts } = await loadValle()
    const result = currentAndNext(alerts, '2026-11-01', 0)
    expect(result.current).toBeNull()
    expect(result.next?.time).toBe('09:15')
    // dayGap = 1 (Nov 1 -> Nov 2); minutesToNext = (1440-0) + 555 + 1440*(1-1)
    expect(result.minutesToNext).toBe(24 * 60 + minutesOf('09:15'))
  })
  it('spans midnight into the next date, computing minutesToNext across the gap', () => {
    const alerts: AlertRow[] = [
      { trip: 'x', date: '2026-11-02', seq: 0, time: '22:30', text: 'late one' },
      { trip: 'x', date: '2026-11-03', seq: 0, time: '06:30', text: 'early one' },
    ]
    const result = currentAndNext(alerts, '2026-11-02', 23 * 60)
    expect(result.current?.time).toBe('22:30')
    expect(result.next?.time).toBe('06:30')
    expect(result.minutesToNext).toBe(450)
  })
  it('spans multiple days when the next date with a timed alert is further ahead', () => {
    const alerts: AlertRow[] = [
      { trip: 'x', date: '2026-11-02', seq: 0, time: '22:30', text: 'late one' },
      { trip: 'x', date: '2026-11-04', seq: 0, time: '06:30', text: 'far one' },
    ]
    const result = currentAndNext(alerts, '2026-11-02', 23 * 60)
    expect(result.next?.time).toBe('06:30')
    // dayGap = 2 (Nov 2 -> Nov 4); minutesToNext = (1440-1380) + 390 + 1440*(2-1)
    expect(result.minutesToNext).toBe((24 * 60 - 23 * 60) + minutesOf('06:30') + 24 * 60 * (2 - 1))
  })
})

describe('fmtCountdown', () => {
  it('is "now" at or below zero', () => {
    expect(fmtCountdown(0)).toBe('now')
    expect(fmtCountdown(-5)).toBe('now')
  })
  it('is "in N min" under an hour', () => { expect(fmtCountdown(12)).toBe('in 12 min') })
  it('is "in H h MM" at an hour or more, minutes zero-padded', () => {
    expect(fmtCountdown(125)).toBe('in 2 h 05')
    expect(fmtCountdown(60)).toBe('in 1 h 00')
  })
})

describe('fmtDay', () => {
  it('formats an ISO date as a UTC weekday + day + month', () => {
    expect(fmtDay('2026-09-30')).toBe('Wednesday 30 September')
  })
  it('matches the Valle Monday date', () => {
    expect(fmtDay('2026-11-02')).toBe('Monday 2 November')
  })
})

describe('dayIndex', () => {
  it('finds the index of a date among days', async () => {
    const { days } = await loadValle()
    expect(dayIndex(days, '2026-11-02')).toBe(days.findIndex(d => d.date === '2026-11-02'))
  })
  it('returns -1 when the date is absent', async () => {
    const { days } = await loadValle()
    expect(dayIndex(days, '2099-01-01')).toBe(-1)
  })
})

describe('isToday / todayInTrip', () => {
  it('isToday is true when the tz-local date matches', async () => {
    const { trip } = await loadValle()
    const at = new Date('2026-11-02T08:00:00Z') // Rome is UTC+1 in Nov -> 09:00 local, still Nov 2
    expect(isToday(trip, '2026-11-02', at)).toBe(true)
    expect(isToday(trip, '2026-11-01', at)).toBe(false)
  })
  it('todayInTrip returns the tz-local date when within [start_date, end_date]', async () => {
    const { trip } = await loadValle()
    const at = new Date('2026-11-02T08:00:00Z')
    expect(todayInTrip(trip, at)).toBe('2026-11-02')
  })
  it('todayInTrip returns null when outside the trip range', async () => {
    const { trip } = await loadValle()
    const at = new Date('2026-12-25T08:00:00Z')
    expect(todayInTrip(trip, at)).toBeNull()
  })
})
