import { afterEach, describe, expect, it } from 'vitest'
import { addDays, localDateOf } from '@/domain/dates'
import type { BodyEntry, LocalDate, SessionExercise } from '@/domain/types'
import { createTestCtx } from '../context'
import { getAppState } from '../settings'
import { loadTrainingModel } from './model'
import {
  abandonSession,
  addExercise,
  finishSession,
  LAST_GYM_ID_KEY,
  logSet,
  removeExercise,
  startSession,
  swapExercise,
  updateSet,
  voidSet,
} from './session'
import { startManualDeload } from './suggestions'
import { insertSession, type SetSpec } from './testFixtures'

type Ctx = ReturnType<typeof createTestCtx>
const ctxs: Ctx[] = []
function ctx(): Ctx {
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

const DAY_MS = 86_400_000

async function expectCode(p: Promise<unknown>, code: string, detail?: Record<string, unknown>) {
  await expect(p).rejects.toMatchObject({
    name: 'ServiceError',
    code,
    ...(detail && { detail: expect.objectContaining(detail) }),
  })
}

async function rowsOf(c: Ctx, sessionId: string): Promise<SessionExercise[]> {
  return c.db.sessionExercises.where('sessionId').equals(sessionId).sortBy('order')
}

async function rowFor(c: Ctx, sessionId: string, slotId: string): Promise<SessionExercise> {
  const row = (await rowsOf(c, sessionId)).find((r) => r.slotId === slotId)
  if (!row) throw new Error(`no row for ${slotId}`)
  return row
}

function userWeighIn(date: LocalDate, weightLb: number, voided = false): BodyEntry {
  return {
    date,
    weightLb,
    bodyFatPct: null,
    muscleMassLb: null,
    skeletalMusclePct: null,
    subcutFatPct: null,
    visceralRating: null,
    source: 'user',
    note: '',
    createdAt: 0,
    updatedAt: 0,
    voidedAt: voided ? 1 : null,
  }
}

async function addGym2(c: Ctx) {
  await c.db.gyms.add({ id: 'gym-2', name: 'Home', sortOrder: 1, archivedAt: null, createdAt: 0 })
}

describe('startSession', () => {
  it('snapshots every active slot of the day with its flowchart suggestion', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    const rows = await rowsOf(c, id)
    expect(rows.map((r) => [r.order, r.slotId])).toEqual(
      [1, 2, 3, 4, 5, 6].map((i) => [i - 1, `slot-lower-a-${i}`]),
    )
    expect(rows[0]).toEqual({
      id: expect.any(String),
      sessionId: id,
      order: 0,
      slotId: 'slot-lower-a-1',
      adHoc: false,
      exerciseId: 'ex-smith-squat',
      exerciseName: 'Smith machine squat',
      loadType: 'machine',
      perHand: false,
      unilateral: false,
      equipmentSpecific: true,
      gymScope: 'gym-1',
      isMainLift: true,
      isFinisher: false,
      swappedFromExerciseId: null,
      swapKind: 'none',
      prescription: {
        sets: 4,
        setsBeforeDeload: 4,
        repMin: 6,
        repMax: 10,
        rirMin: 1,
        rirMax: 2,
        restMinSec: 120,
        restMaxSec: 180,
        stepLb: 10,
      },
      muscleWeights: { quads: 1, glutes: 0.5 },
      suggestion: {
        loadLb: 220,
        repTargets: [6, 6, 6, 6],
        branch: 'start',
        missStreakBefore: 0,
        isCalibration: false,
        notices: [],
      },
      createdAt: c.now(),
    })
    expect(rows[1]).toMatchObject({
      exerciseId: 'ex-leg-extension',
      prescription: { sets: 3, repMin: 10, repMax: 15, stepLb: 5 },
      suggestion: { loadLb: 170, repTargets: [10, 10, 10] },
    })
  })

  it('writes the session row and remembers the gym', async () => {
    const c = ctx()
    const now = c.now()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    expect(await c.db.sessions.get(id)).toEqual({
      id,
      date: localDateOf(now),
      startedAt: now,
      finishedAt: null,
      tzOffsetMin: -new Date(now).getTimezoneOffset() || 0,
      status: 'in_progress',
      programDayId: 'day-lower-a',
      gymId: 'gym-1',
      isDeload: false,
      jointPain: false,
      // No weigh-in yet: the seed baseline.
      bodyweightLb: 163,
      bodyweightSource: 'seed',
      note: '',
      voidedAt: null,
      editedAt: null,
      createdAt: now,
    })
    expect(await getAppState(c, LAST_GYM_ID_KEY)).toBe('gym-1')
  })

  it('snapshots calibration slots, per-hand dumbbells and bodyweight-plus loads', async () => {
    const c = ctx()
    const push = await startSession(c, { gymId: 'gym-1', programDayId: 'day-push' })
    expect(await rowFor(c, push, 'slot-push-1')).toMatchObject({
      exerciseId: 'ex-incline-db-bench',
      perHand: true,
      gymScope: '*',
      suggestion: { loadLb: 70, isCalibration: false },
    })
    // "Set in week 1": blank load, calibration.
    expect(await rowFor(c, push, 'slot-push-2')).toMatchObject({
      exerciseId: 'ex-flat-machine-press',
      suggestion: {
        loadLb: null,
        repTargets: [8, 8, 8],
        branch: 'start',
        isCalibration: true,
        notices: [{ code: 'calibration_needed' }],
      },
    })
    // Rep range changed: the old load with a recalibrate badge.
    expect(await rowFor(c, push, 'slot-push-3')).toMatchObject({
      exerciseId: 'ex-machine-fly',
      suggestion: { loadLb: 205, isCalibration: true, notices: [{ code: 'recalibrate' }] },
    })
    await abandonSession(c, push)
    const pull = await startSession(c, { gymId: 'gym-1', programDayId: 'day-pull' })
    expect(await rowFor(c, pull, 'slot-pull-1')).toMatchObject({
      exerciseId: 'ex-weighted-chin-up',
      loadType: 'bodyweight_plus',
      suggestion: { loadLb: 50, repTargets: [6, 6, 6] },
    })
  })

  it('starts an ad hoc session with no exercises', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: null })
    expect(await c.db.sessions.get(id)).toMatchObject({ programDayId: null })
    expect(await rowsOf(c, id)).toEqual([])
  })

  it('uses the gym’s slot overrides, step overrides and gym scope', async () => {
    const c = ctx()
    await addGym2(c)
    await c.db.gymSlotOverrides.add({
      id: 'o1',
      gymId: 'gym-2',
      slotId: 'slot-lower-b-2',
      exerciseId: 'ex-leg-press',
    })
    await c.db.gymExerciseSettings.add({
      id: 'g1',
      gymId: 'gym-2',
      exerciseId: 'ex-leg-press',
      stepLb: 5,
    })
    const id = await startSession(c, { gymId: 'gym-2', programDayId: 'day-lower-b' })
    expect(await rowFor(c, id, 'slot-lower-b-2')).toMatchObject({
      exerciseId: 'ex-leg-press',
      swapKind: 'gym_override',
      swappedFromExerciseId: 'ex-bss',
      gymScope: 'gym-2',
      prescription: { sets: 3, repMin: 8, repMax: 12, stepLb: 5 },
      suggestion: { loadLb: null, isCalibration: true },
    })
    // Barbell work is shared across gyms: the deadlift keeps its start load.
    expect(await rowFor(c, id, 'slot-lower-b-1')).toMatchObject({
      gymScope: '*',
      swapKind: 'none',
      suggestion: { loadLb: 315 },
    })
    // A machine at a new gym starts with calibration.
    expect(await rowFor(c, id, 'slot-lower-b-3')).toMatchObject({
      exerciseId: 'ex-seated-leg-curl',
      gymScope: 'gym-2',
      suggestion: { loadLb: null, isCalibration: true },
    })
    expect(await getAppState(c, LAST_GYM_ID_KEY)).toBe('gym-2')
  })

  it('defaults to a deload while one is running, unless told otherwise', async () => {
    const c = ctx()
    await startManualDeload(c)
    const deload = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    expect(await c.db.sessions.get(deload)).toMatchObject({ isDeload: true })
    // ceil(4 × 0.5) = 2 sets; 10% of 220 = 22 → 2 whole steps of 10 → 200.
    expect(await rowFor(c, deload, 'slot-lower-a-1')).toMatchObject({
      prescription: { sets: 2, setsBeforeDeload: 4 },
      suggestion: { loadLb: 200, repTargets: [6, 6], notices: [{ code: 'deload' }] },
    })
    await abandonSession(c, deload)
    const normal = await startSession(c, {
      gymId: 'gym-1',
      programDayId: 'day-lower-a',
      isDeload: false,
    })
    expect(await c.db.sessions.get(normal)).toMatchObject({ isDeload: false })
    expect(await rowFor(c, normal, 'slot-lower-a-1')).toMatchObject({
      prescription: { sets: 4, setsBeforeDeload: 4 },
      suggestion: { loadLb: 220, notices: [] },
    })
  })

  describe('bodyweight', () => {
    it('takes an explicit bodyweight as manual', async () => {
      const c = ctx()
      const id = await startSession(c, { gymId: 'gym-1', programDayId: null, bodyweightLb: 170.5 })
      expect(await c.db.sessions.get(id)).toMatchObject({
        bodyweightLb: 170.5,
        bodyweightSource: 'manual',
      })
    })

    it('uses the same-day weigh-in', async () => {
      const c = ctx()
      await c.db.bodyEntries.put(userWeighIn(localDateOf(c.now()), 165.2))
      const id = await startSession(c, { gymId: 'gym-1', programDayId: null })
      expect(await c.db.sessions.get(id)).toMatchObject({
        bodyweightLb: 165.2,
        bodyweightSource: 'weighin',
      })
    })

    it('falls back to the trend weight when there is no weigh-in today', async () => {
      const c = ctx()
      const today = localDateOf(c.now())
      await c.db.bodyEntries.bulkPut([
        userWeighIn(addDays(today, -2), 164),
        userWeighIn(addDays(today, -1), 166),
        // A voided weigh-in today is ignored.
        userWeighIn(today, 190, true),
      ])
      const id = await startSession(c, { gymId: 'gym-1', programDayId: null })
      // EMA: T0 = 164, T1 = 164 + 0.1 × (166 − 164) = 164.2, carried forward to today.
      const session = await c.db.sessions.get(id)
      expect(session?.bodyweightSource).toBe('trend')
      expect(session?.bodyweightLb).toBeCloseTo(164.2, 9)
    })

    it('is unknown when there is no body data at all', async () => {
      const c = ctx()
      await c.db.bodyEntries.clear()
      const id = await startSession(c, { gymId: 'gym-1', programDayId: null })
      expect(await c.db.sessions.get(id)).toMatchObject({
        bodyweightLb: null,
        bodyweightSource: 'manual',
      })
    })

    it('rejects a non-positive explicit bodyweight', async () => {
      const c = ctx()
      await expectCode(
        startSession(c, { gymId: 'gym-1', programDayId: null, bodyweightLb: 0 }),
        'invalid_bodyweight',
      )
    })
  })

  it('allows only one session in progress', async () => {
    const c = ctx()
    const first = await startSession(c, { gymId: 'gym-1', programDayId: 'day-push' })
    await expectCode(
      startSession(c, { gymId: 'gym-1', programDayId: 'day-pull' }),
      'session_in_progress',
      { sessionId: first },
    )
    expect(await c.db.sessions.count()).toBe(1)
    await finishSession(c, first)
    await expect(startSession(c, { gymId: 'gym-1', programDayId: 'day-pull' })).resolves.toEqual(
      expect.any(String),
    )
  })

  it('validates the gym and the program day', async () => {
    const c = ctx()
    await expectCode(startSession(c, { gymId: 'nope', programDayId: null }), 'gym_not_found')
    await expectCode(startSession(c, { gymId: 'gym-1', programDayId: 'day-nope' }), 'day_not_found')
    await c.db.programDays.update('day-upper', { archivedAt: 1 })
    await expectCode(startSession(c, { gymId: 'gym-1', programDayId: 'day-upper' }), 'day_archived')
    await c.db.gyms.update('gym-1', { archivedAt: 1 })
    await expectCode(startSession(c, { gymId: 'gym-1', programDayId: 'day-push' }), 'gym_archived')
    expect(await c.db.sessions.count()).toBe(0)
  })
})

