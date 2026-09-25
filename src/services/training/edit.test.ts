import { afterEach, describe, expect, it } from 'vitest'
import type { SessionExercise } from '@/domain/types'
import { createTestCtx } from '../context'
import {
  addSet,
  editSession,
  editSet,
  restoreSession,
  restoreSet,
  voidSession,
  voidSetInEdit,
} from './edit'
import { loadTrainingModel } from './model'
import { abandonSession, finishSession, logSet, startSession } from './session'

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

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ name: 'ServiceError', code })
}

async function rowsOf(c: Ctx, sessionId: string): Promise<SessionExercise[]> {
  return c.db.sessionExercises.where('sessionId').equals(sessionId).sortBy('order')
}

/** Squat suggestion for the next Lower A session at gym-1. */
async function nextSquat(c: Ctx) {
  const model = await loadTrainingModel(c)
  const slot = model.slotsOf('day-lower-a')[0]!
  return model.prescriptionFor({
    programDayId: 'day-lower-a',
    regime: slot,
    exerciseId: 'ex-smith-squat',
    gymId: 'gym-1',
    isDeload: false,
  })
}

/** A finished Lower A session whose last squat set has a reps typo (1 instead of 10). */
async function finishedWithTypo(c: Ctx) {
  const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
  const [squat] = await rowsOf(c, id)
  const setIds: string[] = []
  for (const reps of [10, 10, 10, 1]) {
    setIds.push(await logSet(c, { sessionExerciseId: squat!.id, loadLb: 220, reps, rir: 1 }))
  }
  await finishSession(c, id)
  c.advance(DAY_MS)
  return { id, squat: squat!, setIds }
}

describe('Edit mode on sets', () => {
  it('fixes a typo, stamps editedAt on the set and session, and re-derives the suggestion', async () => {
    const c = ctx()
    const { id, setIds } = await finishedWithTypo(c)
    const snapshots = await rowsOf(c, id)
    // As logged: a set below the range → first miss, same load.
    expect(await nextSquat(c)).toMatchObject({ loadLb: 220, branch: 'same_after_miss' })

    await editSet(c, setIds[3]!, { reps: 10, note: 'typo' })
    expect(await c.db.setLogs.get(setIds[3]!)).toMatchObject({
      reps: 10,
      note: 'typo',
      loadLb: 220,
      rir: 1,
      editedAt: c.now(),
      voidedAt: null,
    })
    expect(await c.db.sessions.get(id)).toMatchObject({ status: 'finished', editedAt: c.now() })
    // Other sets and the snapshots are untouched.
    expect((await c.db.setLogs.get(setIds[0]!))?.editedAt).toBeNull()
    expect(await rowsOf(c, id)).toEqual(snapshots)
    // Every set now at the top → +1 step.
    expect(await nextSquat(c)).toMatchObject({ loadLb: 230, branch: 'step' })
  })

  it('validates edited values and the field whitelist', async () => {
    const c = ctx()
    const { setIds } = await finishedWithTypo(c)
    const set = setIds[0]!
    const before = await c.db.setLogs.get(set)
    await expectCode(editSet(c, set, { reps: -1 }), 'invalid_reps')
    await expectCode(editSet(c, set, { rir: 7 }), 'invalid_rir')
    await expectCode(editSet(c, set, { loadLb: -10 }), 'invalid_load')
    await expectCode(editSet(c, set, { setIndex: 9 } as never), 'field_not_editable')
    await expectCode(editSet(c, set, { sessionId: 'other' } as never), 'field_not_editable')
    await expectCode(editSet(c, 'nope', { reps: 5 }), 'set_not_found')
    // An empty patch changes nothing.
    await editSet(c, set, {})
    expect(await c.db.setLogs.get(set)).toEqual(before)
  })

  it('adds a missed set after the highest index', async () => {
    const c = ctx()
    const { id, squat, setIds } = await finishedWithTypo(c)
    await voidSetInEdit(c, setIds[3]!)
    c.advance(1000)
    const added = await addSet(c, { sessionExerciseId: squat.id, loadLb: 220, reps: 10, rir: 2 })
    expect(await c.db.setLogs.get(added)).toEqual({
      id: added,
      sessionId: id,
      sessionExerciseId: squat.id,
      exerciseId: 'ex-smith-squat',
      setIndex: 4,
      loadLb: 220,
      reps: 10,
      rir: 2,
      isWarmup: false,
      note: '',
      loggedAt: c.now(),
      editedAt: c.now(),
      voidedAt: null,
    })
    expect((await c.db.sessions.get(id))?.editedAt).toBe(c.now())
    // The typo set is voided and a correct one added: all four working sets at the top.
    expect(await nextSquat(c)).toMatchObject({ loadLb: 230, branch: 'step' })
    await expectCode(
      addSet(c, { sessionExerciseId: squat.id, loadLb: 220, reps: 2.5 }),
      'invalid_reps',
    )
    await expectCode(
      addSet(c, { sessionExerciseId: squat.id, loadLb: -220, reps: 5 }),
      'invalid_load',
    )
    await expectCode(
      addSet(c, { sessionExerciseId: 'nope', loadLb: 220, reps: 5 }),
      'session_exercise_not_found',
    )
  })

  it('voids and restores sets', async () => {
    const c = ctx()
    const { id, setIds } = await finishedWithTypo(c)
    const set = setIds[3]!
    await voidSetInEdit(c, set)
    expect(await c.db.setLogs.get(set)).toMatchObject({ voidedAt: c.now(), editedAt: c.now() })
    expect((await c.db.sessions.get(id))?.editedAt).toBe(c.now())
    // Without the typo set, three sets at the top and one missing: same load, +1 rep.
    expect(await nextSquat(c)).toMatchObject({ loadLb: 220, branch: 'same_plus_rep' })
    await expectCode(voidSetInEdit(c, set), 'set_voided')
    await expectCode(editSet(c, set, { reps: 10 }), 'set_voided')
    c.advance(1000)
    await restoreSet(c, set)
    expect(await c.db.setLogs.get(set)).toMatchObject({ voidedAt: null, editedAt: c.now() })
    await expectCode(restoreSet(c, set), 'set_not_voided')
    expect(await nextSquat(c)).toMatchObject({ loadLb: 220, branch: 'same_after_miss' })
  })
})

