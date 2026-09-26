// Regression tests for the M2 review findings on the training services (training-commands #1–#9,
// training-queries #1–#10; see docs/DESIGN.md lead notes). Each reproduces the reviewer's
// failing scenario.
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalDate } from '@/domain/types'
import { createTestCtx } from '../context'
import { isServiceError } from '../errors'
import { editSession } from './edit'
import { loadTrainingModel } from './model'
import {
  getProgressOverview,
  getSessionDetail,
  getSessionSummary,
  getStartOptions,
  getTrainingAlerts,
  previewSession,
} from './queries'
import {
  addExercise,
  finishSession,
  logSet,
  setSessionBodyweight,
  startSession,
  swapExercise,
  voidSet,
} from './session'
import { recordShown, respondSuggestion, startManualDeload } from './suggestions'
import { insertSession } from './testFixtures'

type Ctx = ReturnType<typeof createTestCtx>
const ctxs: Ctx[] = []
function make(): Ctx {
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

const d = (s: string) => s as LocalDate
const TODAY = d('2026-09-24') // createTestCtx's clock
const sets = (n: number, load: number, reps: number): [number, number][] =>
  Array.from({ length: n }, () => [load, reps])

async function rowOf(c: Ctx, sessionId: string, exerciseId: string) {
  const rows = await c.db.sessionExercises.where('sessionId').equals(sessionId).toArray()
  const row = rows.find((r) => r.exerciseId === exerciseId)
  if (!row) throw new Error(`no row for ${exerciseId}`)
  return row
}

async function expectCode(p: Promise<unknown>, code: string) {
  await p.then(
    () => expect.fail(`expected ServiceError ${code}`),
    (e) => {
      expect(isServiceError(e)).toBe(true)
      expect((e as { code: string }).code).toBe(code)
    },
  )
}

describe('commands', () => {
  it('#1: refuses a second row of the same exercise (swap or add)', async () => {
    const c = make()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    const curl = await rowOf(c, id, 'ex-seated-leg-curl')
    await expectCode(swapExercise(c, curl.id, 'ex-leg-extension'), 'exercise_in_session')
    await expectCode(addExercise(c, id, 'ex-leg-extension'), 'exercise_in_session')
    // Swapping a row to itself isn't a duplicate, and a new exercise is fine.
    await expect(addExercise(c, id, 'ex-barbell-shrug')).resolves.toBeTypeOf('string')
  })

  it('#2/#5 (queries): the start sheet shows the bodyweight startSession stores', async () => {
    const c = make()
    // A real weigh-in today (the seed baseline shares the date; it becomes a user row).
    await c.db.bodyEntries.put({
      date: TODAY,
      weightLb: 165.2,
      bodyFatPct: null,
      muscleMassLb: null,
      skeletalMusclePct: null,
      subcutFatPct: null,
      visceralRating: null,
      source: 'user',
      note: '',
      createdAt: 0,
      updatedAt: 0,
      voidedAt: null,
    })
    const opts = await getStartOptions(c, { today: TODAY })
    expect(opts.bodyweight).toEqual({ weightLb: 165.2, source: 'weighin', stale: false })
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-pull' })
    expect(await c.db.sessions.get(id)).toMatchObject({
      bodyweightLb: 165.2,
      bodyweightSource: 'weighin',
    })
  })

  it('#2: the logger can fix the bodyweight while in progress, not after', async () => {
    const c = make()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-pull' })
    await setSessionBodyweight(c, id, 166)
    expect(await c.db.sessions.get(id)).toMatchObject({
      bodyweightLb: 166,
      bodyweightSource: 'manual',
      editedAt: null,
    })
    await expectCode(setSessionBodyweight(c, id, -1), 'invalid_bodyweight')
    await finishSession(c, id, {})
    await expectCode(setSessionBodyweight(c, id, 170), 'session_not_in_progress')
  })

  it('#3: starting a deload retires any deload suggestion still shown', async () => {
    const c = make()
    const shown = await recordShown(c, { kind: 'deload', key: 'deload;joint_pain=a,b' })
    await startManualDeload(c)
    expect(await c.db.suggestions.get(shown)).toMatchObject({ status: 'accepted' })
  })

  it('#5: flags bodyweight-plus rows when the session has no bodyweight', async () => {
    const c = make()
    await c.db.bodyEntries.clear()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-pull' })
    expect((await c.db.sessions.get(id))?.bodyweightLb).toBeNull()
    expect((await rowOf(c, id, 'ex-weighted-chin-up')).suggestion.notices).toContainEqual({
      code: 'no_bodyweight',
    })
    expect((await rowOf(c, id, 'ex-machine-barbell-row')).suggestion.notices).not.toContainEqual({
      code: 'no_bodyweight',
    })
  })

  it('#7: ad hoc sessions are not deload sessions; ad hoc rows in a deload get the cut', async () => {
    const c = make()
    await startManualDeload(c)
    const adHoc = await startSession(c, { gymId: 'gym-1', programDayId: null })
    expect((await c.db.sessions.get(adHoc))?.isDeload).toBe(false)
    await finishSession(c, adHoc, {})

    const deload = await startSession(c, { gymId: 'gym-1', programDayId: 'day-pull' })
    expect((await c.db.sessions.get(deload))?.isDeload).toBe(true)
    const shrug = await addExercise(c, deload, 'ex-barbell-shrug')
    const row = await c.db.sessionExercises.get(shrug)
    // Finisher default regime: 3 sets → ceil(3 × 0.5) = 2 in a deload.
    expect(row?.prescription).toMatchObject({ sets: 2, setsBeforeDeload: 3 })
    expect(row?.suggestion.notices).toContainEqual({ code: 'deload' })
  })

  it('#8: rejects a non-boolean deload flag instead of storing it', async () => {
    const c = make()
    await expectCode(
      startSession(c, {
        gymId: 'gym-1',
        programDayId: null,
        isDeload: 'yes' as unknown as boolean,
      }),
      'invalid_deload',
    )
    expect(await c.db.sessions.count()).toBe(0)
  })

  it('#9: resubmitting the same bodyweight in Edit mode keeps its source', async () => {
    const c = make()
    const id = await insertSession(c, {
      programDayId: 'day-pull',
      date: '2026-09-23',
      bodyweightLb: 163,
      exercises: [
        { slotId: 'slot-pull-1', exerciseId: 'ex-weighted-chin-up', sets: sets(3, 50, 6) },
      ],
    })
    await c.db.sessions.update(id, { bodyweightSource: 'seed' })
    await editSession(c, id, { note: 'felt good', bodyweightLb: 163 })
    expect(await c.db.sessions.get(id)).toMatchObject({
      note: 'felt good',
      bodyweightSource: 'seed',
    })
    await editSession(c, id, { bodyweightLb: 164 })
    expect(await c.db.sessions.get(id)).toMatchObject({
      bodyweightLb: 164,
      bodyweightSource: 'manual',
    })
  })
})

describe('queries', () => {
  const SQUAT = { slotId: 'slot-lower-a-1', exerciseId: 'ex-smith-squat' }

  it('#2: a past session shows the suggestion that followed it, marked superseded', async () => {
    const c = make()
    const s1 = await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-09-28',
      exercises: [{ ...SQUAT, sets: sets(4, 220, 10) }],
    })
    const s2 = await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-10-05',
      exercises: [{ ...SQUAT, sets: sets(4, 230, 10) }],
    })
    const first = (await getSessionSummary(c, s1))!.exercises[0]!.next
    expect(first).toMatchObject({ loadLb: 230, branch: 'step', superseded: true })
    const latest = (await getSessionSummary(c, s2))!.exercises[0]!.next
    expect(latest).toMatchObject({ loadLb: 240, branch: 'step', superseded: false })
    expect((await getSessionDetail(c, s1))!.exercises[0]!.result.next?.loadLb).toBe(230)
  })

  it('#3: session detail lists voided sets for restoring in Edit mode', async () => {
    const c = make()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    const squat = await rowOf(c, id, 'ex-smith-squat')
    await logSet(c, { sessionExerciseId: squat.id, loadLb: 220, reps: 8 })
    const typo = await logSet(c, { sessionExerciseId: squat.id, loadLb: 2200, reps: 8 })
    await voidSet(c, typo)
    await finishSession(c, id, {})
    const detail = (await getSessionDetail(c, id))!
    const ex = detail.exercises.find((e) => e.exerciseId === 'ex-smith-squat')!
    expect(ex.sets.map((s) => s.loadLb)).toEqual([220])
    expect(ex.voidedSets.map((s) => [s.id, s.loadLb])).toEqual([[typo, 2200]])
  })

  const pull = (date: string, reps: number) => ({
    programDayId: 'day-pull',
    date,
    exercises: [
      { slotId: 'slot-pull-1', exerciseId: 'ex-weighted-chin-up', sets: sets(3, 50, reps) },
    ],
  })

  it('#4: a dismissed stall stays hidden (by its suggestion-log key)', async () => {
    const c = make()
    for (const [date, reps] of [
      ['2026-09-02', 6],
      ['2026-09-09', 6],
      ['2026-09-16', 5],
      ['2026-09-23', 6],
    ] as const) {
      await insertSession(c, pull(date, reps))
    }
    const [stall] = (await getTrainingAlerts(c, { asOf: d('2026-09-24') })).stalls
    expect(stall).toMatchObject({ exerciseId: 'ex-weighted-chin-up', status: null })
    const row = await recordShown(c, { kind: 'stall', key: stall!.key })
    expect((await getTrainingAlerts(c, { asOf: d('2026-09-24') })).stalls[0]?.status).toBe('shown')
    await respondSuggestion(c, row, 'dismissed')
    expect((await getTrainingAlerts(c, { asOf: d('2026-09-24') })).stalls).toEqual([])
  })

  it('#6: "change vs 4 weeks ago" never compares a point with itself', async () => {
    const c = make()
    await insertSession(c, pull('2026-06-01', 6))
    await insertSession(c, pull('2026-06-08', 7))
    const [item] = await getProgressOverview(c, { asOf: d('2026-09-25') })
    expect(item?.latest?.date).toBe('2026-06-08')
    expect(item?.changeVs4WeeksAgo?.since).not.toBe('2026-06-08')
  })

  it('#7: as-of answers ignore deloads accepted later', async () => {
    const c = make()
    c.setNow(Date.UTC(2026, 9, 10, 12))
    await startManualDeload(c)
    expect((await getTrainingAlerts(c, { asOf: d('2026-09-29') })).deload.active).toBe(false)
    expect((await getTrainingAlerts(c, { asOf: d('2026-10-10') })).deload.active).toBe(true)
  })

  it('#8: a retired lift no longer shows a stall or feeds the deload trigger', async () => {
    const c = make()
    for (const [date, reps] of [
      ['2026-09-02', 6],
      ['2026-09-09', 6],
      ['2026-09-16', 5],
      ['2026-09-23', 6],
    ] as const) {
      await insertSession(c, pull(date, reps))
    }
    await c.db.programSlots.update('slot-pull-1', { defaultExerciseId: 'ex-rocking-pulldown' })
    expect((await getTrainingAlerts(c, { asOf: d('2026-09-24') })).stalls).toEqual([])
    expect((await loadTrainingModel(c)).stallFlags()).toEqual([])
  })

  it('#9: no preview for an archived day or gym (startSession would refuse them)', async () => {
    const c = make()
    await c.db.programDays.update('day-push', { archivedAt: 1 })
    expect(
      await previewSession(c, { gymId: 'gym-1', programDayId: 'day-push', isDeload: false }),
    ).toBeNull()
  })

  it('#10: bad dates are refused with invalid_date', async () => {
    const c = make()
    await expectCode(getStartOptions(c, { today: d('2026-9-28') }), 'invalid_date')
    await expectCode(getTrainingAlerts(c, { asOf: d('garbage') }), 'invalid_date')
    await expectCode(getProgressOverview(c, { asOf: d('2026-02-30') }), 'invalid_date')
  })
})
