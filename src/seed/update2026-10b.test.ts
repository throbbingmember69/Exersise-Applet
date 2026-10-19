import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import type { ProgramSlot } from '@/domain/types'
import { overSessionCap, plannedDayVolume, plannedWeeklyVolume } from '@/domain/volume'
import { SEED, SPEC_SEED } from './index'
import { applyUpdate2026_10 } from './update2026-10'
import {
  applyUpdate2026_10b,
  BACK_FOCUS_EXERCISES,
  BACK_FOCUS_TRACKED_FROM,
  type BackFocusTables,
} from './update2026-10b'

/** The tables as the October 10 update left them (what a v2 database holds). */
function v2Tables(): BackFocusTables {
  const t = applyUpdate2026_10(SPEC_SEED)
  return {
    gyms: t.gyms,
    exercises: t.exercises,
    programDays: t.programDays,
    programSlots: t.programSlots,
    gymSlotOverrides: t.gymSlotOverrides,
    trackStarts: t.trackStarts,
    muscles: SPEC_SEED.muscles.map(
      ({ trackedFrom: _t, ...m }) => m,
    ) as unknown as BackFocusTables['muscles'],
  }
}

const dayOf = (t: BackFocusTables, dayId: string) =>
  t.programSlots
    .filter((s) => s.programDayId === dayId && s.archivedAt === null)
    .sort((a, b) => a.order - b.order)

describe('applyUpdate2026_10b on the October 10 program', () => {
  const before = v2Tables()
  const after = applyUpdate2026_10b(before)
  const muscle = (id: string) => after.muscles.find((m) => m.id === id)!
  const exercise = (id: string) => after.exercises.find((e) => e.id === id)!

  it('splits Back into Lats and Upper back, and makes Traps a tracked, lagging muscle', () => {
    expect(muscle('back')).toMatchObject({ name: 'Lats', lagging: true, exemptLow: false })
    expect(muscle('upper_back')).toMatchObject({
      name: 'Upper back',
      lagging: false,
      exemptLow: false,
      bandMin: null,
      bandMax: null,
      trackedFrom: BACK_FOCUS_TRACKED_FROM,
    })
    expect(muscle('upper_back').sortOrder).toBeGreaterThan(muscle('back').sortOrder)
    expect(muscle('upper_back').sortOrder).toBeLessThan(muscle('biceps').sortOrder)
    expect(muscle('traps')).toMatchObject({
      exemptLow: false,
      lagging: true,
      bandMin: 6,
      bandMax: 16,
      trackedFrom: BACK_FOCUS_TRACKED_FROM,
    })
    expect(muscle('quads').trackedFrom).toBeNull()
  })

  it('re-weights back work: pulls for lats, the wide machine row for upper back', () => {
    expect(exercise('ex-weighted-chin-up').muscleWeights).toEqual({
      back: 1,
      upper_back: 0.5,
      biceps: 0.5,
    })
    expect(exercise('ex-machine-barbell-row').muscleWeights).toEqual({
      upper_back: 1,
      back: 0.5,
      biceps: 0.5,
      rear_delts: 0.5,
    })
    expect(exercise('ex-seated-cable-row').muscleWeights).toEqual({
      back: 1,
      upper_back: 1,
      biceps: 0.5,
      rear_delts: 0.5,
    })
    expect(exercise('ex-face-pull').muscleWeights).toEqual({ rear_delts: 1, upper_back: 0.5 })
    expect(exercise('ex-straight-arm-pulldown').muscleWeights).toEqual({ back: 1 })
    for (const e of after.exercises) {
      const weights = Object.values(e.muscleWeights)
      expect(
        weights.every((w) => w === 1 || w === 0.5),
        e.id,
      ).toBe(true)
      expect(weights.includes(1), e.id).toBe(true)
    }
  })

  it('adds the Y-raise and cable shrug exercises and promotes the barbell shrug', () => {
    for (const e of BACK_FOCUS_EXERCISES) expect(exercise(e.id)).toEqual(e)
    expect(exercise('ex-barbell-shrug')).toMatchObject({ isFinisher: false })
  })

  it('adds +10 working sets of back and trap work on Push, Pull and Upper', () => {
    expect(dayOf(after, 'day-push').map((s) => s.defaultExerciseId)).toContain('ex-barbell-shrug')
    const push = dayOf(after, 'day-push')
    expect(push[push.findIndex((s) => s.id === 'slot-push-shrug') - 1]?.id).toBe('slot-push-5')
    const pull = dayOf(after, 'day-pull').map((s) => [s.id, s.sets])
    expect(pull.slice(0, 4)).toEqual([
      ['slot-pull-1', 3],
      ['slot-pull-2', 3],
      ['slot-pull-3', 3],
      ['slot-pull-y-raise', 2],
    ])
    expect(dayOf(after, 'day-upper').map((s) => s.id)).toEqual([
      'slot-upper-1',
      'slot-upper-lat-pulldown',
      'slot-upper-2',
      'slot-upper-3',
      'slot-upper-4',
      'slot-upper-shrug',
      'slot-upper-5',
      'slot-upper-6',
      'slot-upper-7',
    ])
    for (const day of after.programDays) {
      const orders = dayOf(after, day.id).map((s) => s.order)
      expect(orders, day.id).toEqual(orders.map((_, i) => i))
    }
    const added = after.trackStarts.filter((t) => !before.trackStarts.includes(t))
    expect(added.map((t) => t.trackKey).sort()).toEqual(
      [
        'day-pull|ex-incline-db-y-raise|*',
        'day-push|ex-barbell-shrug|*',
        'day-upper|ex-cable-shrug|gym-1',
        'day-upper|ex-lat-pulldown|gym-1',
      ].sort(),
    )
    expect(added.every((t) => t.startLoadLb === null && t.calibrate)).toBe(true)
  })

  it('changes nothing when run again', () => {
    expect(applyUpdate2026_10b(after)).toEqual(after)
  })

  it('is what a first launch writes', () => {
    expect(SEED.muscles).toEqual(after.muscles)
    expect(SEED.exercises).toEqual(after.exercises)
    expect(SEED.programSlots).toEqual(after.programSlots)
    expect(SEED.trackStarts).toEqual(after.trackStarts)
  })
})

