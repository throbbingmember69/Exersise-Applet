import { afterEach, describe, expect, it } from 'vitest'
import type { Regime } from '@/domain/types'
import { createTestCtx, type ServiceCtx } from '../context'
import { isServiceError, type ServiceError } from '../errors'
import { updateSettings } from '../settings'
import { loadTrainingModel } from '../training/model'
import { insertSession } from '../training/testFixtures'
import {
  archiveDay,
  archiveExercise,
  archiveGym,
  archiveSlot,
  createDay,
  createExercise,
  createGym,
  createMuscle,
  createSlot,
  renameGym,
  reorderDays,
  reorderSlots,
  restoreDay,
  restoreExercise,
  restoreGym,
  restoreSlot,
  setGymSlotOverride,
  setGymStep,
  setTrackStart,
  updateDay,
  updateExercise,
  updateMuscle,
  updateSlot,
  type ExerciseInput,
  type SlotInput,
} from './commands'
import { getProgramOverview } from './queries'

type TestCtx = ReturnType<typeof createTestCtx>
const ctxs: TestCtx[] = []
function ctx(opts?: Parameters<typeof createTestCtx>[0]) {
  const c = createTestCtx(opts)
  ctxs.push(c)
  return c
}
afterEach(async () => {
  for (const c of ctxs.splice(0)) {
    c.db.close()
    await c.db.delete()
  }
})

const T0 = Date.UTC(2026, 8, 24, 12)

async function expectServiceError(p: Promise<unknown>, code: string): Promise<ServiceError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  )
  expect(isServiceError(e, code), `expected ServiceError ${code}, got ${String(e)}`).toBe(true)
  return e as ServiceError
}

/** Every row of every program table, to prove a rejected command wrote nothing. */
async function programSnapshot(c: Pick<ServiceCtx, 'db'>) {
  const { db } = c
  return {
    days: await db.programDays.toArray(),
    slots: await db.programSlots.toArray(),
    exercises: await db.exercises.toArray(),
    gyms: await db.gyms.toArray(),
    overrides: await db.gymSlotOverrides.toArray(),
    gymSettings: await db.gymExerciseSettings.toArray(),
    trackStarts: await db.trackStarts.toArray(),
    muscles: await db.muscles.toArray(),
  }
}

async function weeklySets(c: Pick<ServiceCtx, 'db'>, muscleId: string): Promise<number> {
  const overview = await getProgramOverview(c)
  return overview.weekly.muscles.find((m) => m.muscleId === muscleId)!.sets
}

const REGIME: Regime = {
  sets: 3,
  repMin: 8,
  repMax: 12,
  rirMin: 1,
  rirMax: 2,
  restMinSec: 90,
  restMaxSec: 120,
}

const NEW_EXERCISE: ExerciseInput = {
  name: 'Pendulum squat',
  loadType: 'machine',
  stepLb: 10,
  defaultRegime: REGIME,
  muscleWeights: { quads: 1, glutes: 0.5 },
}

