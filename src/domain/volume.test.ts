import { describe, expect, it } from 'vitest'
import { parseLocalDate } from './dates'
import { DEFAULT_SETTINGS } from './settings/registry'
import type { EpochMs, Muscle, MuscleWeights, SessionStatus } from './types'
import {
  countsTowardVolume,
  countWorkingSets,
  loggedSessionVolume,
  muscleFlags,
  overSessionCap,
  plannedDayVolume,
  plannedWeeklyVolume,
  resolveBand,
  volumeFlag,
  weeklyLoggedVolume,
  type LoggedSession,
  type MuscleVolume,
  type VolumeTotals,
} from './volume'

const d = parseLocalDate

function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x)
    for (const v of Object.values(x)) deepFreeze(v)
  }
  return x
}

const obj = (m: MuscleVolume) => Object.fromEntries(m)

const WEIGHTS: Readonly<Record<string, MuscleWeights>> = {
  'ex-squat': { quads: 1, glutes: 0.5 },
  'ex-curl': { biceps: 1 },
  'ex-one-arm-ext': { triceps: 1 },
  'ex-press': { chest: 1, front_delts: 0.5, triceps: 0.5 },
}

interface TestSlot {
  id: string
  programDayId: string
  defaultExerciseId: string
  gymExerciseId?: string
  sets: number
  archivedAt: EpochMs | null
}

function slot(
  id: string,
  day: string,
  exerciseId: string,
  sets: number,
  archivedAt: EpochMs | null = null,
): TestSlot {
  return { id, programDayId: day, defaultExerciseId: exerciseId, sets, archivedAt }
}

const byDefault = (s: TestSlot) => {
  const muscleWeights = WEIGHTS[s.defaultExerciseId]
  return muscleWeights && { muscleWeights }
}

describe('plannedWeeklyVolume', () => {
  it('sums sets × weight per muscle and counts every set once', () => {
    const v = plannedWeeklyVolume(
      [
        slot('a', 'day-1', 'ex-squat', 4),
        slot('b', 'day-2', 'ex-curl', 3),
        slot('c', 'day-2', 'ex-press', 3),
      ],
      byDefault,
    )
    expect(obj(v.byMuscle)).toEqual({
      quads: 4,
      glutes: 2,
      biceps: 3,
      chest: 3,
      front_delts: 1.5,
      triceps: 1.5,
    })
    expect(v.totalSets).toBe(10)
  })

  it('adds up a muscle trained by several slots', () => {
    const v = plannedWeeklyVolume(
      [slot('a', 'day-1', 'ex-press', 3), slot('b', 'day-1', 'ex-one-arm-ext', 3)],
      byDefault,
    )
    expect(v.byMuscle.get('triceps')).toBe(4.5)
  })

  it('counts a unilateral set once, not once per side', () => {
    const v = plannedWeeklyVolume([slot('a', 'day-1', 'ex-one-arm-ext', 3)], byDefault)
    expect(obj(v.byMuscle)).toEqual({ triceps: 3 })
    expect(v.totalSets).toBe(3)
  })

  it('skips archived slots', () => {
    const v = plannedWeeklyVolume(
      [slot('a', 'day-1', 'ex-squat', 4), slot('b', 'day-1', 'ex-curl', 3, 1_000)],
      byDefault,
    )
    expect(obj(v.byMuscle)).toEqual({ quads: 4, glutes: 2 })
    expect(v.totalSets).toBe(4)
  })

  it('skips slots on archived or unknown days when days are given', () => {
    const slots = [
      slot('a', 'day-1', 'ex-squat', 4),
      slot('b', 'day-2', 'ex-curl', 3),
      slot('c', 'day-gone', 'ex-press', 3),
    ]
    const days = [
      { id: 'day-1', archivedAt: null },
      { id: 'day-2', archivedAt: 1_000 },
    ]
    const v = plannedWeeklyVolume(slots, byDefault, days)
    expect(obj(v.byMuscle)).toEqual({ quads: 4, glutes: 2 })
    expect(v.totalSets).toBe(4)
    expect(plannedWeeklyVolume(slots, byDefault).totalSets).toBe(10)
  })

  it('counts the sets of a slot whose exercise does not resolve, with no muscle volume', () => {
    const v = plannedWeeklyVolume(
      [slot('a', 'day-1', 'ex-missing', 3), slot('b', 'day-1', 'ex-curl', 2)],
      (s) => (s.defaultExerciseId === 'ex-missing' ? null : byDefault(s)),
    )
    expect(obj(v.byMuscle)).toEqual({ biceps: 2 })
    expect(v.totalSets).toBe(5)
  })

  it("hands the resolver the caller's slot, so gym overrides can pick the exercise", () => {
    const slots = [{ ...slot('a', 'day-1', 'ex-squat', 3), gymExerciseId: 'ex-curl' }]
    const v = plannedWeeklyVolume(slots, (s) => {
      const muscleWeights = WEIGHTS[s.gymExerciseId ?? s.defaultExerciseId]
      return muscleWeights && { muscleWeights }
    })
    expect(obj(v.byMuscle)).toEqual({ biceps: 3 })
  })

  it('leaves out muscles with no volume, including zero-set slots', () => {
    const v = plannedWeeklyVolume([slot('a', 'day-1', 'ex-squat', 0)], byDefault)
    expect(v.byMuscle.size).toBe(0)
    expect(v.totalSets).toBe(0)
    expect(plannedWeeklyVolume([], byDefault)).toEqual({ byMuscle: new Map(), totalSets: 0 })
  })

  it('does not mutate its inputs', () => {
    const slots = deepFreeze([slot('a', 'day-1', 'ex-squat', 4)])
    const days = deepFreeze([{ id: 'day-1', archivedAt: null }])
    expect(() => plannedWeeklyVolume(slots, byDefault, days)).not.toThrow()
  })
})