describe('applyUpdate2026_10b respects what the user already changed', () => {
  const base = v2Tables()
  const custom: BackFocusTables = {
    ...base,
    muscles: base.muscles.map((m) =>
      m.id === 'back'
        ? { ...m, name: 'My back' }
        : // A deliberate band: the user had already made Traps count toward 'low'.
          m.id === 'traps'
          ? { ...m, exemptLow: false, bandMin: 8 }
          : m,
    ),
    exercises: base.exercises.map((e) =>
      e.id === 'ex-weighted-chin-up' ? { ...e, muscleWeights: { back: 1, biceps: 1 } } : e,
    ),
    programSlots: [
      ...base.programSlots.map((s) => (s.id === 'slot-pull-3' ? { ...s, sets: 4 } : s)),
      // The user already pulls vertically on Upper.
      {
        ...base.programSlots.find((s) => s.id === 'slot-upper-3')!,
        id: 'slot-user-pullup',
        order: 9,
        defaultExerciseId: 'ex-pull-up',
      } satisfies ProgramSlot,
    ],
  }
  const after = applyUpdate2026_10b(custom)

  it('keeps the user’s names, bands, weights and set counts', () => {
    expect(after.muscles.find((m) => m.id === 'back')).toMatchObject({
      name: 'My back',
      lagging: true,
    })
    expect(after.muscles.find((m) => m.id === 'traps')).toMatchObject({ bandMin: 8, bandMax: 16 })
    expect(after.exercises.find((e) => e.id === 'ex-weighted-chin-up')?.muscleWeights).toEqual({
      back: 1,
      biceps: 1,
    })
    expect(after.programSlots.find((s) => s.id === 'slot-pull-3')?.sets).toBe(4)
    expect(after.programSlots.some((s) => s.id === 'slot-upper-lat-pulldown')).toBe(false)
    expect(after.programSlots.some((s) => s.id === 'slot-upper-shrug')).toBe(true)
  })

  it('changes nothing when run again', () => {
    expect(applyUpdate2026_10b(after)).toEqual(after)
  })
})