describe('program days', () => {
  it('creates a day at the end of the program', async () => {
    const c = ctx()
    const id = await createDay(c, '  Arms  ', 0)
    expect(await c.db.programDays.get(id)).toEqual({
      id,
      name: 'Arms',
      weekday: 0,
      order: 5,
      note: '',
      archivedAt: null,
    })
    const overview = await getProgramOverview(c)
    expect(overview.days.map((d) => d.day.name)).toEqual([
      'Lower A',
      'Push',
      'Pull',
      'Lower B',
      'Upper',
      'Arms',
    ])
  })

  it('validates names and weekdays', async () => {
    const c = ctx()
    await expectServiceError(createDay(c, '   '), 'invalid_name')
    await expectServiceError(createDay(c, 'Arms', 7 as never), 'invalid_weekday')
    await expectServiceError(createDay(c, 'Arms', 1.5 as never), 'invalid_weekday')
    await expectServiceError(updateDay(c, 'day-push', { name: '' }), 'invalid_name')
    await expectServiceError(updateDay(c, 'day-nope', { name: 'X' }), 'not_found')
  })

  it('renames a day, moves its weekday and edits its note', async () => {
    const c = ctx()
    await updateDay(c, 'day-lower-b', { name: 'Lower B (hinge)', weekday: 4, note: 'Thursday now' })
    expect(await c.db.programDays.get('day-lower-b')).toMatchObject({
      name: 'Lower B (hinge)',
      weekday: 4,
      note: 'Thursday now',
      order: 3,
    })
    await updateDay(c, 'day-lower-b', { weekday: null })
    expect(await c.db.programDays.get('day-lower-b')).toMatchObject({
      name: 'Lower B (hinge)',
      weekday: null,
    })
  })

  it('reorders days', async () => {
    const c = ctx()
    await reorderDays(c, ['day-upper', 'day-lower-b', 'day-pull', 'day-push', 'day-lower-a'])
    const days = (await c.db.programDays.toArray()).sort((a, b) => a.order - b.order)
    expect(days.map((d) => [d.id, d.order])).toEqual([
      ['day-upper', 0],
      ['day-lower-b', 1],
      ['day-pull', 2],
      ['day-push', 3],
      ['day-lower-a', 4],
    ])
  })

  it('rejects an order that leaves out, repeats or invents a day', async () => {
    const c = ctx()
    const before = await programSnapshot(c)
    const all = ['day-lower-a', 'day-push', 'day-pull', 'day-lower-b', 'day-upper']
    await expectServiceError(reorderDays(c, all.slice(1)), 'invalid_order')
    await expectServiceError(reorderDays(c, [...all, 'day-push']), 'invalid_order')
    await expectServiceError(reorderDays(c, [...all, 'day-x']), 'invalid_order')
    expect(await programSnapshot(c)).toEqual(before)
  })

  it('keeps unlisted archived days after the listed ones', async () => {
    const c = ctx()
    await archiveDay(c, 'day-push')
    await reorderDays(c, ['day-upper', 'day-lower-a', 'day-pull', 'day-lower-b'])
    const overview = await getProgramOverview(c)
    expect(overview.days.map((d) => [d.day.id, d.archived])).toEqual([
      ['day-upper', false],
      ['day-lower-a', false],
      ['day-pull', false],
      ['day-lower-b', false],
      ['day-push', true],
    ])
  })

  it('archiving a day takes its sets out of the weekly plan; restoring brings them back', async () => {
    const c = ctx()
    c.setNow(T0 + 1000)
    await archiveDay(c, 'day-lower-a')
    expect((await c.db.programDays.get('day-lower-a'))!.archivedAt).toBe(T0 + 1000)
    let overview = await getProgramOverview(c)
    expect(overview.weekly.totalSets).toBe(94 - 18)
    // Lower A's quads work: Smith squat 4 + leg extension 3.
    expect(await weeklySets(c, 'quads')).toBe(13.5 - 7)
    // Idempotent: archiving again keeps the original timestamp.
    c.advance(5000)
    await archiveDay(c, 'day-lower-a')
    expect((await c.db.programDays.get('day-lower-a'))!.archivedAt).toBe(T0 + 1000)

    await restoreDay(c, 'day-lower-a')
    overview = await getProgramOverview(c)
    expect(overview.weekly.totalSets).toBe(94)
    expect(await weeklySets(c, 'quads')).toBe(13.5)
  })
})