describe('logging sets', () => {
  async function lowerA(c: Ctx) {
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    const squat = await rowFor(c, id, 'slot-lower-a-1')
    const legExt = await rowFor(c, id, 'slot-lower-a-2')
    return { id, squat, legExt }
  }

  it('numbers sets per exercise after the highest index used, voided sets included', async () => {
    const c = ctx()
    const { id, squat, legExt } = await lowerA(c)
    const s0 = await logSet(c, { sessionExerciseId: squat.id, loadLb: 220, reps: 8 })
    expect(await c.db.setLogs.get(s0)).toEqual({
      id: s0,
      sessionId: id,
      sessionExerciseId: squat.id,
      exerciseId: 'ex-smith-squat',
      setIndex: 0,
      loadLb: 220,
      reps: 8,
      rir: null,
      isWarmup: false,
      note: '',
      loggedAt: c.now(),
      editedAt: null,
      voidedAt: null,
    })
    const s1 = await logSet(c, { sessionExerciseId: squat.id, loadLb: 220, reps: 7, rir: 1 })
    await voidSet(c, s1)
    const s2 = await logSet(c, {
      sessionExerciseId: squat.id,
      loadLb: 135,
      reps: 5,
      isWarmup: true,
      note: 'late warm-up',
    })
    const e0 = await logSet(c, { sessionExerciseId: legExt.id, loadLb: 170, reps: 12, rir: 0 })
    expect((await c.db.setLogs.get(s2))?.setIndex).toBe(2)
    expect(await c.db.setLogs.get(s2)).toMatchObject({ isWarmup: true, note: 'late warm-up' })
    expect(await c.db.setLogs.get(e0)).toMatchObject({ setIndex: 0, rir: 0 })
    // The last set was voided: the next index still moves on.
    await voidSet(c, s2)
    const s3 = await logSet(c, { sessionExerciseId: squat.id, loadLb: 220, reps: 6 })
    expect((await c.db.setLogs.get(s3))?.setIndex).toBe(3)
  })

  it('validates reps, RIR and load', async () => {
    const c = ctx()
    const { squat } = await lowerA(c)
    const base = { sessionExerciseId: squat.id, loadLb: 220, reps: 8 }
    await expectCode(logSet(c, { ...base, reps: -1 }), 'invalid_reps')
    await expectCode(logSet(c, { ...base, reps: 7.5 }), 'invalid_reps')
    await expectCode(logSet(c, { ...base, rir: 6 }), 'invalid_rir')
    await expectCode(logSet(c, { ...base, rir: 1.5 }), 'invalid_rir')
    await expectCode(logSet(c, { ...base, loadLb: Number.NaN }), 'invalid_load')
    await expectCode(logSet(c, { ...base, loadLb: -5 }), 'invalid_load')
    await expectCode(
      logSet(c, { ...base, sessionExerciseId: 'nope' }),
      'session_exercise_not_found',
    )
    expect(await c.db.setLogs.count()).toBe(0)
    // A failed set (0 reps) is a valid set.
    await expect(logSet(c, { ...base, reps: 0, rir: 0 })).resolves.toEqual(expect.any(String))
  })

  it('allows assisted (negative) added load only on bodyweight-plus exercises', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-pull' })
    const chin = await rowFor(c, id, 'slot-pull-1')
    const setId = await logSet(c, { sessionExerciseId: chin.id, loadLb: -20, reps: 8 })
    expect((await c.db.setLogs.get(setId))?.loadLb).toBe(-20)
  })

  it('corrects and voids sets while in progress, without stamping editedAt', async () => {
    const c = ctx()
    const { squat } = await lowerA(c)
    const setId = await logSet(c, { sessionExerciseId: squat.id, loadLb: 2200, reps: 8 })
    await updateSet(c, setId, { loadLb: 220, rir: 2, note: 'typo fixed' })
    expect(await c.db.setLogs.get(setId)).toMatchObject({
      loadLb: 220,
      reps: 8,
      rir: 2,
      note: 'typo fixed',
      editedAt: null,
    })
    await updateSet(c, setId, { rir: null })
    expect((await c.db.setLogs.get(setId))?.rir).toBeNull()
    await expectCode(updateSet(c, setId, { loadLb: -1 }), 'invalid_load')
    await expectCode(updateSet(c, setId, { reps: -2 }), 'invalid_reps')
    await expectCode(updateSet(c, setId, { setIndex: 5 } as never), 'field_not_editable')
    await expectCode(updateSet(c, 'nope', { reps: 5 }), 'set_not_found')
    await voidSet(c, setId)
    expect((await c.db.setLogs.get(setId))?.voidedAt).toBe(c.now())
    await expectCode(voidSet(c, setId), 'set_voided')
    await expectCode(updateSet(c, setId, { reps: 9 }), 'set_voided')
  })

  it('refuses logger writes once the session is finished or abandoned', async () => {
    for (const end of [finishSession, abandonSession]) {
      const c = ctx()
      const { id, squat } = await lowerA(c)
      const setId = await logSet(c, { sessionExerciseId: squat.id, loadLb: 220, reps: 8 })
      await end(c, id)
      const before = await c.db.setLogs.toArray()
      await expectCode(
        logSet(c, { sessionExerciseId: squat.id, loadLb: 220, reps: 8 }),
        'session_not_in_progress',
      )
      await expectCode(updateSet(c, setId, { reps: 10 }), 'session_not_in_progress')
      await expectCode(voidSet(c, setId), 'session_not_in_progress')
      expect(await c.db.setLogs.toArray()).toEqual(before)
    }
  })
})