describe('the back-focus program', () => {
  const exercises = new Map(SEED.exercises.map((e) => [e.id, e]))
  const resolve = (slot: ProgramSlot) => exercises.get(slot.defaultExerciseId)
  const planned = plannedWeeklyVolume(SEED.programSlots, resolve, SEED.programDays)

  it('plans 110 sets a week: lats 12, upper back 12.5, traps 6, others unchanged', () => {
    expect(planned.totalSets).toBe(110)
    expect(Object.fromEntries(planned.byMuscle)).toEqual({
      quads: 13.5,
      hamstrings: 9,
      glutes: 16,
      calves: 6,
      abs: 5,
      chest: 14,
      front_delts: 8.5,
      side_delts: 8.5,
      rear_delts: 8,
      back: 12,
      upper_back: 12.5,
      traps: 6,
      biceps: 15.5,
      triceps: 16,
    })
  })

  it('keeps every day under the per-session cap', () => {
    for (const day of SEED.programDays) {
      const slots = SEED.programSlots.filter((s) => s.programDayId === day.id)
      expect(
        overSessionCap(plannedDayVolume(slots, resolve).byMuscle, DEFAULT_SETTINGS.sessionCap),
        day.id,
      ).toEqual([])
    }
  })
})

describe('applyUpdate2026_10b review fixes', () => {
  const base = v2Tables()
  const exerciseLike = (id: string, name: string) => ({
    ...base.exercises.find((e) => e.id === 'ex-db-shrug')!,
    id,
    name,
  })

  it('uses the user’s own same-named exercises instead of adding duplicates', () => {
    const after = applyUpdate2026_10b({
      ...base,
      exercises: [
        // A 'Cable shrug' the user made, and their 'Lat pulldown' that stood in on Oct 10.
        ...base.exercises.filter((e) => e.id !== 'ex-lat-pulldown'),
        exerciseLike('user-cable-shrug', 'Cable shrug'),
        { ...exerciseLike('user-pulldown', 'lat pulldown'), muscleWeights: { back: 1 } },
      ],
    })
    expect(after.exercises.filter((e) => e.name.toLowerCase() === 'cable shrug')).toHaveLength(1)
    expect(after.exercises.some((e) => e.id === 'ex-cable-shrug')).toBe(false)
    const slot = (id: string) => after.programSlots.find((s) => s.id === id)
    expect(slot('slot-upper-shrug')?.defaultExerciseId).toBe('user-cable-shrug')
    expect(slot('slot-push-shrug')?.alternateExerciseIds).toContain('user-cable-shrug')
    expect(slot('slot-upper-lat-pulldown')?.defaultExerciseId).toBe('user-pulldown')
  })

  it('makes an exercise that now fills a slot progress, even with edited notes', () => {
    const after = applyUpdate2026_10b({
      ...base,
      exercises: base.exercises.map((e) =>
        e.id === 'ex-barbell-shrug' ? { ...e, notes: 'Use straps.' } : e,
      ),
    })
    expect(after.exercises.find((e) => e.id === 'ex-barbell-shrug')).toMatchObject({
      isFinisher: false,
      notes: 'Use straps.',
    })
  })

  it('replaces a Traps band that had no effect while it was exempt', () => {
    const after = applyUpdate2026_10b({
      ...base,
      // The muscle form saved the global band while Traps was still exempt from 'low'.
      muscles: base.muscles.map((m) =>
        m.id === 'traps' ? { ...m, bandMin: 10, bandMax: 20, lagging: true } : m,
      ),
    })
    expect(after.muscles.find((m) => m.id === 'traps')).toMatchObject({
      bandMin: 6,
      bandMax: 16,
      exemptLow: false,
    })
  })

  it('counts the new groups from the day the update runs', () => {
    const after = applyUpdate2026_10b(base, { trackedFrom: '2026-11-03' as never })
    for (const id of ['back', 'upper_back', 'traps']) {
      expect(after.muscles.find((m) => m.id === id)?.trackedFrom, id).toBe('2026-11-03')
    }
  })
})