describe('program slots', () => {
  const legCurl: SlotInput = { exerciseId: 'ex-seated-leg-curl', ...REGIME, sets: 2 }

  it('adds a slot at the end of the day with its own regime', async () => {
    const c = ctx()
    const id = await createSlot(c, 'day-lower-a', legCurl)
    expect(await c.db.programSlots.get(id)).toEqual({
      id,
      programDayId: 'day-lower-a',
      order: 6,
      label: 'Seated leg curl',
      defaultExerciseId: 'ex-seated-leg-curl',
      alternateExerciseIds: [],
      ...REGIME,
      sets: 2,
      note: '',
      archivedAt: null,
    })
    // "Just under; add a leg-curl set if they lag": hamstrings 9 → 11.
    expect(await weeklySets(c, 'hamstrings')).toBe(11)
  })

  it('cleans up alternates: no duplicates, never the default itself', async () => {
    const c = ctx()
    const id = await createSlot(c, 'day-lower-b', {
      ...legCurl,
      label: ' Hamstring curl ',
      alternateExerciseIds: ['ex-rdl', 'ex-seated-leg-curl', 'ex-rdl', 'ex-deadlift'],
    })
    expect(await c.db.programSlots.get(id)).toMatchObject({
      label: 'Hamstring curl',
      alternateExerciseIds: ['ex-rdl', 'ex-deadlift'],
    })
    await expectServiceError(
      createSlot(c, 'day-lower-b', { ...legCurl, alternateExerciseIds: ['ex-nope'] }),
      'not_found',
    )
  })

  it.each([
    ['sets 0', { sets: 0 }],
    ['sets 11', { sets: 11 }],
    ['fractional sets', { sets: 2.5 }],
    ['repMin 0', { repMin: 0 }],
    ['repMin above repMax', { repMin: 13, repMax: 12 }],
    ['repMax 51', { repMax: 51 }],
    ['fractional reps', { repMax: 10.5 }],
    ['rirMin above rirMax', { rirMin: 3, rirMax: 2 }],
    ['rirMax 6', { rirMax: 6 }],
    ['negative RIR', { rirMin: -1 }],
    ['rest above 900 s', { restMaxSec: 901 }],
    ['rest min above max', { restMinSec: 180, restMaxSec: 120 }],
    ['negative rest', { restMinSec: -30 }],
    ['NaN sets', { sets: Number.NaN }],
  ])('rejects %s', async (_, bad) => {
    const c = ctx()
    const before = await programSnapshot(c)
    const e = await expectServiceError(
      createSlot(c, 'day-push', { ...legCurl, ...bad }),
      'invalid_regime',
    )
    expect(e.message.length).toBeGreaterThan(10)
    await expectServiceError(updateSlot(c, 'slot-push-1', bad), 'invalid_regime')
    expect(await programSnapshot(c)).toEqual(before)
  })

  it('accepts the edges of every range', async () => {
    const c = ctx()
    await createSlot(c, 'day-push', {
      exerciseId: 'ex-dip-machine',
      sets: 10,
      repMin: 1,
      repMax: 50,
      rirMin: 0,
      rirMax: 5,
      restMinSec: 0,
      restMaxSec: 900,
    })
    await createSlot(c, 'day-push', {
      ...legCurl,
      sets: 1,
      repMin: 50,
      repMax: 50,
      rirMin: 5,
      rirMax: 5,
    })
  })

  it('refuses archived days and exercises, and unknown ones', async () => {
    const c = ctx()
    await archiveDay(c, 'day-upper')
    await expectServiceError(createSlot(c, 'day-upper', legCurl), 'day_archived')
    await expectServiceError(createSlot(c, 'day-nope', legCurl), 'not_found')
    await archiveExercise(c, 'ex-rdl')
    await expectServiceError(
      createSlot(c, 'day-push', { ...legCurl, exerciseId: 'ex-rdl' }),
      'exercise_archived',
    )
    await expectServiceError(
      createSlot(c, 'day-push', { ...legCurl, alternateExerciseIds: ['ex-rdl'] }),
      'exercise_archived',
    )
    await expectServiceError(
      createSlot(c, 'day-push', { ...legCurl, exerciseId: 'ex-nope' }),
      'not_found',
    )
  })

  it('updates part of a slot and keeps the rest', async () => {
    const c = ctx()
    await updateSlot(c, 'slot-lower-a-3', { sets: 4, note: 'slow eccentric' })
    expect(await c.db.programSlots.get('slot-lower-a-3')).toMatchObject({
      sets: 4,
      repMin: 10,
      repMax: 15,
      rirMin: 0,
      rirMax: 1,
      restMinSec: 90,
      restMaxSec: 90,
      note: 'slow eccentric',
      label: 'Seated leg curl',
    })
    expect(await weeklySets(c, 'hamstrings')).toBe(10)
    // A merged range must still be valid.
    await expectServiceError(updateSlot(c, 'slot-lower-a-3', { repMax: 9 }), 'invalid_regime')
    await expectServiceError(updateSlot(c, 'slot-nope', { sets: 2 }), 'not_found')
  })

  it('promoting an alternate swaps it with the default', async () => {
    const c = ctx()
    await updateSlot(c, 'slot-lower-b-1', { defaultExerciseId: 'ex-rdl' })
    expect(await c.db.programSlots.get('slot-lower-b-1')).toMatchObject({
      defaultExerciseId: 'ex-rdl',
      alternateExerciseIds: ['ex-deadlift'],
      label: 'Deadlift (or Romanian deadlift)',
    })
    // Any library exercise can fill a slot; explicit alternates win.
    await updateSlot(c, 'slot-lower-b-1', {
      defaultExerciseId: 'ex-deadlift',
      alternateExerciseIds: ['ex-rdl', 'ex-hip-thrust'],
      label: '',
    })
    expect(await c.db.programSlots.get('slot-lower-b-1')).toMatchObject({
      defaultExerciseId: 'ex-deadlift',
      alternateExerciseIds: ['ex-rdl', 'ex-hip-thrust'],
      label: 'Deadlift',
    })
    await updateSlot(c, 'slot-lower-b-1', { alternateExerciseIds: [] })
    expect((await c.db.programSlots.get('slot-lower-b-1'))!.alternateExerciseIds).toEqual([])
  })

  it('reorders a day’s slots', async () => {
    const c = ctx()
    const ids = [
      'slot-pull-7',
      'slot-pull-1',
      'slot-pull-2',
      'slot-pull-3',
      'slot-pull-4',
      'slot-pull-5',
      'slot-pull-6',
    ]
    await reorderSlots(c, 'day-pull', ids)
    const overview = await getProgramOverview(c)
    expect(overview.days[2]!.slots.map((s) => s.slot.id)).toEqual(ids)
    await expectServiceError(reorderSlots(c, 'day-pull', ids.slice(1)), 'invalid_order')
    await expectServiceError(reorderSlots(c, 'day-pull', [...ids, 'slot-push-1']), 'invalid_order')
  })

  it('archives and restores slots', async () => {
    const c = ctx()
    await archiveSlot(c, 'slot-upper-4')
    expect(await weeklySets(c, 'side_delts')).toBe(8.5 - 4)
    await restoreSlot(c, 'slot-upper-4')
    expect(await weeklySets(c, 'side_delts')).toBe(8.5)
  })

  it('won’t restore a slot whose exercise has since been archived', async () => {
    const c = ctx()
    await archiveSlot(c, 'slot-upper-2')
    await archiveExercise(c, 'ex-cable-crossover')
    await expectServiceError(restoreSlot(c, 'slot-upper-2'), 'exercise_archived')
    await restoreExercise(c, 'ex-cable-crossover')
    await restoreSlot(c, 'slot-upper-2')
    expect((await c.db.programSlots.get('slot-upper-2'))!.archivedAt).toBeNull()
  })
})

