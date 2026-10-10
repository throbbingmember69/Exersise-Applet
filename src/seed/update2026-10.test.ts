import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import type { Exercise, ProgramSlot } from '@/domain/types'
import { overSessionCap, plannedDayVolume, plannedWeeklyVolume } from '@/domain/volume'
import { CATALOG_2026_10 } from './catalog'
import { SEED, SPEC_SEED } from './index'
import {
  ABDUCTION_SLOTS,
  applyUpdate2026_10,
  INCLINE_CABLE_PRESS_ID,
  type ProgramTables,
} from './update2026-10'

const tablesOf = (s: ProgramTables): ProgramTables => ({
  gyms: s.gyms,
  exercises: s.exercises,
  programDays: s.programDays,
  programSlots: s.programSlots,
  gymSlotOverrides: s.gymSlotOverrides,
  trackStarts: s.trackStarts,
})

const slotsOfDay = (t: ProgramTables, dayId: string) =>
  t.programSlots
    .filter((s) => s.programDayId === dayId && s.archivedAt === null)
    .sort((a, b) => a.order - b.order)

describe('applyUpdate2026_10 on the spec seed', () => {
  const before = tablesOf(SPEC_SEED)
  const after = applyUpdate2026_10(before)
  const exercise = (id: string) => after.exercises.find((e) => e.id === id)

  it('adds the catalog and the new field, keeping every spec exercise', () => {
    expect(after.exercises).toHaveLength(SPEC_SEED.exercises.length + CATALOG_2026_10.length)
    expect(after.exercises.every((e) => e.formUrl === null)).toBe(true)
    for (const e of SPEC_SEED.exercises) {
      expect(exercise(e.id), e.id).toMatchObject({ name: e.name, muscleWeights: e.muscleWeights })
    }
  })

  it('archives the incline cable press and puts the incline Smith press in its Upper slot', () => {
    expect(exercise(INCLINE_CABLE_PRESS_ID)?.archivedAt).not.toBeNull()
    const upper1 = after.programSlots.find((s) => s.id === 'slot-upper-1')!
    expect(upper1).toMatchObject({
      defaultExerciseId: 'ex-incline-smith-press',
      label: 'Incline Smith press',
      sets: 3,
      repMin: 8,
      repMax: 12,
    })
    expect(upper1.alternateExerciseIds).toEqual(['ex-incline-machine-press'])
    expect(
      after.programSlots.some((s) => s.alternateExerciseIds.includes(INCLINE_CABLE_PRESS_ID)),
    ).toBe(false)
  })

  it('adds hip abduction 3 × 12–20 right after hip thrust on both lower days', () => {
    for (const { id, programDayId } of ABDUCTION_SLOTS) {
      const day = slotsOfDay(after, programDayId)
      const i = day.findIndex((s) => s.id === id)
      expect(day[i - 1]?.defaultExerciseId, programDayId).toBe('ex-hip-thrust')
      expect(day[i]).toMatchObject({
        defaultExerciseId: 'ex-hip-abduction',
        sets: 3,
        repMin: 12,
        repMax: 20,
        rirMin: 0,
        rirMax: 1,
        restMinSec: 90,
        restMaxSec: 90,
      })
      // Orders stay 0..n-1 with no gaps or duplicates.
      expect(day.map((s) => s.order)).toEqual(day.map((_, k) => k))
    }
    expect(slotsOfDay(after, 'day-lower-a').map((s) => s.defaultExerciseId)).toEqual([
      'ex-smith-squat',
      'ex-leg-extension',
      'ex-seated-leg-curl',
      'ex-hip-thrust',
      'ex-hip-abduction',
      'ex-standing-calf-raise',
      'ex-cable-crunch',
    ])
  })

  it('gives the new and switched slots calibration track starts at the gym', () => {
    const added = after.trackStarts.filter((t) => !before.trackStarts.includes(t))
    expect(added.map((t) => t.trackKey).sort()).toEqual(
      [
        'day-lower-a|ex-hip-abduction|gym-1',
        'day-lower-b|ex-hip-abduction|gym-1',
        'day-upper|ex-incline-smith-press|gym-1',
      ].sort(),
    )
    expect(added.every((t) => t.startLoadLb === null && t.calibrate)).toBe(true)
  })

  it('adds catalog alternates to the slots that still have their seed default', () => {
    const slot = (id: string) => after.programSlots.find((s) => s.id === id)!
    expect(slot('slot-pull-3').alternateExerciseIds).toEqual([
      'ex-lat-pulldown',
      'ex-neutral-pulldown',
    ])
    expect(slot('slot-lower-b-1').alternateExerciseIds).toEqual(['ex-rdl'])
    const known = new Set(after.exercises.filter((e) => e.archivedAt === null).map((e) => e.id))
    for (const s of after.programSlots) {
      for (const a of s.alternateExerciseIds) expect(known.has(a), `${s.id} → ${a}`).toBe(true)
    }
  })

  it('changes nothing when run again', () => {
    expect(applyUpdate2026_10(after)).toEqual(after)
  })

  it('is what a first launch writes', () => {
    expect(tablesOf(SEED)).toEqual(after)
  })
})

