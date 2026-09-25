import { afterEach, describe, expect, it } from 'vitest'
import { TABLE_NAMES } from '@/db/backupSchema'
import { createTestCtx, type ServiceCtx } from '../context'
import { loadTrainingModel } from '../training/model'
import { insertSession } from '../training/testFixtures'
import {
  archiveDay,
  archiveExercise,
  archiveSlot,
  createGym,
  createSlot,
  setGymSlotOverride,
  setGymStep,
  updateMuscle,
} from './commands'
import {
  getExerciseDetail,
  getExerciseLibrary,
  getGyms,
  getMuscles,
  getProgramOverview,
} from './queries'

const ctxs: ReturnType<typeof createTestCtx>[] = []
function ctx() {
  const c = createTestCtx()
  ctxs.push(c)
  return c
}
afterEach(async () => {
  for (const c of ctxs.splice(0)) {
    c.db.close()
    await c.db.delete()
  }
})

// Spec "Weekly totals for the revised plan": fractional sets per muscle.
const SPEC_WEEKLY_TOTALS = {
  triceps: 16,
  chest: 14,
  quads: 13.5,
  biceps: 13.5,
  back: 11,
  glutes: 10,
  hamstrings: 9,
  side_delts: 8.5,
  front_delts: 8.5,
  rear_delts: 8,
  calves: 6,
  abs: 5,
}

/** Queries run inside useLiveQuery: prove they only read and return plain data. */
async function readOnly<T>(c: Pick<ServiceCtx, 'db'>, query: () => Promise<T>): Promise<T> {
  const result = await c.db.transaction('r', [...TABLE_NAMES], query)
  expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  return result
}

describe('getProgramOverview', () => {
  it("with the seed program, weekly planned volume matches the spec's Weekly totals table", async () => {
    const c = ctx()
    const overview = await readOnly(c, () => getProgramOverview(c))

    const weekly = Object.fromEntries(overview.weekly.muscles.map((m) => [m.muscleId, m.sets]))
    expect(weekly).toEqual({ ...SPEC_WEEKLY_TOTALS, traps: 0 })
    expect(overview.weekly.totalSets).toBe(94)
    // In muscle order, with bands and flags (front delts, calves, abs and traps are exempt).
    expect(overview.weekly.muscles.map((m) => [m.muscleId, m.flag])).toEqual([
      ['quads', 'ok'],
      ['hamstrings', 'low'],
      ['glutes', 'ok'],
      ['calves', null],
      ['abs', null],
      ['chest', 'ok'],
      ['front_delts', null],
      ['side_delts', 'low'],
      ['rear_delts', 'low'],
      ['back', 'ok'],
      ['biceps', 'ok'],
      ['triceps', 'ok'],
      ['traps', null],
    ])
    expect(overview.weekly.muscles[0]).toEqual({
      muscleId: 'quads',
      name: 'Quads',
      sets: 13.5,
      band: { min: 10, max: 20 },
      bandIsDefault: true,
      flag: 'ok',
      exemptLow: false,
      lagging: false,
    })
    expect(overview.sessionCap).toBe(11)
  })

  it('lists days in order with their slots resolved for the gym and per-day volume', async () => {
    const c = ctx()
    const overview = await getProgramOverview(c)
    expect(overview.gym).toEqual({ id: 'gym-1', name: 'Gym 1', archived: false })
    expect(
      overview.days.map((d) => [d.day.name, d.archived, d.slots.length, d.volume.totalSets]),
    ).toEqual([
      ['Lower A', false, 6, 18],
      ['Push', false, 7, 19],
      ['Pull', false, 7, 18],
      ['Lower B', false, 7, 19],
      ['Upper', false, 7, 20],
    ])
    // The seed peaks at 9.5 (Push triceps): no session-cap warnings.
    expect(overview.days.every((d) => d.overSessionCap.length === 0)).toBe(true)
    const push = overview.days[1]!
    expect(push.volume.byMuscle).toEqual([
      { muscleId: 'chest', name: 'Chest', sets: 9 },
      { muscleId: 'front_delts', name: 'Front delts', sets: 7 },
      { muscleId: 'side_delts', name: 'Side delts', sets: 4.5 },
      { muscleId: 'triceps', name: 'Triceps', sets: 9.5 },
    ])
    expect(push.slots[1]).toEqual({
      slot: expect.objectContaining({ id: 'slot-push-2', label: 'Flat machine or DB press (new)' }),
      archived: false,
      exercise: {
        id: 'ex-flat-machine-press',
        name: 'Flat machine press',
        loadType: 'machine',
        archived: false,
      },
      isOverride: false,
      defaultExercise: { id: 'ex-flat-machine-press', name: 'Flat machine press' },
      alternates: [{ id: 'ex-flat-db-press', name: 'Flat DB press' }],
    })
  })

  it('warns when a day plans more than the session cap for a muscle', async () => {
    const c = ctx()
    await createSlot(c, 'day-push', {
      exerciseId: 'ex-straight-bar-pushdown',
      sets: 2,
      repMin: 10,
      repMax: 15,
      rirMin: 0,
      rirMax: 1,
      restMinSec: 90,
      restMaxSec: 90,
    })
    const overview = await getProgramOverview(c)
    expect(overview.days[1]!.overSessionCap).toEqual([
      { muscleId: 'triceps', name: 'Triceps', sets: 11.5 },
    ])
    expect(overview.days[0]!.overSessionCap).toEqual([])
    expect(overview.weekly.muscles.find((m) => m.muscleId === 'triceps')).toMatchObject({
      sets: 18,
      flag: 'ok',
    })
  })

  it('resolves per-gym overrides the same way the training model does', async () => {
    const c = ctx()
    const gym2 = await createGym(c, 'Hotel gym')
    await setGymSlotOverride(c, gym2, 'slot-lower-a-1', 'ex-leg-press')
    await setGymSlotOverride(c, gym2, 'slot-push-2', 'ex-flat-db-press')

    const atGym2 = await getProgramOverview(c, { gymId: gym2 })
    expect(atGym2.gym).toEqual({ id: gym2, name: 'Hotel gym', archived: false })
    expect(atGym2.days[0]!.slots[0]).toMatchObject({
      exercise: { id: 'ex-leg-press', name: 'Leg press' },
      isOverride: true,
      defaultExercise: { id: 'ex-smith-squat' },
    })
    // Same muscle weights, so the plan doesn't move.
    expect(atGym2.weekly.totalSets).toBe(94)
    expect(Object.fromEntries(atGym2.weekly.muscles.map((m) => [m.muscleId, m.sets]))).toEqual({
      ...SPEC_WEEKLY_TOTALS,
      traps: 0,
    })

    const model = await loadTrainingModel(c)
    for (const gymId of ['gym-1', gym2]) {
      const overview = await getProgramOverview(c, { gymId })
      for (const day of overview.days) {
        for (const view of day.slots) {
          const resolved = model.resolveSlotExercise(view.slot, gymId)
          expect(view.exercise?.id).toBe(resolved.exercise.id)
          expect(view.isOverride).toBe(resolved.swapKind === 'gym_override')
        }
      }
    }
    // An unknown gym falls back to the first active gym.
    expect((await getProgramOverview(c, { gymId: 'gym-gone' })).gym?.id).toBe('gym-1')
  })

  it('shows archived days and slots, flagged, and leaves them out of the plan', async () => {
    const c = ctx()
    await archiveSlot(c, 'slot-pull-5')
    await archiveDay(c, 'day-upper')
    await archiveExercise(c, 'ex-flat-db-press')
    const overview = await getProgramOverview(c)
    const pull = overview.days[2]!
    expect(pull.slots.find((s) => s.slot.id === 'slot-pull-5')?.archived).toBe(true)
    expect(pull.volume.totalSets).toBe(16)
    expect(overview.days[4]).toMatchObject({ archived: true, volume: { totalSets: 20 } })
    expect(overview.weekly.totalSets).toBe(94 - 2 - 20)
    // Archived exercises drop out of the suggested alternates.
    expect(overview.days[1]!.slots[1]!.alternates).toEqual([])
  })
})