describe('program edits affect only future sessions', () => {
  it('editing a slot and its exercise leaves a past session’s rows and results unchanged', async () => {
    const c = ctx()
    const sessionId = await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-09-28',
      exercises: [
        {
          slotId: 'slot-lower-a-1',
          exerciseId: 'ex-smith-squat',
          sets: [
            [220, 10],
            [220, 10],
            [220, 10],
            [220, 10],
          ],
        },
        {
          slotId: 'slot-lower-a-2',
          exerciseId: 'ex-leg-extension',
          sets: [
            [170, 12],
            [170, 11],
            [170, 10],
          ],
        },
      ],
    })
    const snapshot = async () => ({
      session: await c.db.sessions.get(sessionId),
      exercises: await c.db.sessionExercises.where('sessionId').equals(sessionId).toArray(),
      sets: await c.db.setLogs.where('sessionId').equals(sessionId).toArray(),
    })
    const before = await snapshot()
    const resultsBefore = (await loadTrainingModel(c)).sessionResults(sessionId)
    expect([...resultsBefore.values()].map((r) => r.branch)).toEqual(['step', 'same_plus_rep'])

    // Every kind of program edit.
    await updateSlot(c, 'slot-lower-a-1', { sets: 5, repMin: 5, repMax: 12, rirMin: 0 })
    await updateSlot(c, 'slot-lower-a-2', { defaultExerciseId: 'ex-leg-press' })
    await updateExercise(c, 'ex-smith-squat', {
      name: 'Smith squat (high bar)',
      stepLb: 5,
      muscleWeights: { quads: 1 },
      isMainLift: false,
    })
    await archiveSlot(c, 'slot-lower-a-6')
    await reorderSlots(c, 'day-lower-a', [
      'slot-lower-a-2',
      'slot-lower-a-1',
      'slot-lower-a-3',
      'slot-lower-a-4',
      'slot-lower-a-5',
    ])
    await updateDay(c, 'day-lower-a', { name: 'Legs', weekday: 0 })
    // A start load can't be changed under existing history (it would rescore the first session).
    await expectServiceError(
      setTrackStart(c, 'day-lower-a', 'ex-smith-squat', 'gym-1', {
        startLoadLb: 100,
        calibrate: true,
      }),
      'track_has_history',
    )

    expect(await snapshot()).toEqual(before)
    const resultsAfter = (await loadTrainingModel(c)).sessionResults(sessionId)
    expect(resultsAfter).toEqual(resultsBefore)
    // The next Lower A session sees the edits: step 220 → 225 with the new 5 lb step.
    const model = await loadTrainingModel(c)
    const slot = model.slotsOf('day-lower-a').find((s) => s.id === 'slot-lower-a-1')!
    expect(
      model.prescriptionFor({
        programDayId: 'day-lower-a',
        regime: slot,
        exerciseId: 'ex-smith-squat',
        gymId: 'gym-1',
        isDeload: false,
      }),
    ).toMatchObject({ loadLb: 225, sets: 5, repTargets: [5, 5, 5, 5, 5] })
  })
})