describe('applyUpdate2026_10 respects what the user already changed', () => {
  const custom: Exercise = {
    ...SPEC_SEED.exercises.find((e) => e.id === 'ex-leg-extension')!,
    id: 'ex-user-abduction',
    name: 'Hip abduction (machine)',
    muscleWeights: { glutes: 1 },
  }
  const userSlot = (s: ProgramSlot): ProgramSlot =>
    s.id === 'slot-upper-1'
      ? { ...s, defaultExerciseId: 'ex-flat-db-press', label: 'My press' }
      : s.id === 'slot-push-2'
        ? { ...s, alternateExerciseIds: [...s.alternateExerciseIds, INCLINE_CABLE_PRESS_ID] }
        : s
  const before: ProgramTables = {
    ...tablesOf(SPEC_SEED),
    gyms: [
      ...SPEC_SEED.gyms,
      { id: 'gym-2', name: 'Travel', sortOrder: 1, archivedAt: null, createdAt: 0 },
    ],
    exercises: [...SPEC_SEED.exercises, custom],
    programDays: SPEC_SEED.programDays.map((d) =>
      d.id === 'day-lower-b' ? { ...d, archivedAt: 1 } : d,
    ),
    programSlots: [
      ...SPEC_SEED.programSlots.map(userSlot),
      {
        ...SPEC_SEED.programSlots.find((s) => s.id === 'slot-lower-a-2')!,
        id: 'slot-user-abduction',
        order: 6,
        defaultExerciseId: custom.id,
        label: 'Abduction',
      },
      {
        ...SPEC_SEED.programSlots.find((s) => s.id === 'slot-upper-1')!,
        id: 'slot-user-cable',
        order: 7,
      },
    ],
    gymSlotOverrides: [
      { id: 'o-1', gymId: 'gym-2', slotId: 'slot-push-2', exerciseId: INCLINE_CABLE_PRESS_ID },
      { id: 'o-2', gymId: 'gym-2', slotId: 'slot-pull-3', exerciseId: 'ex-face-pull' },
    ],
  }
  const after = applyUpdate2026_10(before)
  const slot = (id: string) => after.programSlots.find((s) => s.id === id)!

  it('leaves an edited slot alone and only switches slots still on the cable press', () => {
    expect(slot('slot-upper-1')).toEqual(before.programSlots.find((s) => s.id === 'slot-upper-1'))
    expect(slot('slot-user-cable')).toMatchObject({
      defaultExerciseId: 'ex-incline-smith-press',
      label: 'Incline Smith press',
    })
    expect(slot('slot-push-2').alternateExerciseIds).not.toContain(INCLINE_CABLE_PRESS_ID)
  })

  it('uses the user’s own same-named exercise and skips a day that already has abduction', () => {
    expect(after.exercises.filter((e) => e.name === 'Hip abduction (machine)')).toHaveLength(1)
    expect(after.programSlots.some((s) => s.id === 'slot-lower-a-abduction')).toBe(false)
    // Lower B is archived: no slot there either.
    expect(after.programSlots.some((s) => s.id === 'slot-lower-b-abduction')).toBe(false)
  })

  it('drops overrides that chose the cable press, and gives every gym its machine start', () => {
    expect(after.gymSlotOverrides).toEqual([before.gymSlotOverrides[1]])
    expect(
      after.trackStarts
        .filter((t) => t.exerciseId === 'ex-incline-smith-press')
        .map((t) => t.trackKey)
        .sort(),
    ).toEqual(['day-upper|ex-incline-smith-press|gym-1', 'day-upper|ex-incline-smith-press|gym-2'])
  })

  it('changes nothing when run again', () => {
    expect(applyUpdate2026_10(after)).toEqual(after)
  })
})

describe('the updated seed program', () => {
  const exercises = new Map(SEED.exercises.map((e) => [e.id, e]))
  const resolve = (slot: ProgramSlot) => exercises.get(slot.defaultExerciseId)
  const planned = plannedWeeklyVolume(SEED.programSlots, resolve, SEED.programDays)

  it('plans 100 sets a week: glutes 16 with hip abduction, chest unchanged at 14', () => {
    expect(planned.totalSets).toBe(100)
    expect(planned.byMuscle.get('glutes')).toBe(16)
    expect(planned.byMuscle.get('chest')).toBe(14)
    expect(planned.byMuscle.get('quads')).toBe(13.5)
    expect(planned.byMuscle.get('triceps')).toBe(16)
  })

  it('keeps every day under the per-session cap', () => {
    for (const day of SEED.programDays) {
      const slots = SEED.programSlots.filter((s) => s.programDayId === day.id)
      expect(
        overSessionCap(plannedDayVolume(slots, resolve).byMuscle, DEFAULT_SETTINGS.sessionCap),
      ).toEqual([])
    }
  })
})
