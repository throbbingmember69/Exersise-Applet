import { describe, expect, it } from 'vitest'
import type { ProgramSlot } from '@/domain/types'
import { plannedOptionalVolume, plannedWeeklyVolume } from '@/domain/volume'
import { NOVEMBER_SEED, SEED } from './index'
import { type BackFocusTables } from './update2026-10b'
import {
  applyUpdate2026_11b,
  NECK,
  OBLIQUES,
  SMALL_MUSCLE_EXERCISES,
  SMALL_MUSCLES_TRACKED_FROM,
} from './update2026-11b'

/** The tables as the November 21 program update left them (a v4 database: no slot.optional). */
function v4Tables(): BackFocusTables {
  return {
    gyms: NOVEMBER_SEED.gyms,
    exercises: NOVEMBER_SEED.exercises,
    programDays: NOVEMBER_SEED.programDays,
    programSlots: NOVEMBER_SEED.programSlots.map(
      ({ optional: _o, ...s }) => s,
    ) as unknown as ProgramSlot[],
    gymSlotOverrides: NOVEMBER_SEED.gymSlotOverrides,
    trackStarts: NOVEMBER_SEED.trackStarts,
    muscles: NOVEMBER_SEED.muscles,
  }
}

const dayOf = (t: BackFocusTables, dayId: string) =>
  t.programSlots
    .filter((s) => s.programDayId === dayId && s.archivedAt === null)
    .sort((a, b) => a.order - b.order)

describe('applyUpdate2026_11b on the November program', () => {
  const before = v4Tables()
  const after = applyUpdate2026_11b(before)
  const muscle = (id: string) => after.muscles.find((m) => m.id === id)

  it('adds Obliques after Abs and Neck last, tracked from the update and exempt from low', () => {
    expect(muscle(OBLIQUES)).toEqual({
      id: OBLIQUES,
      name: 'Obliques',
      sortOrder: muscle('abs')!.sortOrder + 0.5,
      bandMin: null,
      bandMax: null,
      exemptLow: true,
      lagging: false,
      trackedFrom: SMALL_MUSCLES_TRACKED_FROM,
      archivedAt: null,
    })
    expect(muscle(NECK)).toMatchObject({ name: 'Neck', exemptLow: true })
    expect(muscle(NECK)!.sortOrder).toBeGreaterThan(
      Math.max(...before.muscles.map((m) => m.sortOrder)),
    )
  })

  it('makes Abs count toward the low flag', () => {
    expect(before.muscles.find((m) => m.id === 'abs')!.exemptLow).toBe(true)
    expect(muscle('abs')!.exemptLow).toBe(false)
  })

  it('adds the four exercises with their muscle weights', () => {
    const ex = (id: string) => after.exercises.find((e) => e.id === id)!
    expect(ex('ex-ab-wheel-rollout')).toMatchObject({
      loadType: 'bodyweight_plus',
      muscleWeights: { abs: 1, obliques: 0.5 },
    })
    expect(ex('ex-cable-woodchop')).toMatchObject({
      loadType: 'cable',
      unilateral: true,
      muscleWeights: { obliques: 1, abs: 0.5 },
    })
    expect(ex('ex-neck-extension').muscleWeights).toEqual({ neck: 1 })
    expect(ex('ex-neck-flexion').muscleWeights).toEqual({ neck: 1 })
  })

  it('appends optional slots to each day and marks every other slot required', () => {
    const tail = (dayId: string, n: number) =>
      dayOf(after, dayId)
        .slice(-n)
        .map((s) => [s.defaultExerciseId, s.sets, s.optional])
    expect(tail('day-lower-a', 2)).toEqual([
      ['ex-neck-extension', 2, true],
      ['ex-neck-flexion', 2, true],
    ])
    expect(tail('day-push', 1)).toEqual([['ex-ab-wheel-rollout', 3, true]])
    expect(tail('day-pull', 1)).toEqual([['ex-cable-woodchop', 2, true]])
    expect(tail('day-lower-b', 3)).toEqual([
      ['ex-cable-woodchop', 2, true],
      ['ex-neck-extension', 2, true],
      ['ex-neck-flexion', 2, true],
    ])
    expect(tail('day-upper', 1)).toEqual([['ex-ab-wheel-rollout', 3, true]])
    expect(after.programSlots.filter((s) => s.optional)).toHaveLength(8)
    expect(after.programSlots.filter((s) => !s.optional)).toHaveLength(before.programSlots.length)
    for (const d of after.programDays)
      expect(dayOf(after, d.id).map((s) => s.order)).toEqual(dayOf(after, d.id).map((_, i) => i))
    const added = after.trackStarts.filter((t) => !before.trackStarts.includes(t))
    expect(added.every((t) => t.calibrate && t.startLoadLb === null)).toBe(true)
    expect(added).toHaveLength(8)
  })

  it('keeps the required plan unchanged and offers abs ~8, obliques ~7 and neck 8 more sets', () => {
    const exercises = new Map(after.exercises.map((e) => [e.id, e]))
    const resolve = (s: ProgramSlot) => exercises.get(s.defaultExerciseId)
    const required = plannedWeeklyVolume(after.programSlots, resolve, after.programDays)
    expect(required.totalSets).toBe(116)
    expect(required.byMuscle.get('abs')).toBe(5)
    const optional = plannedOptionalVolume(after.programSlots, resolve, after.programDays)
    expect(Object.fromEntries(optional.byMuscle)).toEqual({ abs: 8, obliques: 7, neck: 8 })
    expect(optional.totalSets).toBe(18)
  })

  it('is idempotent, and is what a first launch writes', () => {
    expect(applyUpdate2026_11b(after)).toEqual(after)
    const again = applyUpdate2026_11b(after)
    again.programSlots.forEach((s, i) => expect(s).toBe(after.programSlots[i]))
    expect(again.muscles).toEqual(after.muscles)
    expect({ ...SEED, ...after }).toEqual(SEED)
  })
})