describe('exercises', () => {
  it('creates an exercise with load-type defaults', async () => {
    const c = ctx()
    c.setNow(T0 + 1)
    const id = await createExercise(c, { ...NEW_EXERCISE, name: ' Pendulum squat ' })
    expect(await c.db.exercises.get(id)).toEqual({
      id,
      name: 'Pendulum squat',
      loadType: 'machine',
      equipmentSpecific: true,
      unilateral: false,
      perHand: false,
      stepLb: 10,
      defaultRegime: REGIME,
      muscleWeights: { quads: 1, glutes: 0.5 },
      isMainLift: false,
      isFinisher: false,
      notes: '',
      archivedAt: null,
      createdAt: T0 + 1,
      updatedAt: T0 + 1,
    })
    const lunge = await createExercise(c, {
      ...NEW_EXERCISE,
      name: 'DB lunge',
      loadType: 'dumbbell',
      unilateral: true,
      notes: 'per hand',
    })
    expect(await c.db.exercises.get(lunge)).toMatchObject({
      equipmentSpecific: false,
      perHand: true,
      unilateral: true,
    })
    const custom = await createExercise(c, {
      ...NEW_EXERCISE,
      name: 'Plate-loaded row',
      muscleWeights: { back: 1, biceps: 0.5 },
      equipmentSpecific: false,
      isMainLift: true,
      isFinisher: false,
    })
    expect(await c.db.exercises.get(custom)).toMatchObject({
      loadType: 'machine',
      equipmentSpecific: false,
      isMainLift: true,
    })
  })

  it('validates exercises', async () => {
    const c = ctx()
    const before = await programSnapshot(c)
    const bad = (patch: Partial<ExerciseInput>) => createExercise(c, { ...NEW_EXERCISE, ...patch })
    await expectServiceError(bad({ name: ' ' }), 'invalid_name')
    await expectServiceError(bad({ loadType: 'kettlebell' as never }), 'invalid_load_type')
    await expectServiceError(bad({ stepLb: 0 }), 'invalid_step')
    await expectServiceError(bad({ stepLb: -5 }), 'invalid_step')
    await expectServiceError(bad({ stepLb: Number.POSITIVE_INFINITY }), 'invalid_step')
    await expectServiceError(bad({ defaultRegime: { ...REGIME, repMin: 20 } }), 'invalid_regime')
    await expectServiceError(bad({ muscleWeights: {} }), 'invalid_muscle_weights')
    await expectServiceError(bad({ muscleWeights: { quads: 0.5 } }), 'invalid_muscle_weights')
    await expectServiceError(
      bad({ muscleWeights: { quads: 0.75 as never } }),
      'invalid_muscle_weights',
    )
    await expectServiceError(bad({ muscleWeights: { forearms: 1 } }), 'invalid_muscle_weights')
    await expectServiceError(bad({ isFinisher: 'yes' as never }), 'invalid_input')
    expect(await programSnapshot(c)).toEqual(before)
  })

  it('keeps names unique, pointing at an archived namesake', async () => {
    const c = ctx()
    let e = await expectServiceError(
      createExercise(c, { ...NEW_EXERCISE, name: 'leg EXTENSION' }),
      'duplicate_name',
    )
    expect(e.message).toBe("There's already an exercise called Leg extension.")
    await archiveExercise(c, 'ex-rdl')
    e = await expectServiceError(
      createExercise(c, { ...NEW_EXERCISE, name: 'Romanian Deadlift' }),
      'duplicate_name',
    )
    expect(e.message).toMatch(/archived exercise .* Restore it instead/)
    expect(e.detail).toEqual({ id: 'ex-rdl' })
    await expectServiceError(
      updateExercise(c, 'ex-leg-press', { name: 'Hip thrust' }),
      'duplicate_name',
    )
    // Renaming an exercise to its own name (any case) is fine.
    await updateExercise(c, 'ex-leg-press', { name: 'LEG PRESS' })
  })

  it('updates an exercise and moves load-type defaults with the load type', async () => {
    const c = ctx()
    c.setNow(T0 + 99)
    await updateExercise(c, 'ex-hip-thrust', { loadType: 'barbell', stepLb: 5, notes: 'Pad!' })
    expect(await c.db.exercises.get('ex-hip-thrust')).toMatchObject({
      loadType: 'barbell',
      equipmentSpecific: false,
      perHand: false,
      stepLb: 5,
      notes: 'Pad!',
      updatedAt: T0 + 99,
    })
    // A flag set away from its default is left alone.
    await updateExercise(c, 'ex-leg-press', { equipmentSpecific: false })
    await updateExercise(c, 'ex-leg-press', { loadType: 'cable' })
    expect(await c.db.exercises.get('ex-leg-press')).toMatchObject({
      loadType: 'cable',
      equipmentSpecific: false,
    })
    // The patch wins over the load-type default.
    await updateExercise(c, 'ex-db-hammer-curl', { loadType: 'cable', perHand: true })
    expect(await c.db.exercises.get('ex-db-hammer-curl')).toMatchObject({
      equipmentSpecific: true,
      perHand: true,
    })
  })

  it('edits the default regime and muscle weights', async () => {
    const c = ctx()
    await updateExercise(c, 'ex-barbell-shrug', {
      defaultRegime: { sets: 4, repMax: 15 },
      muscleWeights: { traps: 1, back: 0.5 },
    })
    expect(await c.db.exercises.get('ex-barbell-shrug')).toMatchObject({
      defaultRegime: { sets: 4, repMin: 8, repMax: 15, rirMin: 0, rirMax: 1 },
      muscleWeights: { traps: 1, back: 0.5 },
    })
    await expectServiceError(
      updateExercise(c, 'ex-barbell-shrug', { muscleWeights: { back: 0.5 } }),
      'invalid_muscle_weights',
    )
    await expectServiceError(updateExercise(c, 'ex-nope', { stepLb: 5 }), 'not_found')
  })

  it('refuses to archive an exercise the program uses', async () => {
    const c = ctx()
    const e = await expectServiceError(archiveExercise(c, 'ex-leg-extension'), 'exercise_in_use')
    expect(e.detail).toEqual({ slotIds: ['slot-lower-a-2', 'slot-lower-b-5'] })
    expect(e.message).toBe(
      'Leg extension is used in the program (Lower A, Lower B). Pick another exercise for those slots first.',
    )
    // A gym's override counts as use, too.
    const gym2 = await createGym(c, 'Hotel gym')
    await setGymSlotOverride(c, gym2, 'slot-lower-a-1', 'ex-leg-press')
    const e2 = await expectServiceError(archiveExercise(c, 'ex-leg-press'), 'exercise_in_use')
    expect(e2.message).toMatch(/Lower A at Hotel gym/)
    // Once no active slot uses it, it can go.
    await setGymSlotOverride(c, gym2, 'slot-lower-a-1', null)
    await archiveExercise(c, 'ex-leg-press') // it was only an alternate on Lower B
    expect((await c.db.exercises.get('ex-leg-press'))!.archivedAt).toBe(T0)
  })

  it('archives an exercise whose only slot is archived, and restores it', async () => {
    const c = ctx()
    await archiveSlot(c, 'slot-pull-5')
    c.advance(10)
    await archiveExercise(c, 'ex-face-pull')
    expect(await c.db.exercises.get('ex-face-pull')).toMatchObject({
      archivedAt: T0 + 10,
      updatedAt: T0 + 10,
    })
    await restoreExercise(c, 'ex-face-pull')
    expect((await c.db.exercises.get('ex-face-pull'))!.archivedAt).toBeNull()
  })
})