describe('swapping, adding and removing exercises', () => {
  /** Two Lower B sessions of RDL in the deadlift slot: calibration at 185, then all at the top. */
  async function rdlHistory(c: Ctx) {
    for (const date of ['2026-09-11', '2026-09-18']) {
      await insertSession(c, {
        programDayId: 'day-lower-b',
        date,
        exercises: [
          {
            slotId: 'slot-lower-b-1',
            exerciseId: 'ex-rdl',
            sets: [
              [185, 8],
              [185, 8],
              [185, 8],
            ],
          },
        ],
      })
    }
  }

  it('replaces a slot row with the new exercise’s own track suggestion', async () => {
    const c = ctx()
    await rdlHistory(c)
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-b' })
    const before = await rowsOf(c, id)
    const deadlift = before[0]!
    // A set logged then voided doesn't block the swap and is dropped with the row.
    const voided = await logSet(c, { sessionExerciseId: deadlift.id, loadLb: 315, reps: 3 })
    await voidSet(c, voided)
    const newId = await swapExercise(c, deadlift.id, 'ex-rdl')
    expect(newId).not.toBe(deadlift.id)
    expect(await c.db.sessionExercises.get(deadlift.id)).toBeUndefined()
    expect(await c.db.setLogs.get(voided)).toBeUndefined()
    expect(await c.db.sessionExercises.get(newId)).toEqual({
      ...deadlift,
      id: newId,
      exerciseId: 'ex-rdl',
      exerciseName: 'Romanian deadlift',
      isMainLift: false,
      swapKind: 'one_off',
      swappedFromExerciseId: 'ex-deadlift',
      // The slot's regime is unchanged.
      prescription: deadlift.prescription,
      // RDL's own Lower B track: calibration at 185, then every set at the top → +10.
      suggestion: {
        loadLb: 195,
        repTargets: [5, 5, 5],
        branch: 'step',
        missStreakBefore: 0,
        isCalibration: false,
        notices: [],
      },
      createdAt: c.now(),
    })
    // Every other row is untouched.
    expect((await rowsOf(c, id)).slice(1)).toEqual(before.slice(1))

    // Swapping back restores the plain row.
    const backId = await swapExercise(c, newId, 'ex-deadlift')
    expect(await c.db.sessionExercises.get(backId)).toMatchObject({
      order: 0,
      slotId: 'slot-lower-b-1',
      exerciseId: 'ex-deadlift',
      swapKind: 'none',
      swappedFromExerciseId: null,
      suggestion: deadlift.suggestion,
    })
  })

  it('keeps the deload cut when swapping in a deload session', async () => {
    const c = ctx()
    await rdlHistory(c)
    const id = await startSession(c, {
      gymId: 'gym-1',
      programDayId: 'day-lower-b',
      isDeload: true,
    })
    const deadlift = await rowFor(c, id, 'slot-lower-b-1')
    const newId = await swapExercise(c, deadlift.id, 'ex-rdl')
    // ceil(3 × 0.5) = 2 sets; 10% of 195 = 19.5 → 1 whole step → 185.
    expect(await c.db.sessionExercises.get(newId)).toMatchObject({
      prescription: { sets: 2, setsBeforeDeload: 3, repMin: 5, repMax: 8 },
      suggestion: { loadLb: 185, repTargets: [5, 5], notices: [{ code: 'deload' }] },
    })
  })

  it('refuses a swap once sets are logged, or to an invalid exercise', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-b' })
    const deadlift = await rowFor(c, id, 'slot-lower-b-1')
    await expectCode(swapExercise(c, deadlift.id, 'ex-deadlift'), 'same_exercise')
    await expectCode(swapExercise(c, deadlift.id, 'ex-nope'), 'exercise_not_found')
    await c.db.exercises.update('ex-rdl', { archivedAt: 1 })
    await expectCode(swapExercise(c, deadlift.id, 'ex-rdl'), 'exercise_archived')
    await logSet(c, { sessionExerciseId: deadlift.id, loadLb: 315, reps: 5 })
    await expectCode(swapExercise(c, deadlift.id, 'ex-leg-press'), 'has_sets', {
      sessionExerciseId: deadlift.id,
    })
    await expectCode(swapExercise(c, 'nope', 'ex-rdl'), 'session_exercise_not_found')
    expect(await c.db.sessionExercises.get(deadlift.id)).toEqual(deadlift)
  })

  it('adds a finisher at the end with no suggested load before any history', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    const rowId = await addExercise(c, id, 'ex-barbell-shrug')
    expect(await c.db.sessionExercises.get(rowId)).toEqual({
      id: rowId,
      sessionId: id,
      order: 6,
      slotId: null,
      adHoc: true,
      exerciseId: 'ex-barbell-shrug',
      exerciseName: 'Barbell shrug',
      loadType: 'barbell',
      perHand: false,
      unilateral: false,
      equipmentSpecific: false,
      gymScope: '*',
      isMainLift: false,
      isFinisher: true,
      swappedFromExerciseId: null,
      swapKind: 'none',
      prescription: {
        sets: 3,
        setsBeforeDeload: 3,
        repMin: 8,
        repMax: 12,
        rirMin: 0,
        rirMax: 1,
        restMinSec: 90,
        restMaxSec: 90,
        stepLb: 5,
      },
      muscleWeights: { traps: 1 },
      suggestion: {
        loadLb: null,
        repTargets: [8, 8, 8],
        branch: 'start',
        missStreakBefore: 0,
        isCalibration: false,
        notices: [],
      },
      createdAt: c.now(),
    })
  })

  it('suggests the last working load of the exercise’s series for an added exercise', async () => {
    const c = ctx()
    const shrug = (date: string, sets: SetSpec[], extra = {}) =>
      insertSession(c, {
        programDayId: null,
        date,
        ...extra,
        exercises: [{ exerciseId: 'ex-barbell-shrug', sets }],
      })
    await shrug('2026-09-10', [[135, 12]])
    await shrug('2026-09-17', [
      [155, 10],
      [165, 8],
      { loadLb: 95, reps: 15, isWarmup: true },
      { loadLb: 500, reps: 1, voided: true },
    ])
    // Voided and abandoned sessions don't count.
    await shrug('2026-09-20', [[300, 8]], { voided: true })
    await shrug('2026-09-21', [[300, 8]], { status: 'abandoned' })
    const id = await startSession(c, { gymId: 'gym-1', programDayId: null })
    const rowId = await addExercise(c, id, 'ex-barbell-shrug')
    expect(await c.db.sessionExercises.get(rowId)).toMatchObject({
      order: 0,
      suggestion: { loadLb: 165, branch: 'start', repTargets: [8, 8, 8] },
    })
  })

  it('swaps an ad hoc row like adding the new exercise', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-pull' })
    const shrugRow = await addExercise(c, id, 'ex-barbell-shrug')
    const yw = await swapExercise(c, shrugRow, 'ex-hyper-y-w')
    expect(await c.db.sessionExercises.get(yw)).toMatchObject({
      order: 7,
      slotId: null,
      adHoc: true,
      exerciseId: 'ex-hyper-y-w',
      perHand: true,
      swapKind: 'one_off',
      swappedFromExerciseId: 'ex-barbell-shrug',
      prescription: { sets: 3, repMin: 8, repMax: 12, stepLb: 5 },
      suggestion: { loadLb: null, branch: 'start' },
    })
    const back = await swapExercise(c, yw, 'ex-barbell-shrug')
    expect(await c.db.sessionExercises.get(back)).toMatchObject({
      swapKind: 'none',
      swappedFromExerciseId: null,
    })
  })

  it('removes an exercise that has no sets', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    const [squat, legExt] = await rowsOf(c, id)
    const voided = await logSet(c, { sessionExerciseId: legExt!.id, loadLb: 170, reps: 12 })
    await voidSet(c, voided)
    await removeExercise(c, legExt!.id)
    expect(await c.db.sessionExercises.get(legExt!.id)).toBeUndefined()
    expect(await c.db.setLogs.get(voided)).toBeUndefined()
    expect((await rowsOf(c, id)).map((r) => r.order)).toEqual([0, 2, 3, 4, 5])
    await logSet(c, { sessionExerciseId: squat!.id, loadLb: 220, reps: 8 })
    await expectCode(removeExercise(c, squat!.id), 'has_sets')
    await expectCode(removeExercise(c, 'nope'), 'session_exercise_not_found')
  })

  it('refuses exercise changes once the session is over', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    const squat = await rowFor(c, id, 'slot-lower-a-1')
    await finishSession(c, id)
    const before = await rowsOf(c, id)
    await expectCode(swapExercise(c, squat.id, 'ex-leg-press'), 'session_not_in_progress')
    await expectCode(addExercise(c, id, 'ex-barbell-shrug'), 'session_not_in_progress')
    await expectCode(removeExercise(c, squat.id), 'session_not_in_progress')
    await expectCode(addExercise(c, 'nope', 'ex-barbell-shrug'), 'session_not_found')
    expect(await rowsOf(c, id)).toEqual(before)
  })
})