describe('plannedDayVolume', () => {
  it("sums one day's active slots", () => {
    const v = plannedDayVolume(
      deepFreeze([
        slot('a', 'day-1', 'ex-press', 3),
        slot('b', 'day-1', 'ex-one-arm-ext', 3),
        slot('c', 'day-1', 'ex-curl', 2, 1_000),
      ]),
      byDefault,
    )
    expect(obj(v.byMuscle)).toEqual({ chest: 3, front_delts: 1.5, triceps: 4.5 })
    expect(v.totalSets).toBe(6)
  })
})

describe('countWorkingSets', () => {
  it('counts sets per session exercise, excluding warm-ups and voided sets', () => {
    const sets = deepFreeze([
      { sessionExerciseId: 'se-1', isWarmup: true, voidedAt: null },
      { sessionExerciseId: 'se-1', isWarmup: false, voidedAt: null },
      { sessionExerciseId: 'se-1', isWarmup: false, voidedAt: null },
      { sessionExerciseId: 'se-1', isWarmup: false, voidedAt: 5_000 },
      { sessionExerciseId: 'se-2', isWarmup: false, voidedAt: null },
      { sessionExerciseId: 'se-3', isWarmup: true, voidedAt: null },
    ])
    expect(Object.fromEntries(countWorkingSets(sets))).toEqual({ 'se-1': 2, 'se-2': 1 })
    expect(countWorkingSets([]).size).toBe(0)
  })
})

describe('loggedSessionVolume', () => {
  const exercises = deepFreeze<{ id: string; muscleWeights: MuscleWeights }[]>([
    { id: 'se-1', muscleWeights: { chest: 1, front_delts: 0.5, triceps: 0.5 } },
    { id: 'se-2', muscleWeights: { triceps: 1 } },
    { id: 'se-3', muscleWeights: { biceps: 1 } },
  ])

  it("uses each session exercise's snapshot weights and working-set count", () => {
    const v = loggedSessionVolume(
      exercises,
      new Map([
        ['se-1', 3],
        ['se-2', 2],
      ]),
    )
    expect(obj(v.byMuscle)).toEqual({ chest: 3, front_delts: 1.5, triceps: 3.5 })
    expect(v.totalSets).toBe(5)
  })

  it('ignores counts for exercises outside the session and exercises with no sets', () => {
    const v = loggedSessionVolume(
      exercises,
      new Map([
        ['se-3', 0],
        ['se-other', 4],
      ]),
    )
    expect(v.byMuscle.size).toBe(0)
    expect(v.totalSets).toBe(0)
  })

  it('composes with countWorkingSets', () => {
    const counts = countWorkingSets([
      { sessionExerciseId: 'se-2', isWarmup: true, voidedAt: null },
      { sessionExerciseId: 'se-2', isWarmup: false, voidedAt: null },
    ])
    expect(obj(loggedSessionVolume(exercises, counts).byMuscle)).toEqual({ triceps: 1 })
  })
})

