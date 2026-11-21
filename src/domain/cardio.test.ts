import { describe, expect, it } from 'vitest'
import { cardioTarget, isLegDay, lowerBodySharePct, suggestedCardioModality } from './cardio'
import { addDays } from './dates'
import { DEFAULT_SETTINGS } from './settings/registry'
import type { LocalDate, Session } from './types'

const d = (s: string) => s as LocalDate
const S = DEFAULT_SETTINGS // weeks start on trainingWeekStartDay

type Row = Pick<Session, 'id' | 'date' | 'status' | 'voidedAt'>
let n = 0
/** One finished workout per date with that much cardio. */
function history(days: readonly (readonly [string, number])[]) {
  const sessions: Row[] = []
  const logs: { sessionId: string; minutes: number; voidedAt: number | null }[] = []
  for (const [date, minutes] of days) {
    const id = `s${++n}`
    sessions.push({ id, date: d(date), status: 'finished', voidedAt: null })
    if (minutes > 0) logs.push({ sessionId: id, minutes, voidedAt: null })
  }
  return { sessions, logs }
}

// 2026-11-23 is a Monday; trainingWeekStartDay defaults to Monday (1).
const WEEK1 = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-27', '2026-11-28']
const WEEK2 = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-04', '2026-12-05']

describe('cardioTarget', () => {
  it('starts at 10 minutes with no history', () => {
    expect(S.trainingWeekStartDay).toBe(1)
    expect(cardioTarget({ sessions: [], logs: [] }, d('2026-11-24'), S)).toEqual({
      minutes: 10,
      weekStart: '2026-11-23',
      sessionsAtTarget: 0,
      sessionsNeeded: 3,
      nextMinutes: 15,
      atMax: false,
    })
  })

  it('rises 5 minutes after a week with 3 workouts at the target, counting this week so far', () => {
    const h = history([
      [WEEK1[0]!, 10],
      [WEEK1[1]!, 12],
      [WEEK1[2]!, 10],
      [WEEK2[0]!, 15],
    ])
    expect(cardioTarget(h, d('2026-11-28'), S)).toMatchObject({ minutes: 10, sessionsAtTarget: 3 })
    expect(cardioTarget(h, d('2026-12-01'), S)).toMatchObject({
      minutes: 15,
      weekStart: '2026-11-30',
      sessionsAtTarget: 1,
    })
  })

  it('holds after a week short of the target or a week off, and never drops', () => {
    const h = history([
      ...WEEK1.slice(0, 3).map((x) => [x, 10] as const),
      // Week 2: only two sessions reach 15.
      [WEEK2[0]!, 15],
      [WEEK2[1]!, 14],
      [WEEK2[2]!, 15],
    ])
    expect(cardioTarget(h, d('2026-12-08'), S).minutes).toBe(15)
    // A week with no cardio at all (12-07) and then the next one: still 15.
    expect(cardioTarget(h, d('2026-12-15'), S).minutes).toBe(15)
  })

  it('caps at 30 minutes', () => {
    const days: [string, number][] = []
    for (let w = 0; w < 8; w++)
      for (const day of [0, 1, 2]) {
        days.push([addDays(d('2026-11-23'), 7 * w + day), 30])
      }
    const t = cardioTarget(history(days), d('2027-01-25'), S)
    expect(t).toMatchObject({ minutes: 30, nextMinutes: 30, atMax: true })
  })

  it('adds up several cardio entries in one workout, and ignores voided, abandoned and voided-session cardio', () => {
    const h = history(WEEK1.slice(0, 3).map((x) => [x, 6] as const))
    // A second 6-minute entry after each workout → 12 minutes each.
    for (const s of h.sessions) h.logs.push({ sessionId: s.id, minutes: 6, voidedAt: null })
    expect(cardioTarget(h, d('2026-12-01'), S).minutes).toBe(15)
    h.logs[0] = { ...h.logs[0]!, voidedAt: 1 }
    expect(cardioTarget(h, d('2026-12-01'), S).minutes).toBe(10)
    const abandoned = history(WEEK1.slice(0, 3).map((x) => [x, 10] as const))
    abandoned.sessions[0] = { ...abandoned.sessions[0]!, status: 'abandoned' }
    abandoned.sessions[1] = { ...abandoned.sessions[1]!, voidedAt: 5 }
    expect(cardioTarget(abandoned, d('2026-12-01'), S).minutes).toBe(10)
  })

  it('follows the settings', () => {
    const h = history(WEEK1.slice(0, 2).map((x) => [x, 20] as const))
    const s = {
      ...S,
      cardioStartMin: 20,
      cardioStepMin: 10,
      cardioMaxMin: 25,
      cardioAdvanceSessions: 2,
    }
    expect(cardioTarget(h, d('2026-12-01'), s)).toMatchObject({ minutes: 25, atMax: true })
  })
})

describe('suggestedCardioModality', () => {
  const lower = new Map([
    ['quads', 7],
    ['hamstrings', 6],
    ['abs', 3],
  ])
  const upper = new Map([
    ['chest', 8],
    ['triceps', 5],
    ['quads', 0],
  ])
  it('suggests the bike on a mostly lower-body day', () => {
    expect(suggestedCardioModality(lower, 'incline_walk', S)).toBe('bike')
  })
  it('otherwise repeats the last machine, or an incline walk', () => {
    expect(suggestedCardioModality(upper, 'elliptical', S)).toBe('elliptical')
    expect(suggestedCardioModality(upper, null, S)).toBe('incline_walk')
    expect(suggestedCardioModality(null, null, S)).toBe('incline_walk')
    expect(suggestedCardioModality(new Map(), 'rower', S)).toBe('rower')
  })
  it('works out the lower-body share', () => {
    expect(lowerBodySharePct(lower)).toBeCloseTo(81.25, 9)
    expect(lowerBodySharePct(new Map())).toBeNull()
    expect([isLegDay(lower, S), isLegDay(upper, S), isLegDay(null, S)]).toEqual([
      true,
      false,
      false,
    ])
  })

  it('uses the leg-share setting', () => {
    expect(suggestedCardioModality(lower, null, { cardioBikeLegSharePct: 90 })).toBe('incline_walk')
  })
})
