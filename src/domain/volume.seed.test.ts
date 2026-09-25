// Spec acceptance: "With the seed program, weekly fractional sets match Volume accounting
// (quads 13.5, chest 14, triceps 16)", checked against every row of the spec's "Weekly totals for
// the revised plan" table.
import { describe, expect, it } from 'vitest'
import { SEED } from '@/seed'
import { DEFAULT_SETTINGS } from './settings/registry'
import type { Exercise, MuscleWeights, ProgramSlot } from './types'
import { muscleFlags, overSessionCap, plannedDayVolume, plannedWeeklyVolume } from './volume'

function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x)
    for (const v of Object.values(x)) deepFreeze(v)
  }
  return x
}

const seed = deepFreeze(SEED)
const exercises = new Map(seed.exercises.map((e) => [e.id, e]))
const resolveDefault = (slot: ProgramSlot): Exercise | undefined =>
  exercises.get(slot.defaultExerciseId)

// Spec "Weekly totals for the revised plan": muscle → [sets at 1.0, fractional total].
const WEEKLY_TOTALS: Readonly<Record<string, readonly [number, number]>> = {
  triceps: [10, 16],
  chest: [13, 14],
  quads: [12, 13.5],
  biceps: [8, 13.5],
  back: [11, 11],
  glutes: [5, 10],
  hamstrings: [9, 9],
  side_delts: [7, 8.5],
  front_delts: [3, 8.5],
  rear_delts: [5, 8],
  calves: [6, 6],
  abs: [5, 5],
}

function primaryOnly(weights: MuscleWeights): MuscleWeights {
  return Object.fromEntries(Object.entries(weights).filter(([, w]) => w === 1))
}

describe('seed program volume (spec acceptance)', () => {
  const planned = plannedWeeklyVolume(seed.programSlots, resolveDefault, seed.programDays)

  it('with the seed program, weekly fractional sets match Volume accounting (quads 13.5, chest 14, triceps 16)', () => {
    expect(planned.byMuscle.get('quads')).toBe(13.5)
    expect(planned.byMuscle.get('chest')).toBe(14)
    expect(planned.byMuscle.get('triceps')).toBe(16)
    expect(Object.fromEntries(planned.byMuscle)).toEqual(
      Object.fromEntries(Object.entries(WEEKLY_TOTALS).map(([m, [, total]]) => [m, total])),
    )
    expect(planned.byMuscle.get('traps') ?? 0).toBe(0)
  })

  it('matches the "Sets at 1.0" column when only primary muscles count', () => {
    const direct = plannedWeeklyVolume(seed.programSlots, (slot) => {
      const e = resolveDefault(slot)
      return e && { muscleWeights: primaryOnly(e.muscleWeights) }
    })
    expect(Object.fromEntries(direct.byMuscle)).toEqual(
      Object.fromEntries(Object.entries(WEEKLY_TOTALS).map(([m, [atOne]]) => [m, atOne])),
    )
  })

  it('plans 94 working sets: 18/19/18/19/20 per day', () => {
    expect(planned.totalSets).toBe(94)
    const perDay = seed.programDays.map(
      (day) =>
        plannedDayVolume(
          seed.programSlots.filter((s) => s.programDayId === day.id),
          resolveDefault,
        ).totalSets,
    )
    expect(perDay).toEqual([18, 19, 18, 19, 20])
  })

  it('never exceeds the 11-set session cap; the busiest muscle-day is Push triceps at 9.5', () => {
    let max = { day: '', muscle: '', sets: 0 }
    for (const day of seed.programDays) {
      const v = plannedDayVolume(
        seed.programSlots.filter((s) => s.programDayId === day.id),
        resolveDefault,
      )
      expect(overSessionCap(v.byMuscle, DEFAULT_SETTINGS.sessionCap)).toEqual([])
      for (const [muscle, sets] of v.byMuscle) {
        if (sets > max.sets) max = { day: day.id, muscle, sets }
      }
    }
    expect(max).toEqual({ day: 'day-push', muscle: 'triceps', sets: 9.5 })
  })

  it("flags only hamstrings, side delts and rear delts 'low' among the spec's muscles", () => {
    const flags = muscleFlags(planned.byMuscle, seed.muscles, DEFAULT_SETTINGS, {
      weekComplete: true,
      deloadWeek: false,
    })
    const specMuscles = Object.keys(WEEKLY_TOTALS)
    const low = specMuscles.filter((m) => flags.get(m) === 'low')
    expect(low.sort()).toEqual(['hamstrings', 'rear_delts', 'side_delts'])
    // Exempt by user decision: "enough" (front delts) and "low by choice" (calves, abs).
    for (const m of ['front_delts', 'calves', 'abs']) expect(flags.get(m)).toBeNull()
    for (const m of ['triceps', 'chest', 'quads', 'biceps', 'back', 'glutes']) {
      expect(flags.get(m)).toBe('ok')
    }
    // Traps (finisher-only, not in the spec table) has no planned volume and is exempt.
    expect(flags.get('traps')).toBeNull()
  })

  it('keeps the same planned volume when every "or" slot uses its alternate', () => {
    const alternates = plannedWeeklyVolume(seed.programSlots, (slot) =>
      exercises.get(slot.alternateExerciseIds[0] ?? slot.defaultExerciseId),
    )
    expect(alternates).toEqual(planned)
  })
})