function vol(entries: Record<string, number>, totalSets: number): VolumeTotals {
  return { byMuscle: new Map(Object.entries(entries)), totalSets }
}

function logged(
  id: string,
  date: string,
  volume: VolumeTotals,
  opts: { status?: SessionStatus; isDeload?: boolean; voidedAt?: EpochMs | null } = {},
): LoggedSession {
  return {
    id,
    date: d(date),
    status: opts.status ?? 'finished',
    isDeload: opts.isDeload ?? false,
    voidedAt: opts.voidedAt ?? null,
    volume,
  }
}

describe('countsTowardVolume', () => {
  it('counts finished and in-progress sessions, not abandoned or voided ones', () => {
    expect(countsTowardVolume({ status: 'finished', voidedAt: null })).toBe(true)
    expect(countsTowardVolume({ status: 'in_progress', voidedAt: null })).toBe(true)
    expect(countsTowardVolume({ status: 'abandoned', voidedAt: null })).toBe(false)
    expect(countsTowardVolume({ status: 'finished', voidedAt: 1_000 })).toBe(false)
  })
})

describe('weeklyLoggedVolume', () => {
  // 2026-09-28 is a Monday; 2026-10-04 a Sunday.
  const sessions = [
    logged('s3', '2026-10-05', vol({ quads: 4 }, 4)),
    logged('s1', '2026-09-28', vol({ quads: 4, glutes: 2 }, 4)),
    logged('s2', '2026-10-04', vol({ chest: 3, triceps: 1.5 }, 3)),
  ]

  it('groups sessions into Monday-start weeks, in ascending week order', () => {
    const weeks = weeklyLoggedVolume(deepFreeze(sessions), 1)
    expect([...weeks.keys()]).toEqual(['2026-09-28', '2026-10-05'])
    const first = weeks.get(d('2026-09-28'))
    expect(first?.weekStart).toBe('2026-09-28')
    expect(obj(first?.byMuscle ?? new Map())).toEqual({
      quads: 4,
      glutes: 2,
      chest: 3,
      triceps: 1.5,
    })
    expect(first?.totalSets).toBe(7)
    expect(first?.sessionIds).toEqual(['s1', 's2'])
    expect(weeks.get(d('2026-10-05'))?.sessionIds).toEqual(['s3'])
  })

  it('honours another week start day', () => {
    const weeks = weeklyLoggedVolume(sessions, 0)
    expect([...weeks.keys()]).toEqual(['2026-09-27', '2026-10-04'])
    expect(weeks.get(d('2026-10-04'))?.sessionIds).toEqual(['s2', 's3'])
    expect(obj(weeks.get(d('2026-10-04'))?.byMuscle ?? new Map())).toEqual({
      chest: 3,
      triceps: 1.5,
      quads: 4,
    })
  })

  it('excludes voided and abandoned sessions and includes the in-progress one', () => {
    const weeks = weeklyLoggedVolume(
      [
        logged('ok', '2026-09-28', vol({ quads: 4 }, 4)),
        logged('void', '2026-09-29', vol({ quads: 4 }, 4), { voidedAt: 9_000 }),
        logged('gone', '2026-09-30', vol({ quads: 4 }, 4), { status: 'abandoned' }),
        logged('now', '2026-10-01', vol({ quads: 2 }, 2), { status: 'in_progress' }),
        logged('void-only', '2026-10-06', vol({ quads: 4 }, 4), { voidedAt: 9_000 }),
      ],
      1,
    )
    expect([...weeks.keys()]).toEqual(['2026-09-28'])
    expect(weeks.get(d('2026-09-28'))?.sessionIds).toEqual(['ok', 'now'])
    expect(weeks.get(d('2026-09-28'))?.byMuscle.get('quads')).toBe(6)
  })

  it('marks a week with any deload session as a deload week', () => {
    const weeks = weeklyLoggedVolume(
      [
        logged('a', '2026-09-28', vol({ quads: 2 }, 2)),
        logged('b', '2026-09-30', vol({ chest: 2 }, 2), { isDeload: true }),
        logged('c', '2026-10-05', vol({ quads: 4 }, 4)),
      ],
      1,
    )
    expect(weeks.get(d('2026-09-28'))?.isDeloadWeek).toBe(true)
    expect(weeks.get(d('2026-10-05'))?.isDeloadWeek).toBe(false)
  })

  it('returns an empty map without sessions', () => {
    expect(weeklyLoggedVolume([], 1).size).toBe(0)
  })
})

