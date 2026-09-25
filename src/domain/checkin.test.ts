import { describe, expect, it } from 'vitest'
import { parseLocalDate } from '@/domain/dates'
import { rateBand } from '@/domain/nutritionTargets'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import type { PhaseType, Settings } from '@/domain/types'
import {
  checkinSchedule,
  evaluateCheckin,
  missDirection,
  missStreak,
  resetWeekIndex,
  type CheckinInput,
  type WeekMiss,
} from './checkin'

const d = parseLocalDate
const s = DEFAULT_SETTINGS
const BULK = rateBand('bulk', s) // +0.25 … +0.5
const CUT = rateBand('cut', s) // −0.75 … −0.5
const MAINT = rateBand('maintenance', s) // −0.25 … +0.25

function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    Object.values(x).forEach(deepFreeze)
    Object.freeze(x)
  }
  return x
}

describe('checkinSchedule', () => {
  const start = d('2026-10-01')

  it('is due every 7 days from the phase start, up to the as-of date', () => {
    expect(checkinSchedule(start, d('2026-10-07'))).toEqual([])
    expect(checkinSchedule(start, d('2026-10-08'))).toEqual([
      { weekIndex: 1, dueDate: '2026-10-08' },
    ])
    expect(checkinSchedule(start, d('2026-10-30'))).toEqual([
      { weekIndex: 1, dueDate: '2026-10-08' },
      { weekIndex: 2, dueDate: '2026-10-15' },
      { weekIndex: 3, dueDate: '2026-10-22' },
      { weekIndex: 4, dueDate: '2026-10-29' },
    ])
    expect(checkinSchedule(start, d('2026-09-01'))).toEqual([])
  })

  it('keeps a 7-day cadence across DST changes', () => {
    expect(checkinSchedule(d('2026-10-25'), d('2026-11-08')).map((w) => w.dueDate)).toEqual([
      '2026-11-01',
      '2026-11-08',
    ])
    expect(checkinSchedule(d('2026-03-01'), d('2026-03-15')).map((w) => w.dueDate)).toEqual([
      '2026-03-08',
      '2026-03-15',
    ])
  })

  it('accepts an empty pause list and rejects pauses until diet breaks exist', () => {
    expect(checkinSchedule(start, d('2026-10-08'), [])).toHaveLength(1)
    expect(() =>
      checkinSchedule(start, d('2026-10-30'), [
        { startDate: d('2026-10-10'), endDate: d('2026-10-16') },
      ]),
    ).toThrow(RangeError)
  })
})

describe('missDirection', () => {
  it('flags a bulk below or above +0.25…+0.5, with the edges in band', () => {
    expect(missDirection(0.1, BULK)).toBe('low')
    expect(missDirection(0.25, BULK)).toBeNull()
    expect(missDirection(0.5, BULK)).toBeNull()
    expect(missDirection(0.6, BULK)).toBe('high')
  })

  it('uses the numeric order for a cut band stored as −0.75 < −0.5', () => {
    expect(CUT).toEqual({ minPct: -0.75, maxPct: -0.5 })
    expect(missDirection(-1, CUT)).toBe('low') // losing too fast
    expect(missDirection(-0.3, CUT)).toBe('high') // losing too slowly
    expect(missDirection(0.2, CUT)).toBe('high') // gaining on a cut
    expect(missDirection(-0.6, CUT)).toBeNull()
    expect(missDirection(-0.75, CUT)).toBeNull()
    expect(missDirection(-0.3, { minPct: -0.5, maxPct: -0.75 })).toBe('high')
  })

  it('flags maintenance outside ±0.25', () => {
    expect(missDirection(-0.3, MAINT)).toBe('low')
    expect(missDirection(0.3, MAINT)).toBe('high')
    expect(missDirection(0, MAINT)).toBeNull()
  })
})