describe('gyms', () => {
  it('creates, renames, archives and restores gyms', async () => {
    const c = ctx()
    const id = await createGym(c, ' Hotel gym ')
    expect(await c.db.gyms.get(id)).toEqual({
      id,
      name: 'Hotel gym',
      sortOrder: 1,
      archivedAt: null,
      createdAt: T0,
    })
    await expectServiceError(createGym(c, 'hotel GYM'), 'duplicate_name')
    await expectServiceError(createGym(c, ''), 'invalid_name')
    await renameGym(c, id, 'Work gym')
    await expectServiceError(renameGym(c, id, 'Gym 1'), 'duplicate_name')
    expect((await c.db.gyms.get(id))!.name).toBe('Work gym')

    await archiveGym(c, 'gym-1')
    expect((await c.db.gyms.get('gym-1'))!.archivedAt).toBe(T0)
    const e = await expectServiceError(archiveGym(c, id), 'last_gym')
    expect(e.message).toBe("Work gym is your only gym, so it can't be archived.")
    await restoreGym(c, 'gym-1')
    await archiveGym(c, id)
  })

  it('the only gym can’t be archived', async () => {
    const c = ctx()
    await expectServiceError(archiveGym(c, 'gym-1'), 'last_gym')
  })

  it('sets, changes and clears a per-gym slot override (one per gym and slot)', async () => {
    const c = ctx()
    const gym2 = await createGym(c, 'Hotel gym')
    await setGymSlotOverride(c, gym2, 'slot-lower-a-1', 'ex-leg-press')
    await setGymSlotOverride(c, gym2, 'slot-lower-a-1', 'ex-bss')
    expect(await c.db.gymSlotOverrides.toArray()).toEqual([
      { id: expect.any(String), gymId: gym2, slotId: 'slot-lower-a-1', exerciseId: 'ex-bss' },
    ])
    let model = await loadTrainingModel(c)
    const slot = model.slotsOf('day-lower-a')[0]!
    expect(model.resolveSlotExercise(slot, gym2)).toMatchObject({
      exercise: { id: 'ex-bss' },
      swapKind: 'gym_override',
    })
    expect(model.resolveSlotExercise(slot, 'gym-1').exercise.id).toBe('ex-smith-squat')

    // Choosing the slot's own default removes the override.
    await setGymSlotOverride(c, gym2, 'slot-lower-a-1', 'ex-smith-squat')
    expect(await c.db.gymSlotOverrides.count()).toBe(0)
    await setGymSlotOverride(c, gym2, 'slot-lower-a-1', 'ex-leg-press')
    await setGymSlotOverride(c, gym2, 'slot-lower-a-1', null)
    expect(await c.db.gymSlotOverrides.count()).toBe(0)
    model = await loadTrainingModel(c)
    expect(model.resolveSlotExercise(slot, gym2).swapKind).toBe('none')
  })

  it('validates overrides', async () => {
    const c = ctx()
    await archiveExercise(c, 'ex-rdl')
    await expectServiceError(
      setGymSlotOverride(c, 'gym-1', 'slot-lower-b-1', 'ex-rdl'),
      'exercise_archived',
    )
    await expectServiceError(setGymSlotOverride(c, 'gym-1', 'slot-nope', 'ex-bss'), 'not_found')
    await expectServiceError(
      setGymSlotOverride(c, 'gym-nope', 'slot-lower-b-1', 'ex-bss'),
      'not_found',
    )
    await expectServiceError(
      setGymSlotOverride(c, 'gym-1', 'slot-lower-b-1', 'ex-nope'),
      'not_found',
    )
    expect(await c.db.gymSlotOverrides.count()).toBe(0)
  })

  it('sets, changes and clears a gym’s own step for an exercise', async () => {
    const c = ctx()
    const gym2 = await createGym(c, 'Hotel gym')
    await setGymStep(c, gym2, 'ex-lateral-raise', 5)
    await setGymStep(c, gym2, 'ex-lateral-raise', 1.25)
    expect(await c.db.gymExerciseSettings.toArray()).toEqual([
      { id: expect.any(String), gymId: gym2, exerciseId: 'ex-lateral-raise', stepLb: 1.25 },
    ])
    let model = await loadTrainingModel(c)
    expect(model.stepFor('ex-lateral-raise', gym2)).toBe(1.25)
    expect(model.stepFor('ex-lateral-raise', 'gym-1')).toBe(2.5)
    await expectServiceError(setGymStep(c, gym2, 'ex-lateral-raise', 0), 'invalid_step')
    await setGymStep(c, gym2, 'ex-lateral-raise', null)
    expect(await c.db.gymExerciseSettings.count()).toBe(0)
    model = await loadTrainingModel(c)
    expect(model.stepFor('ex-lateral-raise', gym2)).toBe(2.5)
  })
})