describe('getExerciseLibrary', () => {
  it('lists active exercises by name, then archived ones, with where each is used', async () => {
    const c = ctx()
    await archiveExercise(c, 'ex-rdl')
    const gym2 = await createGym(c, 'Hotel gym')
    await setGymSlotOverride(c, gym2, 'slot-lower-b-2', 'ex-leg-press')
    await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-09-28',
      exercises: [{ slotId: 'slot-lower-a-1', exerciseId: 'ex-smith-squat', sets: [[220, 8]] }],
    })

    const library = await readOnly(c, () => getExerciseLibrary(c))
    expect(library).toHaveLength(33)
    const names = library.map((l) => l.exercise.name)
    expect(names.slice(0, 4)).toEqual([
      'Barbell shrug',
      'Bulgarian split squat',
      'Cable crossover',
      'Cable crunch',
    ])
    expect(names.at(-1)).toBe('Romanian deadlift')
    expect(library.at(-1)).toMatchObject({ archived: true })
    expect(library.filter((l) => l.archived)).toHaveLength(1)

    const byId = new Map(library.map((l) => [l.exercise.id, l]))
    expect(byId.get('ex-leg-extension')!.usedInSlots).toEqual([
      {
        slotId: 'slot-lower-a-2',
        label: 'Leg extension',
        dayId: 'day-lower-a',
        dayName: 'Lower A',
        dayArchived: false,
        role: 'default',
        gymId: null,
        gymName: null,
      },
      expect.objectContaining({ slotId: 'slot-lower-b-5', dayName: 'Lower B', role: 'default' }),
    ])
    expect(byId.get('ex-leg-press')!.usedInSlots).toEqual([
      expect.objectContaining({ slotId: 'slot-lower-b-2', role: 'alternate', gymId: null }),
      expect.objectContaining({ slotId: 'slot-lower-b-2', role: 'override', gymName: 'Hotel gym' }),
    ])
    expect(byId.get('ex-hyper-y-w')!.usedInSlots).toEqual([])
    expect(byId.get('ex-smith-squat')!.hasHistory).toBe(true)
    expect(byId.get('ex-leg-extension')!.hasHistory).toBe(false)
    expect(byId.get('ex-overhead-press')!.muscles).toEqual([
      { muscleId: 'front_delts', name: 'Front delts', weight: 1 },
      { muscleId: 'side_delts', name: 'Side delts', weight: 0.5 },
      { muscleId: 'triceps', name: 'Triceps', weight: 0.5 },
    ])
  })
})