describe('missStreak', () => {
  const w = (weekIndex: number, direction: WeekMiss['direction']): WeekMiss => ({
    weekIndex,
    direction,
  })

  it('counts consecutive same-direction misses ending at the latest week, excluding week 1', () => {
    expect(missStreak([w(1, 'low'), w(2, 'low'), w(3, 'low')], 0, s)).toEqual({
      direction: 'low',
      count: 2,
    })
    expect(missStreak([w(3, 'low'), w(1, 'low'), w(2, 'low')], 0, s).count).toBe(2)
  })

  it('breaks on a change of direction, an in-band or no-data week, or a missing week', () => {
    expect(missStreak([w(2, 'low'), w(3, 'high')], 0, s)).toEqual({ direction: 'high', count: 1 })
    expect(missStreak([w(2, 'low'), w(3, null)], 0, s)).toEqual({ direction: null, count: 0 })
    expect(missStreak([w(2, 'low'), w(3, null), w(4, 'low')], 0, s).count).toBe(1)
    expect(missStreak([w(2, 'low'), w(4, 'low')], 0, s).count).toBe(1)
    expect(missStreak([], 0, s)).toEqual({ direction: null, count: 0 })
  })

  it('ignores weeks up to the last accepted or manual change', () => {
    const weeks = [w(2, 'low'), w(3, 'low'), w(4, 'low')]
    expect(missStreak(weeks, 3, s)).toEqual({ direction: 'low', count: 1 })
    expect(missStreak(weeks, 4, s)).toEqual({ direction: null, count: 0 })
    // A skipped suggestion is not a reset: the caller keeps the previous reset index.
    expect(missStreak(weeks, 0, s).count).toBe(3)
  })

  it('follows the no-change-weeks setting', () => {
    const weeks = [w(1, 'high'), w(2, 'high'), w(3, 'high')]
    expect(missStreak(weeks, 0, { ...s, checkinNoChangeWeeks: 2 }).count).toBe(1)
    expect(missStreak(weeks, 0, { ...s, checkinNoChangeWeeks: 0 }).count).toBe(3)
  })
})

describe('resetWeekIndex', () => {
  const start = d('2026-10-01')

  it('maps a change accepted at week k (effective the next day) to k', () => {
    expect(resetWeekIndex(start, d('2026-10-16'))).toBe(2)
    expect(resetWeekIndex(start, d('2026-10-09'))).toBe(1)
  })

  it('ignores the whole week a mid-week manual change falls in', () => {
    expect(resetWeekIndex(start, d('2026-10-15'))).toBe(2)
    expect(resetWeekIndex(start, d('2026-10-18'))).toBe(3)
  })

  it('is 0 at or before the phase start', () => {
    expect(resetWeekIndex(start, d('2026-10-01'))).toBe(0)
    expect(resetWeekIndex(start, d('2026-10-02'))).toBe(0)
    expect(resetWeekIndex(start, d('2026-09-20'))).toBe(0)
  })
})