describe('resolveBand', () => {
  it('uses the global band unless the muscle sets its own bounds', () => {
    expect(resolveBand({ bandMin: null, bandMax: null }, DEFAULT_SETTINGS)).toEqual({
      min: 10,
      max: 20,
    })
    expect(resolveBand({ bandMin: 6, bandMax: 12 }, DEFAULT_SETTINGS)).toEqual({ min: 6, max: 12 })
    expect(resolveBand({ bandMin: 12, bandMax: null }, DEFAULT_SETTINGS)).toEqual({
      min: 12,
      max: 20,
    })
    expect(
      resolveBand({ bandMin: null, bandMax: 15 }, { weeklyVolumeMin: 8, weeklyVolumeMax: 22 }),
    ).toEqual({
      min: 8,
      max: 15,
    })
  })
})

describe('volumeFlag', () => {
  const band = { min: 10, max: 20 }
  const full = { exemptLow: false, weekComplete: true, deloadWeek: false }

  it("flags 'low' strictly under the minimum and 'high' strictly over the maximum", () => {
    expect(volumeFlag(9.5, band, full)).toBe('low')
    expect(volumeFlag(0, band, full)).toBe('low')
    expect(volumeFlag(10, band, full)).toBe('ok')
    expect(volumeFlag(20, band, full)).toBe('ok')
    expect(volumeFlag(20.5, band, full)).toBe('high')
  })

  it("never flags an exempt muscle 'low', but still flags it 'high'", () => {
    const exempt = { ...full, exemptLow: true }
    expect(volumeFlag(5, band, exempt)).toBeNull()
    expect(volumeFlag(12, band, exempt)).toBe('ok')
    expect(volumeFlag(21, band, exempt)).toBe('high')
  })

  it("gives no 'low' verdict for an unfinished week", () => {
    const current = { ...full, weekComplete: false }
    expect(volumeFlag(4, band, current)).toBeNull()
    expect(volumeFlag(10, band, current)).toBe('ok')
    expect(volumeFlag(22, band, current)).toBe('high')
  })

  it("gives no 'low' verdict for a deload week", () => {
    expect(volumeFlag(6, band, { ...full, deloadWeek: true })).toBeNull()
  })
})

describe('muscleFlags', () => {
  const muscle = (id: string, over: Partial<Muscle> = {}) => ({
    id,
    bandMin: null,
    bandMax: null,
    exemptLow: false,
    archivedAt: null,
    ...over,
  })

  it('flags every active muscle, treating missing volume as zero', () => {
    const flags = muscleFlags(
      new Map([
        ['quads', 13.5],
        ['calves', 6],
        ['biceps', 22],
        ['chest', 9],
      ]),
      deepFreeze([
        muscle('quads'),
        muscle('calves', { exemptLow: true }),
        muscle('biceps'),
        muscle('chest', { bandMin: 8 }),
        muscle('traps'),
        muscle('old', { archivedAt: 1_000 }),
      ]),
      DEFAULT_SETTINGS,
      { weekComplete: true, deloadWeek: false },
    )
    expect([...flags]).toEqual([
      ['quads', 'ok'],
      ['calves', null],
      ['biceps', 'high'],
      ['chest', 'ok'],
      ['traps', 'low'],
    ])
  })

  it('passes the week context through', () => {
    const flags = muscleFlags(new Map(), [muscle('quads')], DEFAULT_SETTINGS, {
      weekComplete: false,
      deloadWeek: false,
    })
    expect(flags.get('quads')).toBeNull()
  })
})

describe('overSessionCap', () => {
  it('lists muscles strictly above the cap', () => {
    const byMuscle = new Map([
      ['triceps', 9.5],
      ['chest', 11],
      ['quads', 11.5],
      ['back', 14],
    ])
    expect(overSessionCap(byMuscle, DEFAULT_SETTINGS.sessionCap)).toEqual(['quads', 'back'])
    expect(overSessionCap(byMuscle, 20)).toEqual([])
    expect(overSessionCap(new Map(), 11)).toEqual([])
  })
})