describe('getExerciseDetail', () => {
  it('adds gym steps, track starts and logged-session counts', async () => {
    const c = ctx()
    const gym2 = await createGym(c, 'Hotel gym')
    await setGymStep(c, gym2, 'ex-leg-extension', 7.5)
    await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-09-28',
      exercises: [{ slotId: 'slot-lower-a-2', exerciseId: 'ex-leg-extension', sets: [[170, 12]] }],
    })
    await insertSession(c, {
      programDayId: 'day-lower-b',
      date: '2026-10-02',
      exercises: [{ slotId: 'slot-lower-b-5', exerciseId: 'ex-leg-extension', sets: [[170, 13]] }],
    })
    await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-10-05',
      voided: true,
      exercises: [{ slotId: 'slot-lower-a-2', exerciseId: 'ex-leg-extension', sets: [[175, 10]] }],
    })

    const detail = (await readOnly(c, () => getExerciseDetail(c, 'ex-leg-extension')))!
    expect(detail.exercise).toMatchObject({ id: 'ex-leg-extension', stepLb: 5 })
    expect(detail.gymSteps).toEqual([{ gymId: gym2, gymName: 'Hotel gym', stepLb: 7.5 }])
    expect(detail.trackStarts).toEqual([
      {
        trackKey: 'day-lower-a|ex-leg-extension|gym-1',
        dayId: 'day-lower-a',
        dayName: 'Lower A',
        scope: 'gym-1',
        gymName: 'Gym 1',
        startLoadLb: 170,
        calibrate: false,
        updatedAt: expect.any(Number),
      },
      expect.objectContaining({ dayName: 'Lower B', startLoadLb: 170 }),
    ])
    expect(detail.loggedSessionCount).toBe(2)
    expect(detail.lastLoggedOn).toBe('2026-10-02')
    expect(detail.hasHistory).toBe(true)
    expect(detail.usedInSlots).toHaveLength(2)
  })

  it('shows shared tracks without a gym, and null for an unknown exercise', async () => {
    const c = ctx()
    const detail = (await getExerciseDetail(c, 'ex-weighted-chin-up'))!
    expect(detail.trackStarts).toEqual([
      expect.objectContaining({ scope: '*', gymName: null, startLoadLb: 50 }),
    ])
    expect(detail).toMatchObject({ loggedSessionCount: 0, lastLoggedOn: null, hasHistory: false })
    expect(await getExerciseDetail(c, 'ex-nope')).toBeNull()
  })
})

describe('getGyms and getMuscles', () => {
  it('lists gyms in order with their overrides and step counts', async () => {
    const c = ctx()
    const gym2 = await createGym(c, 'Hotel gym')
    await setGymSlotOverride(c, gym2, 'slot-push-2', 'ex-flat-db-press')
    await setGymSlotOverride(c, gym2, 'slot-lower-a-1', 'ex-leg-press')
    await setGymStep(c, gym2, 'ex-lateral-raise', 1.25)
    const gyms = await readOnly(c, () => getGyms(c))
    expect(gyms.map((g) => [g.gym.name, g.archived, g.overrideCount, g.stepOverrideCount])).toEqual(
      [
        ['Gym 1', false, 0, 0],
        ['Hotel gym', false, 2, 1],
      ],
    )
    expect(gyms[1]!.overrides).toEqual([
      {
        slotId: 'slot-lower-a-1',
        slotLabel: 'Smith machine squat',
        dayName: 'Lower A',
        exercise: { id: 'ex-leg-press', name: 'Leg press' },
      },
      expect.objectContaining({ slotId: 'slot-push-2', dayName: 'Push' }),
    ])
  })

  it('lists muscles in order with the band each one uses', async () => {
    const c = ctx()
    await updateMuscle(c, 'side_delts', { bandMin: 8, lagging: true })
    const muscles = await readOnly(c, () => getMuscles(c))
    expect(muscles.map((m) => m.muscle.id)).toEqual([
      'quads',
      'hamstrings',
      'glutes',
      'calves',
      'abs',
      'chest',
      'front_delts',
      'side_delts',
      'rear_delts',
      'back',
      'biceps',
      'triceps',
      'traps',
    ])
    expect(muscles[0]).toMatchObject({ band: { min: 10, max: 20 }, bandIsDefault: true })
    expect(muscles[7]).toMatchObject({
      muscle: { lagging: true },
      band: { min: 8, max: 20 },
      bandIsDefault: false,
      archived: false,
    })
  })
})