describe('applyUpdate2026_11b respects what the user already changed', () => {
  const base = v4Tables()

  it('uses a same-named exercise of the user’s instead of adding a duplicate', () => {
    const mine = {
      ...base,
      exercises: [
        ...base.exercises,
        { ...SMALL_MUSCLE_EXERCISES[0]!, id: 'ex-user-wheel', name: 'Ab Wheel Rollout ' },
      ],
    }
    const after = applyUpdate2026_11b(mine)
    expect(after.exercises.some((e) => e.id === 'ex-ab-wheel-rollout')).toBe(false)
    expect(after.programSlots.find((s) => s.id === 'slot-push-ab-wheel')?.defaultExerciseId).toBe(
      'ex-user-wheel',
    )
  })

  it('skips archived days and days that already have the exercise, and keeps an existing Obliques', () => {
    const mine: BackFocusTables = {
      ...base,
      programDays: base.programDays.map((d) =>
        d.id === 'day-upper' ? { ...d, archivedAt: 1 } : d,
      ),
      muscles: [
        ...base.muscles,
        {
          id: OBLIQUES,
          name: 'Sides',
          sortOrder: 99,
          bandMin: 4,
          bandMax: 12,
          exemptLow: false,
          lagging: true,
          trackedFrom: null,
          archivedAt: null,
        },
      ],
    }
    const once = applyUpdate2026_11b(mine)
    const withWoodchop = {
      ...once,
      programSlots: once.programSlots.filter((s) => s.id !== 'slot-pull-woodchop'),
    }
    expect(once.programSlots.some((s) => s.id === 'slot-upper-ab-wheel')).toBe(false)
    expect(once.muscles.find((m) => m.id === OBLIQUES)).toMatchObject({
      name: 'Sides',
      lagging: true,
    })
    // A Pull day that already has a woodchop (here: one the user added) gets no second one.
    const userWoodchop: ProgramSlot = {
      ...once.programSlots.find((s) => s.id === 'slot-lower-b-woodchop')!,
      id: 'slot-mine',
      programDayId: 'day-pull',
      optional: false,
    }
    const again = applyUpdate2026_11b({
      ...withWoodchop,
      programSlots: [...withWoodchop.programSlots, userWoodchop],
    })
    expect(again.programSlots.some((s) => s.id === 'slot-pull-woodchop')).toBe(false)
  })
})