describe('evaluateCheckin', () => {
  function input(
    phaseType: PhaseType,
    weekIndex: number,
    ratePct: number | null,
    priorWeeks: WeekMiss[] = [],
    lastResetWeekIndex = 0,
  ): CheckinInput {
    return deepFreeze({
      phaseType,
      band: rateBand(phaseType, s),
      weekIndex,
      ratePct,
      priorWeeks,
      lastResetWeekIndex,
    })
  }
  const lowBefore = [{ weekIndex: 2, direction: 'low' as const }]
  const highBefore = [{ weekIndex: 2, direction: 'high' as const }]

  it('suggests no calorie change in the first week of a phase (acceptance)', () => {
    for (const [type, rate] of [
      ['bulk', 2],
      ['cut', -3],
      ['maintenance', 1],
    ] as const) {
      expect(evaluateCheckin(input(type, 1, rate), s)).toMatchObject({
        suggestionType: 'none_first_week',
        suggestedKcalChange: 0,
        stepsAlternative: null,
        missStreak: 0,
      })
    }
  })

  it('makes no suggestion without a trend rate or inside the band', () => {
    expect(evaluateCheckin(input('bulk', 3, null, lowBefore), s)).toMatchObject({
      suggestionType: 'none_insufficient',
      suggestedKcalChange: 0,
      missDirection: null,
    })
    expect(evaluateCheckin(input('bulk', 3, 0.4, lowBefore), s)).toMatchObject({
      suggestionType: 'none_in_band',
      suggestedKcalChange: 0,
      missStreak: 0,
    })
  })

  it('waits for two same-direction misses; a week-1 miss does not count', () => {
    const second = evaluateCheckin(input('bulk', 2, 0.1, [{ weekIndex: 1, direction: 'low' }]), s)
    expect(second).toMatchObject({
      suggestionType: 'none_streak',
      suggestedKcalChange: 0,
      missDirection: 'low',
      missStreak: 1,
    })
    expect(evaluateCheckin(input('bulk', 3, 0.7, lowBefore), s)).toMatchObject({
      suggestionType: 'none_streak',
      missDirection: 'high',
      missStreak: 1,
    })
  })

  it('adds 150 on a bulk gaining too slowly and removes 150 when gaining too fast', () => {
    expect(evaluateCheckin(input('bulk', 3, 0.1, lowBefore), s)).toEqual({
      suggestionType: 'kcal_change',
      suggestedKcalChange: 150,
      stepsAlternative: null,
      missDirection: 'low',
      missStreak: 2,
    })
    expect(evaluateCheckin(input('bulk', 3, 0.7, highBefore), s)).toMatchObject({
      suggestedKcalChange: -150,
      stepsAlternative: null,
    })
  })

  it('adds 150 on a cut losing too fast; removes 150 or offers 2,000 steps when too slow', () => {
    expect(evaluateCheckin(input('cut', 3, -1, lowBefore), s)).toMatchObject({
      suggestionType: 'kcal_change',
      suggestedKcalChange: 150,
      stepsAlternative: null,
    })
    expect(evaluateCheckin(input('cut', 3, -0.3, highBefore), s)).toMatchObject({
      suggestionType: 'kcal_change',
      suggestedKcalChange: -150,
      stepsAlternative: 2000,
      missDirection: 'high',
    })
  })

  it('moves maintenance 100 back toward zero change', () => {
    expect(evaluateCheckin(input('maintenance', 3, 0.4, highBefore), s)).toMatchObject({
      suggestedKcalChange: -100,
      stepsAlternative: null,
    })
    expect(evaluateCheckin(input('maintenance', 3, -0.4, lowBefore), s)).toMatchObject({
      suggestedKcalChange: 100,
    })
  })

  it('needs two fresh misses after an accepted change, but not after a skip', () => {
    const history = [
      { weekIndex: 2, direction: 'low' as const },
      { weekIndex: 3, direction: 'low' as const }, // change accepted here
    ]
    expect(evaluateCheckin(input('bulk', 4, 0.1, history, 3), s).suggestionType).toBe('none_streak')
    const withWeek4 = [...history, { weekIndex: 4, direction: 'low' as const }]
    expect(evaluateCheckin(input('bulk', 5, 0.1, withWeek4, 3), s)).toMatchObject({
      suggestionType: 'kcal_change',
      missStreak: 2,
    })
    // Week 3's suggestion skipped: no reset, so week 4 continues the streak.
    expect(evaluateCheckin(input('bulk', 4, 0.1, history, 0), s)).toMatchObject({
      suggestionType: 'kcal_change',
      missStreak: 3,
    })
  })

  it('replaces an earlier snapshot of the same week', () => {
    const prior = [
      { weekIndex: 2, direction: 'low' as const },
      { weekIndex: 3, direction: 'high' as const },
    ]
    expect(evaluateCheckin(input('bulk', 3, 0.1, prior), s)).toMatchObject({
      suggestionType: 'kcal_change',
      missStreak: 2,
    })
  })

  it('follows the check-in settings', () => {
    const custom: Settings = {
      ...s,
      checkinMissesRequired: 1,
      checkinNoChangeWeeks: 0,
      checkinStepKcal: 100,
      checkinMaintStepKcal: 50,
      cutStepsAlternative: 3000,
    }
    expect(evaluateCheckin(input('bulk', 1, 0.1), custom)).toMatchObject({
      suggestionType: 'kcal_change',
      suggestedKcalChange: 100,
    })
    expect(evaluateCheckin(input('cut', 1, -0.2), custom)).toMatchObject({
      suggestedKcalChange: -100,
      stepsAlternative: 3000,
    })
    expect(evaluateCheckin(input('maintenance', 1, 0.5), custom).suggestedKcalChange).toBe(-50)
    const twoQuiet: Settings = { ...s, checkinNoChangeWeeks: 2 }
    expect(evaluateCheckin(input('bulk', 2, 0.1, lowBefore), twoQuiet).suggestionType).toBe(
      'none_first_week',
    )
  })
})