describe('Edit mode on sessions', () => {
  it('edits the note, flags and bodyweight', async () => {
    const c = ctx()
    const { id } = await finishedWithTypo(c)
    await editSession(c, id, { note: 'felt heavy', jointPain: true, bodyweightLb: 165 })
    expect(await c.db.sessions.get(id)).toMatchObject({
      note: 'felt heavy',
      jointPain: true,
      bodyweightLb: 165,
      bodyweightSource: 'manual',
      editedAt: c.now(),
    })
    // Marking it a deload takes it out of progression.
    await editSession(c, id, { isDeload: true })
    expect(await nextSquat(c)).toMatchObject({ loadLb: 220, branch: 'start' })
  })

  it('switches between finished and abandoned, never back to in progress', async () => {
    const c = ctx()
    const { id } = await finishedWithTypo(c)
    await editSession(c, id, { status: 'abandoned' })
    expect(await nextSquat(c)).toMatchObject({ branch: 'start' })
    await editSession(c, id, { status: 'finished' })
    expect(await nextSquat(c)).toMatchObject({ branch: 'same_after_miss' })
    await expectCode(editSession(c, id, { status: 'in_progress' }), 'invalid_status')
    for (const bad of [
      { date: '2026-01-01' },
      { programDayId: 'day-push' },
      { gymId: 'gym-2' },
      { startedAt: 0 },
      { finishedAt: 0 },
      { voidedAt: null },
      { bodyweightSource: 'weighin' },
    ]) {
      await expectCode(editSession(c, id, bad as never), 'field_not_editable')
    }
    await expectCode(editSession(c, id, { bodyweightLb: -1 }), 'invalid_bodyweight')
    await expectCode(editSession(c, 'nope', { note: 'x' }), 'session_not_found')
    expect(await c.db.sessions.get(id)).toMatchObject({ status: 'finished' })
  })

  it('voids and restores a whole session', async () => {
    const c = ctx()
    const { id, squat, setIds } = await finishedWithTypo(c)
    await voidSession(c, id)
    expect(await c.db.sessions.get(id)).toMatchObject({
      status: 'finished',
      voidedAt: c.now(),
      editedAt: c.now(),
    })
    expect(await nextSquat(c)).toMatchObject({ branch: 'start' })
    // A voided session's data can't change until it is restored.
    await expectCode(voidSession(c, id), 'session_voided')
    await expectCode(editSession(c, id, { note: 'x' }), 'session_voided')
    await expectCode(editSet(c, setIds[0]!, { reps: 9 }), 'session_voided')
    await expectCode(
      addSet(c, { sessionExerciseId: squat.id, loadLb: 220, reps: 9 }),
      'session_voided',
    )
    c.advance(1000)
    await restoreSession(c, id)
    expect(await c.db.sessions.get(id)).toMatchObject({ voidedAt: null, editedAt: c.now() })
    await expectCode(restoreSession(c, id), 'session_not_voided')
    expect(await nextSquat(c)).toMatchObject({ branch: 'same_after_miss' })
  })

  it('edits an abandoned session too', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    const [squat] = await rowsOf(c, id)
    const set = await logSet(c, { sessionExerciseId: squat!.id, loadLb: 220, reps: 8 })
    await abandonSession(c, id)
    await editSet(c, set, { reps: 9 })
    await editSession(c, id, { note: 'cut short' })
    expect(await c.db.setLogs.get(set)).toMatchObject({ reps: 9, editedAt: c.now() })
    expect(await c.db.sessions.get(id)).toMatchObject({ status: 'abandoned', note: 'cut short' })
  })
})