describe('setTrackStart', () => {
  async function prescribe(c: TestCtx, dayId: string, slotId: string, gymId = 'gym-1') {
    const model = await loadTrainingModel(c)
    const slot = model.slotsOf(dayId).find((s) => s.id === slotId)!
    return model.prescriptionFor({
      programDayId: dayId,
      regime: slot,
      exerciseId: model.resolveSlotExercise(slot, gymId).exercise.id,
      gymId,
      isDeload: false,
    })
  }

  it('sets where a track starts', async () => {
    const c = ctx()
    await setTrackStart(c, 'day-lower-a', 'ex-smith-squat', 'gym-1', {
      startLoadLb: 200,
      calibrate: false,
    })
    expect(await prescribe(c, 'day-lower-a', 'slot-lower-a-1')).toMatchObject({
      loadLb: 200,
      isCalibration: false,
    })
    // "Set in week 1" slot: a known load now, still a calibration session.
    await setTrackStart(c, 'day-push', 'ex-flat-machine-press', 'gym-1', {
      startLoadLb: 100,
      calibrate: true,
    })
    expect(await prescribe(c, 'day-push', 'slot-push-2')).toMatchObject({
      loadLb: 100,
      isCalibration: true,
    })
    expect(await c.db.trackStarts.get('day-push|ex-flat-machine-press|gym-1')).toEqual({
      trackKey: 'day-push|ex-flat-machine-press|gym-1',
      programDayId: 'day-push',
      exerciseId: 'ex-flat-machine-press',
      gymScope: 'gym-1',
      startLoadLb: 100,
      calibrate: true,
      updatedAt: T0,
    })
  })

  it('starts a machine at a new gym from a known load instead of calibrating', async () => {
    const c = ctx()
    const gym2 = await createGym(c, 'Hotel gym')
    expect(await prescribe(c, 'day-lower-a', 'slot-lower-a-1', gym2)).toMatchObject({
      loadLb: null,
      isCalibration: true,
    })
    await setTrackStart(c, 'day-lower-a', 'ex-smith-squat', gym2, {
      startLoadLb: 180,
      calibrate: false,
    })
    expect(await prescribe(c, 'day-lower-a', 'slot-lower-a-1', gym2)).toMatchObject({
      loadLb: 180,
      isCalibration: false,
    })
  })

  it('uses the shared scope for free weights and allows assisted (negative) bodyweight-plus loads', async () => {
    const c = ctx()
    await setTrackStart(c, 'day-pull', 'ex-weighted-chin-up', '*', {
      startLoadLb: -20,
      calibrate: false,
    })
    expect(await prescribe(c, 'day-pull', 'slot-pull-1')).toMatchObject({ loadLb: -20 })
    await setTrackStart(c, 'day-push', 'ex-incline-db-bench', '*', {
      startLoadLb: null,
      calibrate: false,
    })
    expect(await prescribe(c, 'day-push', 'slot-push-1')).toMatchObject({
      loadLb: null,
      isCalibration: true,
    })
  })

  it('is refused once the track has logged working sets', async () => {
    const c = ctx()
    // A session where the squat was skipped (no sets) doesn't count as history.
    await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-09-28',
      exercises: [{ slotId: 'slot-lower-a-1', exerciseId: 'ex-smith-squat', sets: [] }],
    })
    const start = { startLoadLb: 210, calibrate: false }
    await setTrackStart(c, 'day-lower-a', 'ex-smith-squat', 'gym-1', start)
    await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-09-30',
      exercises: [{ slotId: 'slot-lower-a-1', exerciseId: 'ex-smith-squat', sets: [[210, 8]] }],
    })
    const e = await expectServiceError(
      setTrackStart(c, 'day-lower-a', 'ex-smith-squat', 'gym-1', { ...start, startLoadLb: 150 }),
      'track_has_history',
    )
    expect(e.message).toMatch(/Smith machine squat already has logged sessions/)
    expect((await c.db.trackStarts.get('day-lower-a|ex-smith-squat|gym-1'))!.startLoadLb).toBe(210)
    // Other tracks of the same exercise are unaffected: Lower A at another gym has no history.
    const gym2 = await createGym(c, 'Hotel gym')
    await setTrackStart(c, 'day-lower-a', 'ex-smith-squat', gym2, start)
  })

  it('rejects the wrong scope, a bad load or unknown rows', async () => {
    const c = ctx()
    const before = await programSnapshot(c)
    const start = { startLoadLb: 100, calibrate: false }
    await expectServiceError(
      setTrackStart(c, 'day-lower-a', 'ex-smith-squat', '*', start),
      'invalid_scope',
    )
    await expectServiceError(
      setTrackStart(c, 'day-lower-a', 'ex-smith-squat', 'gym-9', start),
      'invalid_scope',
    )
    await expectServiceError(
      setTrackStart(c, 'day-push', 'ex-incline-db-bench', 'gym-1', start),
      'invalid_scope',
    )
    await expectServiceError(
      setTrackStart(c, 'day-push', 'ex-incline-db-bench', '*', { ...start, startLoadLb: -5 }),
      'invalid_load',
    )
    await expectServiceError(
      setTrackStart(c, 'day-push', 'ex-incline-db-bench', '*', {
        ...start,
        startLoadLb: Number.NaN,
      }),
      'invalid_load',
    )
    await expectServiceError(
      setTrackStart(c, 'day-nope', 'ex-incline-db-bench', '*', start),
      'not_found',
    )
    await expectServiceError(setTrackStart(c, 'day-push', 'ex-nope', '*', start), 'not_found')
    expect(await programSnapshot(c)).toEqual(before)
  })
})

