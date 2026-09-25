import { describe, expect, it } from 'vitest'
import {
  addDays,
  ageOn,
  compareLocalDate,
  dateRange,
  dayNumber,
  daysBetween,
  fromDayNumber,
  isLocalDate,
  localDateOf,
  parseLocalDate,
  weekday,
  weekStart,
} from './dates'

const d = parseLocalDate

describe('parseLocalDate', () => {
  it('accepts real dates and rejects malformed or impossible ones', () => {
    expect(d('2026-09-24')).toBe('2026-09-24')
    expect(isLocalDate('2028-02-29')).toBe(true)
    expect(isLocalDate('2026-02-29')).toBe(false)
    expect(isLocalDate('2026-13-01')).toBe(false)
    expect(isLocalDate('2026-9-24')).toBe(false)
    expect(() => d('24/09/2026')).toThrow(RangeError)
  })
})

describe('day arithmetic', () => {
  it('round-trips day numbers', () => {
    expect(dayNumber(d('1970-01-01'))).toBe(0)
    expect(fromDayNumber(dayNumber(d('2026-09-24')))).toBe('2026-09-24')
  })

  it('adds days across month, year and DST boundaries', () => {
    expect(addDays(d('2026-09-24'), 7)).toBe('2026-10-01')
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01')
    expect(addDays(d('2026-03-08'), 1)).toBe('2026-03-09') // US DST start
    expect(addDays(d('2026-11-01'), -1)).toBe('2026-10-31') // US DST end
    expect(daysBetween(d('2026-09-24'), d('2026-10-08'))).toBe(14)
  })

  it('lists an inclusive range', () => {
    expect(dateRange(d('2026-09-29'), d('2026-10-02'))).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ])
    expect(dateRange(d('2026-10-02'), d('2026-10-01'))).toEqual([])
  })

  it('compares', () => {
    expect(compareLocalDate(d('2026-09-24'), d('2026-09-25'))).toBe(-1)
    expect(compareLocalDate(d('2026-09-25'), d('2026-09-25'))).toBe(0)
  })
})

describe('weekdays and weeks', () => {
  it('computes weekday (0 = Sunday)', () => {
    expect(weekday(d('2026-09-24'))).toBe(4) // Thursday
    expect(weekday(d('2026-09-27'))).toBe(0) // Sunday
    expect(weekday(d('1969-12-31'))).toBe(3) // Wednesday, before the epoch
  })

  it('finds the Monday-start week', () => {
    expect(weekStart(d('2026-09-24'), 1)).toBe('2026-09-21')
    expect(weekStart(d('2026-09-21'), 1)).toBe('2026-09-21')
    expect(weekStart(d('2026-09-27'), 1)).toBe('2026-09-21')
    expect(weekStart(d('2026-09-27'), 0)).toBe('2026-09-27')
  })
})

describe('localDateOf', () => {
  it('uses the local calendar date', () => {
    const localNoon = new Date(2026, 8, 24, 12, 0, 0).getTime()
    expect(localDateOf(localNoon)).toBe('2026-09-24')
    const localLate = new Date(2026, 8, 24, 23, 59, 0).getTime()
    expect(localDateOf(localLate)).toBe('2026-09-24')
  })
})

describe('ageOn', () => {
  const profile = { ageYears: 22, ageAsOf: d('2026-09-24'), birthDate: null }

  it('advances the stored age by whole years', () => {
    expect(ageOn(profile, d('2026-09-24'))).toBe(22)
    expect(ageOn(profile, d('2027-09-23'))).toBe(22)
    expect(ageOn(profile, d('2027-09-24'))).toBe(23)
  })

  it('prefers the birth date', () => {
    expect(ageOn({ ...profile, birthDate: d('2004-03-01') }, d('2026-09-24'))).toBe(22)
    expect(ageOn({ ...profile, birthDate: d('2004-10-01') }, d('2026-09-24'))).toBe(21)
  })
})