describe('Edit mode boundaries', () => {
  it('refuses a session in progress (the logger owns it)', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    const [squat] = await rowsOf(c, id)
    const set = await logSet(c, { sessionExerciseId: squat!.id, loadLb: 220, reps: 8 })
    const before = { session: await c.db.sessions.get(id), sets: await c.db.setLogs.toArray() }
    await expectCode(editSet(c, set, { reps: 9 }), 'session_not_editable')
    await expectCode(
      addSet(c, { sessionExerciseId: squat!.id, loadLb: 220, reps: 8 }),
      'session_not_editable',
    )
    await expectCode(voidSetInEdit(c, set), 'session_not_editable')
    await expectCode(restoreSet(c, set), 'session_not_editable')
    await expectCode(editSession(c, id, { note: 'x' }), 'session_not_editable')
    await expectCode(voidSession(c, id), 'session_not_editable')
    await expectCode(restoreSession(c, id), 'session_not_editable')
    expect({ session: await c.db.sessions.get(id), sets: await c.db.setLogs.toArray() }).toEqual(
      before,
    )
  })

  it('never changes the snapshots or any other session', async () => {
    const c = ctx()
    const a = await finishedWithTypo(c)
    c.advance(HOUR_MS)
    const b = await finishedWithTypo(c)
    const snapshots = await c.db.sessionExercises.toArray()
    const bRows = {
      session: await c.db.sessions.get(b.id),
      sets: await c.db.setLogs.where('sessionId').equals(b.id).toArray(),
    }
    await editSet(c, a.setIds[0]!, { loadLb: 225, reps: 9, rir: 0, isWarmup: true, note: 'n' })
    await addSet(c, { sessionExerciseId: a.squat.id, loadLb: 220, reps: 10 })
    await voidSetInEdit(c, a.setIds[1]!)
    await restoreSet(c, a.setIds[1]!)
    await editSession(c, a.id, { note: 'edited', jointPain: true, isDeload: true })
    await editSession(c, a.id, { status: 'abandoned', bodyweightLb: null })
    await voidSession(c, a.id)
    await restoreSession(c, a.id)
    expect(await c.db.sessionExercises.toArray()).toEqual(snapshots)
    expect({
      session: await c.db.sessions.get(b.id),
      sets: await c.db.setLogs.where('sessionId').equals(b.id).toArray(),
    }).toEqual(bRows)
  })
})