describe('muscles', () => {
  it('sets a muscle’s own band, exemption and lagging flag', async () => {
    const c = ctx()
    const flagOf = async (id: string) =>
      (await getProgramOverview(c)).weekly.muscles.find((m) => m.muscleId === id)!
    expect(await flagOf('hamstrings')).toMatchObject({ sets: 9, flag: 'low' })
    await updateMuscle(c, 'hamstrings', { bandMin: 8, lagging: true })
    expect(await flagOf('hamstrings')).toMatchObject({
      flag: 'ok',
      band: { min: 8, max: 20 },
      bandIsDefault: false,
      lagging: true,
    })
    await updateMuscle(c, 'rear_delts', { exemptLow: true })
    expect(await flagOf('rear_delts')).toMatchObject({ flag: null, exemptLow: true })
    await updateMuscle(c, 'triceps', { bandMax: 15 })
    expect(await flagOf('triceps')).toMatchObject({ sets: 16, flag: 'high' })
    await updateMuscle(c, 'hamstrings', { bandMin: null, name: 'Hamstrings (knee flexion)' })
    expect(await flagOf('hamstrings')).toMatchObject({
      name: 'Hamstrings (knee flexion)',
      flag: 'low',
      bandIsDefault: true,
    })
  })

  it('rejects an inverted band, including against the global settings', async () => {
    const c = ctx()
    await expectServiceError(updateMuscle(c, 'quads', { bandMin: 12, bandMax: 10 }), 'invalid_band')
    await expectServiceError(updateMuscle(c, 'quads', { bandMin: 25 }), 'invalid_band')
    await expectServiceError(updateMuscle(c, 'quads', { bandMin: -1 }), 'invalid_band')
    await updateSettings(c, { weeklyVolumeMax: 30 })
    await updateMuscle(c, 'quads', { bandMin: 25 })
    await expectServiceError(updateMuscle(c, 'nope', { lagging: true }), 'not_found')
    await expectServiceError(updateMuscle(c, 'quads', { name: 'glutes' }), 'duplicate_name')
  })

  it('adds a muscle that exercises can then train', async () => {
    const c = ctx()
    const id = await createMuscle(c, 'Forearms')
    expect(await c.db.muscles.get(id)).toEqual({
      id,
      name: 'Forearms',
      sortOrder: 13,
      bandMin: null,
      bandMax: null,
      exemptLow: false,
      lagging: false,
      archivedAt: null,
    })
    await expectServiceError(createMuscle(c, 'forearms'), 'duplicate_name')
    await updateExercise(c, 'ex-db-hammer-curl', { muscleWeights: { biceps: 1, [id]: 0.5 } })
    expect(await weeklySets(c, id)).toBe(1)
  })
})