describe('finishing and abandoning', () => {
  it('finishes with joint pain and a note, and the session becomes history', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    const squat = await rowFor(c, id, 'slot-lower-a-1')
    for (let i = 0; i < 4; i++) {
      await logSet(c, { sessionExerciseId: squat.id, loadLb: 220, reps: 10, rir: 1 })
    }
    c.advance(3_600_000)
    await finishSession(c, id, { jointPain: true, note: 'left knee' })
    expect(await c.db.sessions.get(id)).toMatchObject({
      status: 'finished',
      finishedAt: c.now(),
      jointPain: true,
      note: 'left knee',
      editedAt: null,
    })
    await expectCode(finishSession(c, id), 'session_not_in_progress')
    // Every set at the top → +1 step next time.
    c.advance(DAY_MS)
    const next = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    expect(await rowFor(c, next, 'slot-lower-a-1')).toMatchObject({
      suggestion: { loadLb: 230, branch: 'step' },
    })
  })

  it('abandons a session, which never counts toward progression', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    const squat = await rowFor(c, id, 'slot-lower-a-1')
    for (let i = 0; i < 4; i++) {
      await logSet(c, { sessionExerciseId: squat.id, loadLb: 220, reps: 10 })
    }
    await abandonSession(c, id)
    expect(await c.db.sessions.get(id)).toMatchObject({
      status: 'abandoned',
      finishedAt: c.now(),
    })
    await expectCode(abandonSession(c, id), 'session_not_in_progress')
    const model = await loadTrainingModel(c)
    expect(model.inProgressSession()).toBeNull()
    const next = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    expect(await rowFor(c, next, 'slot-lower-a-1')).toMatchObject({
      suggestion: { loadLb: 220, branch: 'start' },
    })
  })

  it('validates the finish input', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: null })
    await expectCode(finishSession(c, id, { jointPain: 'yes' as never }), 'invalid_joint_pain')
    await expectCode(finishSession(c, id, { note: 5 as never }), 'invalid_note')
    await expectCode(finishSession(c, 'nope'), 'session_not_found')
    expect((await c.db.sessions.get(id))?.status).toBe('in_progress')
  })
})
